import { loadSnapshot, uniqueMessages, viewedMessages } from "./source.js";
import type { Snapshot, UsageSource } from "./source.js";
import { PerformanceMonitor, preparePerformance } from "./performance.js";
import type { PerformanceSummary, PreparedPerformance } from "./performance.js";
import type { ContextSources } from "./context-sources.js";
import { contextDetails, summarize, summarizeModels } from "./usage.js";
import type { ContextDetails, ContextUsage, ModelCost, Summary } from "./usage.js";

export interface UsageState {
  status: "loading" | "ready" | "stale" | "unavailable";
  summary?: Summary;
  context?: ContextUsage | undefined;
  details?: { context?: ContextDetails | undefined; models: readonly ModelCost[]; sources?: ContextSources | undefined; sessionTitle?: string | undefined };
  performance?: PerformanceSummary;
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
  "config.updated", "location.shutdown",
]);

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

  constructor(
    private readonly source: UsageSource,
    subscribe: Subscribe,
    private readonly publish: (state: UsageState) => void,
    private readonly delay = 80,
    private readonly retryDelay = 3_000,
    private readonly performanceDelay = 100,
    performance?: PerformanceMonitor,
    private readonly detailed = false,
  ) {
    this.ownsPerformance = performance === undefined;
    this.performance = performance ?? new PerformanceMonitor(subscribe);
    this.unsubscribePerformance = this.performance.listen(sessionID => {
      if (this.sessions.has(sessionID)) this.refreshPerformance();
    });
    this.unsubscribe = subscribe(event => {
      const data = (event.data && typeof event.data === "object" ? event.data : {}) as { sessionID?: string; parentID?: string };
      if (globalEvents.has(event.type)) return this.refresh();
      if (!sessionEvents.has(event.type)) return;
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
    this.timer = undefined;
    this.performanceTimer = undefined;
    this.pending = false;
    this.snapshot = undefined;
    this.prepared = undefined;
    this.sessions.clear();
    this.changed.clear();
    this.fullScan = true;
    this.sessionID = sessionID;
    this.update({ status: "loading" });
    void this.run();
  }

  refresh() {
    this.schedule(true);
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
    this.unsubscribePerformance();
    this.unsubscribe();
    if (this.ownsPerformance) this.performance.dispose();
  }

  private update(state: UsageState) { this.state = state; this.publish(state); }

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
      const context = contextDetails(viewedMessages(snapshot), snapshot.model.context,
        snapshot.sessions.get(snapshot.viewedID)?.revert?.messageID);
      this.update({
        status: "ready",
        summary: summarize(messages, snapshot.model.catalog),
        context: context?.usage,
        ...(this.detailed ? { details: { context, models: summarizeModels(messages, snapshot.model.catalog), sessionTitle: snapshot.sessions.get(snapshot.viewedID)?.title } } : {}),
        performance: this.performance.summaryPrepared(this.prepared, this.sessions),
        model: snapshot.model.label,
      });
      // The server plugin may be absent. An optional RPC must not delay measured usage.
      if (this.detailed && this.source.composition) {
        void this.source.composition(snapshot.sessions.get(snapshot.viewedID)!, AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]))
          .then(sources => {
            if (this.disposed || generation !== this.generation || this.snapshot !== snapshot || this.state.status !== "ready" || !this.state.details) return;
            this.update({ ...this.state, details: { ...this.state.details, sources } });
          })
          .catch(() => {});
      }
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.fullScan = true;
      this.update({ ...this.state, status: this.state.summary ? "stale" : "unavailable" });
      this.retry = setTimeout(() => this.schedule(false), this.retryDelay);
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        if (this.pending) { this.pending = false; this.schedule(false); }
      }
    }
  }
}
