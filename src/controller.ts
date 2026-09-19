import { loadSnapshot, uniqueMessages } from "./source.js";
import type { Snapshot, UsageSource } from "./source.js";
import { summarize } from "./usage.js";
import type { Summary } from "./usage.js";

export interface UsageState {
  status: "loading" | "ready" | "stale" | "unavailable";
  summary?: Summary;
  model?: string;
}

export interface UsageEvent { type: string; data: unknown }
export type Subscribe = (listener: (event: UsageEvent) => void) => () => void;

const sessionEvents = new Set([
  "session.created", "session.deleted", "session.forked", "session.moved",
  "session.model.selected", "session.agent.selected", "session.step.ended", "session.step.failed",
  "session.compaction.ended", "session.compaction.failed", "session.message.content.updated",
  "session.usage.recorded", "session.usage.updated", "session.revert.committed",
  "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted",
]);
const globalEvents = new Set([
  "server.connected", "model.updated", "provider.updated", "models-dev.refreshed",
  "config.updated", "location.shutdown",
]);

/** Owns requests and subscriptions for one mounted sidebar. No incremental addition. */
export class UsageController {
  private state: UsageState = { status: "loading" };
  private snapshot: Snapshot | undefined;
  private sessionID: string | undefined;
  private generation = 0;
  private request: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private disposed = false;
  private unsubscribe: () => void;

  constructor(
    private readonly source: UsageSource,
    subscribe: Subscribe,
    private readonly publish: (state: UsageState) => void,
    private readonly delay = 80,
    private readonly retryDelay = 3_000,
  ) {
    this.unsubscribe = subscribe(event => {
      if (globalEvents.has(event.type)) return this.refresh();
      if (!sessionEvents.has(event.type)) return;
      const data = event.data as { sessionID?: string; parentID?: string };
      if (!this.snapshot || event.type === "session.created" || event.type === "session.forked"
        || data.sessionID === this.sessionID || (data.sessionID && this.snapshot.sessions.has(data.sessionID))) this.refresh();
    });
  }

  select(sessionID: string) {
    if (this.disposed || sessionID === this.sessionID) return;
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    this.timer = undefined;
    this.pending = false;
    this.snapshot = undefined;
    this.sessionID = sessionID;
    this.update({ status: "loading" });
    void this.run();
  }

  refresh() {
    if (this.disposed || !this.sessionID) return;
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
    this.unsubscribe();
  }

  private update(state: UsageState) { this.state = state; this.publish(state); }

  private async run() {
    if (this.disposed || !this.sessionID) return;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
      const snapshot = await loadSnapshot(this.source, this.sessionID, signal);
      if (this.disposed || generation !== this.generation) return;
      this.snapshot = snapshot;
      this.update({ status: "ready", summary: summarize(uniqueMessages(snapshot), snapshot.pricing.prices), model: snapshot.pricing.label });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.update({ ...this.state, status: this.state.summary ? "stale" : "unavailable" });
      this.retry = setTimeout(() => this.refresh(), this.retryDelay);
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        if (this.pending) { this.pending = false; this.refresh(); }
      }
    }
  }
}
