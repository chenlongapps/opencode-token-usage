import { loadSnapshot, uniqueMessages, viewedMessages } from "./source.js";
import type { Snapshot, UsageSource } from "./source.js";
import { PerformanceMonitor, preparePerformance } from "./performance.js";
import type { PerformanceSummary, PreparedPerformance } from "./performance.js";
import { prepareRuntime, projectRuntime } from "./runtime.js";
import type { PreparedRuntime, RuntimeSummary } from "./runtime.js";
import { RuntimeMonitor } from "./runtime-monitor.js";
import type { ContextSources } from "./context-sources.js";
import { contextUsage, requestDetails, summarize, summarizeModels } from "./usage.js";
import type { ContextUsage, ModelCost, RequestDetails, Summary } from "./usage.js";

export interface UsageState {
  status: "loading" | "ready" | "stale" | "unavailable";
  summary?: Summary;
  context?: ContextUsage | undefined;
  details?: { request?: RequestDetails | undefined; models: readonly ModelCost[]; sources?: ContextSources | undefined; sessionTitle?: string | undefined };
  performance?: PerformanceSummary;
  runtime?: RuntimeSummary;
  model?: string;
}

export interface UsageEvent { type: string; data: unknown; id?: string; created?: number }
export type Subscribe = (listener: (event: UsageEvent) => void) => () => void;

const sessionEvents = new Set([
  "session.created", "session.deleted", "session.forked", "session.moved",
  "session.model.selected", "session.agent.selected", "session.step.ended", "session.step.failed",
  "session.compaction.ended", "session.compaction.failed", "session.message.content.updated",
  "session.usage.recorded", "session.usage.updated", "session.revert.committed",
  "session.revert.staged", "session.revert.cleared",
  "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted",
]);
const globalEvents = new Set([
  "server.connected", "model.updated", "provider.updated", "models-dev.refreshed",
  "config.updated", "location.shutdown", "global.disposed",
]);
const runtimeEvents = new Set(["session.step.started", "session.inbox.delivered", "session.retry.scheduled", "session.compaction.started"]);

/** Owns snapshot refreshes and throttled in-memory performance updates for one mounted view. */
export class UsageController {
  private state: UsageState = { status: "loading" };
  private snapshot: Snapshot | undefined;
  private sessionID: string | undefined;
  private generation = 0;
  private request: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private performanceTimer: ReturnType<typeof setTimeout> | undefined;
  private sessions = new Set<string>();
  private changed = new Set<string>();
  private fullScan = true;
  private prepared: PreparedPerformance | undefined;
  private pending = false;
  private disposed = false;
  private unsubscribe: () => void;
  private readonly unsubscribePerformance: () => void;
  private readonly performance: PerformanceMonitor;
  private readonly ownsPerformance: boolean;
  private readonly runtime: RuntimeMonitor;
  private readonly ownsRuntime: boolean;
  private readonly unsubscribeRuntime: () => void;
  private stopRuntimeTick: (() => void) | undefined;
  private preparedRuntime: PreparedRuntime | undefined;
  private running = false;
  private runtimeFresh = false;

  constructor(
    private readonly source: UsageSource,
    subscribe: Subscribe,
    private readonly publish: (state: UsageState) => void,
    private readonly delay = 80,
    private readonly retryDelay = 3_000,
    private readonly performanceDelay = 100,
    performance?: PerformanceMonitor,
    private readonly detailed = false,
    runtime?: RuntimeMonitor,
  ) {
    this.ownsPerformance = performance === undefined;
    this.performance = performance ?? new PerformanceMonitor(subscribe);
    this.unsubscribePerformance = this.performance.listen(sessionID => {
      if (this.sessions.has(sessionID)) this.refreshPerformance();
    });
    this.ownsRuntime = runtime === undefined;
    this.runtime = runtime ?? new RuntimeMonitor(subscribe);
    this.unsubscribeRuntime = this.runtime.listen(sessionID => {
      if (!sessionID || sessionID === this.sessionID) this.refreshRuntime();
    });
    this.unsubscribe = subscribe(event => {
      const data = (event.data && typeof event.data === "object" ? event.data : {}) as { sessionID?: string; parentID?: string };
      if (globalEvents.has(event.type)) {
        if (["server.connected", "location.shutdown", "global.disposed"].includes(event.type)) {
          this.runtimeFresh = false;
          this.stopRuntime();
        }
        return this.refresh();
      }
      if (!sessionEvents.has(event.type) && !(this.running && data.sessionID === this.sessionID && runtimeEvents.has(event.type))) return;
      if (event.type === "session.created") {
        if (data.sessionID && data.parentID && (this.sessions.has(data.parentID) || data.parentID === this.sessionID)) {
          this.sessions.add(data.sessionID); // Stream updates can precede discovery.
          this.schedule(false);
        } else if (data.sessionID === this.sessionID) this.schedule(false);
        return;
      }
      const related = data.sessionID === this.sessionID || !!(data.sessionID && this.sessions.has(data.sessionID));
      if (!related) return;
      if (event.type === "session.deleted" && data.sessionID) this.sessions.delete(data.sessionID);
      if (data.sessionID) this.changed.add(data.sessionID);
      this.schedule(event.type === "session.moved");
    });
  }

