export interface RuntimeEvent { type: string; data: unknown; created?: number }
type Subscribe = (listener: (event: RuntimeEvent) => void) => () => void;
type Listener = (sessionID?: string) => void;
type Tick = (now: number | undefined) => void;

const timestamp = (value: unknown): value is number => typeof value === "number" && value >= 0
  && Number.isFinite(new Date(value).getTime());

/** Shared server-time anchor and display clock; no wall clock, execution log or periodic reads. */
export class RuntimeMonitor {
  private anchor: { server: number; local: number } | undefined;
  private latest = new Map<string, { messageID: string; settled: boolean; created?: number }>();
  private stopped = new Set<string>();
  private listeners = new Set<Listener>();
  private ticks = new Set<Tick>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private synchronization: AbortController | undefined;
  private disposed = false;
  private readonly unsubscribe: (() => void) | undefined;

  constructor(subscribe?: Subscribe, private readonly monotonic = () => performance.now()) {
    this.unsubscribe = subscribe?.(event => this.handle(event));
  }

  now(): number | undefined {
    if (!this.anchor) return undefined;
    const now = this.anchor.server + Math.max(0, this.monotonic() - this.anchor.local);
    return timestamp(now) ? now : undefined;
  }

  /** One optional read-only RPC supplies an anchor even when opening a quiet active tool. */
  async synchronize(read: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    if (this.disposed) return;
    this.synchronization?.abort();
    const request = new AbortController();
    this.synchronization = request;
    const start = this.monotonic();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
    try {
      const server = await read(signal);
      if (this.disposed || signal.aborted || !timestamp(server)) return;
      // Midpoint correction bounds the initial network-delay estimate without
      // ever assuming the client and a remote server share an epoch clock.
      this.observe(server + Math.max(0, this.monotonic() - start) / 2);
      this.publish();
    } catch { /* Without a trusted anchor, retain native totals until a live event arrives. */ }
    finally {
      request.abort();
      if (this.synchronization === request) this.synchronization = undefined;
    }
  }

  listen(listener: Listener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Only views actually projecting a live turn keep this single 500ms ticker alive. */
  tick(listener: Tick): () => void {
    if (this.disposed) return () => {};
    this.ticks.add(listener);
    this.timer ??= setInterval(() => {
      const now = this.now();
      for (const tick of this.ticks) tick(now);
    }, 500);
    this.timer.unref?.();
    return () => {
      this.ticks.delete(listener);
      if (!this.ticks.size) { clearInterval(this.timer); this.timer = undefined; }
    };
  }

  canEstimate(sessionID: string, messageID: string): boolean {
    const latest = this.latest.get(sessionID);
    return !this.disposed && !this.stopped.has(sessionID)
      && (!latest || (latest.messageID === messageID && !latest.settled));
  }

  handle(event: RuntimeEvent) {
    if (this.disposed) return;
    if (event.type === "server.connected") {
      this.anchor = undefined;
      this.latest.clear();
      this.stopped.clear();
    }
    const firstAnchor = !this.anchor && timestamp(event.created);
    if (timestamp(event.created)) this.observe(event.created);
    const data = (event.data && typeof event.data === "object" ? event.data : {}) as {
      sessionID?: string; assistantMessageID?: string; finish?: string;
    };
    const sessionID = data.sessionID;
    if (event.type === "global.disposed" || event.type === "location.shutdown") {
      this.anchor = undefined;
      this.publish();
      return;
    }
    if (sessionID) {
      const latest = this.latest.get(sessionID);
      // Late/replayed endings cannot stop a newer step.
      const older = timestamp(event.created) && timestamp(latest?.created) && event.created < latest.created;
      if (event.type === "session.deleted") {
        this.latest.delete(sessionID);
        this.stopped.add(sessionID);
        this.publish(sessionID);
      } else if (!older && event.type === "session.step.started" && typeof data.assistantMessageID === "string") {
        this.latest.set(sessionID, { messageID: data.assistantMessageID, settled: false,
          ...(timestamp(event.created) ? { created: event.created } : {}) });
        this.stopped.delete(sessionID);
        this.publish(sessionID);
      } else if (!older && (event.type === "session.step.failed"
        || (event.type === "session.step.ended" && data.finish && !["tool-calls", "unknown"].includes(data.finish)))) {
        if (typeof data.assistantMessageID === "string" && (!latest || latest.messageID === data.assistantMessageID)) {
          this.latest.set(sessionID, { messageID: data.assistantMessageID, settled: true,
            ...(timestamp(event.created) ? { created: event.created } : {}) });
          this.publish(sessionID);
        }
      } else if (!older && event.type === "session.retry.scheduled" && latest && latest.messageID === data.assistantMessageID) {
        latest.settled = false;
        this.publish(sessionID);
      } else if (!older && ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.idle"].includes(event.type)) {
        this.stopped.add(sessionID);
        this.publish(sessionID);
      }
    }
    if (firstAnchor || event.type === "server.connected") this.publish();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.synchronization?.abort();
    this.unsubscribe?.();
    clearInterval(this.timer);
    this.timer = undefined;
    this.anchor = undefined;
    this.listeners.clear();
    this.ticks.clear();
    this.latest.clear();
    this.stopped.clear();
  }

  private observe(server: number) {
    // Do not move the live estimate backwards for old/duplicated stream events.
    if (!timestamp(server)) return;
    this.anchor = { server: Math.max(this.now() ?? server, server), local: this.monotonic() };
  }

  private publish(sessionID?: string) { for (const listener of this.listeners) listener(sessionID); }
}