  select(sessionID: string) {
    if (this.disposed || sessionID === this.sessionID) return;
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    clearTimeout(this.performanceTimer);
    this.stopRuntime();
    this.timer = undefined;
    this.performanceTimer = undefined;
    this.pending = false;
    this.snapshot = undefined;
    this.prepared = undefined;
    this.preparedRuntime = undefined;
    this.running = this.runtimeFresh = false;
    this.sessions.clear();
    this.changed.clear();
    this.fullScan = true;
    this.sessionID = sessionID;
    this.update({ status: "loading", runtime: { status: "loading" } });
    void this.run();
  }

  refresh() {
    this.schedule(true);
  }

  /** The TUI supplies the viewed session's reactive native status, never its children's status. */
  setRunning(running: boolean) {
    if (this.disposed || running === this.running) return;
    this.running = running;
    this.refreshRuntime();
    // Read once at activity transitions, not on clock ticks or text deltas.
    if (this.sessionID) this.changed.add(this.sessionID);
    this.schedule(false);
  }

  private schedule(full: boolean) {
    if (this.disposed || !this.sessionID) return;
    if (full) this.fullScan = true;
    clearTimeout(this.retry);
    if (this.request) { this.pending = true; return; }
    // Fixed window, rather than resetting on every event: streams cannot starve refreshes.
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, this.delay);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.request?.abort();
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    clearTimeout(this.performanceTimer);
    this.stopRuntime();
    this.unsubscribeRuntime();
    this.unsubscribePerformance();
    this.unsubscribe();
    if (this.ownsPerformance) this.performance.dispose();
    if (this.ownsRuntime) this.runtime.dispose();
  }

  private update(state: UsageState) { this.state = state; this.publish(state); }

  private stopRuntime() { this.stopRuntimeTick?.(); this.stopRuntimeTick = undefined; }

  private runtimeSummary(now = this.runtime.now()): RuntimeSummary | undefined {
    const prepared = this.preparedRuntime;
    if (!prepared) return undefined;
    return this.running && this.runtimeFresh && this.sessionID && prepared.turn
      && this.runtime.canEstimate(this.sessionID, prepared.turn.messageID)
      ? projectRuntime(prepared, now) : prepared.summary;
  }

  private refreshRuntime(now = this.runtime.now()) {
    if (this.disposed || this.state.status !== "ready") { this.stopRuntime(); return; }
    const runtime = this.runtimeSummary(now);
    if (runtime?.estimatedMilliseconds === undefined) {
      // Freeze the last projection until a fresh snapshot can replace it with
      // native completion metadata, rather than briefly showing the old subtotal.
      this.stopRuntime();
      return;
    }
    this.stopRuntimeTick ??= this.runtime.tick(time => this.refreshRuntime(time));
    if (runtime.estimatedMilliseconds !== this.state.runtime?.estimatedMilliseconds) this.update({ ...this.state, runtime });
  }

  private refreshPerformance() {
    if (this.disposed || !this.snapshot || this.performanceTimer) return;
    this.performanceTimer = setTimeout(() => {
      this.performanceTimer = undefined;
      if (this.disposed || !this.snapshot || !this.state.summary) return;
      if (this.prepared) this.update({ ...this.state, performance: this.performance.summaryPrepared(this.prepared, this.sessions) });
    }, this.performanceDelay);
  }

  private async run() {
    if (this.disposed || !this.sessionID) return;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    const full = this.fullScan;
    const changed = new Set(this.changed);
    this.fullScan = false;
    this.changed.clear();
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
      const snapshot = await loadSnapshot(this.source, this.sessionID, signal,
        full ? undefined : this.snapshot, full ? undefined : changed);
      if (this.disposed || generation !== this.generation) return;
      this.snapshot = snapshot;
      const messages = [...uniqueMessages(snapshot)];
      this.sessions = new Set(snapshot.sessions.keys());
      this.performance.reconcile(messages, this.sessions);
      this.prepared = preparePerformance(messages);
      clearTimeout(this.performanceTimer);
      this.performanceTimer = undefined;
      const history = viewedMessages(snapshot);
      const session = snapshot.sessions.get(snapshot.viewedID)!;
      const revertMessageID = session.revert?.messageID;
      this.preparedRuntime = prepareRuntime(history, !!session.fork);
      this.runtimeFresh = true;
      this.update({
        status: "ready",
        summary: summarize(messages, snapshot.model.catalog),
        context: contextUsage(history, snapshot.model.context, revertMessageID),
        ...(this.detailed ? { details: { request: requestDetails(history, revertMessageID), models: summarizeModels(messages, snapshot.model.catalog), sessionTitle: session.title } } : {}),
        performance: this.performance.summaryPrepared(this.prepared, this.sessions),
        runtime: this.runtimeSummary()!,
        model: snapshot.model.label,
      });
      this.refreshRuntime();
      // The server plugin may be absent. An optional RPC must not delay measured usage.
      if (this.detailed && this.source.composition) {
        void this.source.composition(session, AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]))
          .then(sources => {
            if (this.disposed || generation !== this.generation || this.snapshot !== snapshot || this.state.status !== "ready" || !this.state.details) return;
            this.update({ ...this.state, details: { ...this.state.details, sources } });
          })
          .catch(() => {});
      }
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.fullScan = true;
      this.runtimeFresh = false;
      this.stopRuntime();
      this.update({
        ...this.state, status: this.state.summary ? "stale" : "unavailable",
        runtime: this.state.runtime?.milliseconds === undefined
          ? { status: "unavailable" } : { ...this.state.runtime, status: "stale" },
      });
      this.retry = setTimeout(() => this.schedule(false), this.retryDelay);
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        if (this.pending) { this.pending = false; this.schedule(false); }
      }
    }
  }
}
