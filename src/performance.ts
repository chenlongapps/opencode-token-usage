import { normalize } from "./usage.js";
import type { UsageMessage } from "./usage.js";

export interface PerformanceSummary {
  tps?: number;
  tpsEstimated?: boolean;
  /** Average time to first token, in milliseconds. */
  ttft?: number;
}

export interface FirstTokenObservation {
  messageID: string;
  sessionID: string;
  started: number;
  first: number;
}

export interface PerformanceEvent {
  type: string;
  data: unknown;
  id?: string;
  created?: number;
}

interface ActiveStep {
  messageID: string;
  sessionID: string;
  started: number;
  first?: number;
  last?: number;
  streamed?: number;
  finishedAt?: number;
  bytes: number;
  events: Set<string>;
}

interface RuntimeObservation extends FirstTokenObservation {
  expiresAt?: number;
}

export type PerformanceSubscribe = (listener: (event: PerformanceEvent) => void) => () => void;
export type PerformanceListener = (sessionID: string) => void;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function historicalFirst(message: UsageMessage): number | undefined {
  const started = message.time?.created;
  if (!finite(started)) return undefined;
  for (const part of message.content ?? []) {
    if (part.type === "text") {
      if (part.text) return undefined;
      continue;
    }
    if (part.type === "reasoning") {
      if (!part.text) continue;
      const first = part.time?.created;
      return finite(first) && first >= started ? first - started : undefined;
    }
    if (part.type === "tool") {
      const first = part.time?.created;
      return finite(first) && first >= started ? first - started : undefined;
    }
  }
  return undefined;
}

/** Exact completed-run TPS and the average of only measurable TTFT samples. */
export function historicalPerformance(
  messages: Iterable<UsageMessage>,
  observations: Iterable<FirstTokenObservation> = [],
): PerformanceSummary {
  const observed = new Map<string, FirstTokenObservation>();
  for (const sample of observations) {
    if (finite(sample.started) && finite(sample.first) && sample.first >= sample.started) observed.set(sample.messageID, sample);
  }

  let output = 0;
  let duration = 0;
  let ttft = 0;
  let ttftSamples = 0;
  const messagesSeen = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    messagesSeen.add(message.id);
    const created = message.time?.created;
    const streamed = message.time?.streamed;
    const tokens = normalize(message.tokens);
    const generated = tokens.output + tokens.reasoning;
    if (finite(created) && finite(streamed) && streamed > created && generated > 0) {
      output += generated;
      duration += streamed - created;
    }

    const runtime = observed.get(message.id);
    const sample = runtime ? runtime.first - runtime.started : historicalFirst(message);
    if (sample !== undefined && finite(sample) && sample >= 0) {
      ttft += sample;
      ttftSamples++;
    }
  }

  // A live first-token event can arrive before the refreshed message snapshot.
  for (const sample of observed.values()) {
    if (messagesSeen.has(sample.messageID)) continue;
    ttft += sample.first - sample.started;
    ttftSamples++;
  }

  const result: PerformanceSummary = {};
  if (duration > 0) result.tps = output / (duration / 1_000);
  if (ttftSamples > 0) result.ttft = ttft / ttftSamples;
  return result;
}

/** Captures streaming performance for every session for one plugin lifetime. */
export class PerformanceMonitor {
  private active = new Map<string, ActiveStep>();
  private observed = new Map<string, RuntimeObservation>();
  private listeners = new Set<PerformanceListener>();
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly unsubscribe: (() => void) | undefined;

  constructor(
    subscribe?: PerformanceSubscribe,
    private readonly retention = 60_000,
    private readonly now = Date.now,
  ) {
    this.unsubscribe = subscribe?.(event => this.handle(event));
  }

  listen(listener: PerformanceListener) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.listeners.clear();
    this.active.clear();
    this.observed.clear();
  }

  private key(sessionID: string, messageID: string) { return `${sessionID}\0${messageID}`; }

  private publish(sessionID: string) {
    for (const listener of this.listeners) listener(sessionID);
  }

  private deleteSession(sessionID: string) {
    for (const [key, step] of this.active) if (step.sessionID === sessionID) this.active.delete(key);
    for (const [key, sample] of this.observed) if (sample.sessionID === sessionID) this.observed.delete(key);
  }

  private prune() {
    const now = this.now();
    const changed = new Set<string>();
    for (const [key, step] of this.active) {
      if (step.finishedAt !== undefined && step.finishedAt + this.retention <= now) {
        this.active.delete(key);
        changed.add(step.sessionID);
      }
    }
    for (const [key, sample] of this.observed) {
      if (sample.expiresAt !== undefined && sample.expiresAt <= now) {
        this.observed.delete(key);
        changed.add(sample.sessionID);
      }
    }
    return changed;
  }

  private scheduleCleanup() {
    clearTimeout(this.cleanupTimer);
    if (this.disposed || !Number.isFinite(this.retention) || this.retention < 0) return;
    let next = Infinity;
    for (const step of this.active.values()) {
      if (step.finishedAt !== undefined) next = Math.min(next, step.finishedAt + this.retention);
    }
    for (const sample of this.observed.values()) {
      if (sample.expiresAt !== undefined) next = Math.min(next, sample.expiresAt);
    }
    if (!Number.isFinite(next)) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      for (const sessionID of this.prune()) this.publish(sessionID);
      this.scheduleCleanup();
    }, Math.max(0, next - this.now()));
    this.cleanupTimer.unref?.();
  }

  handle(event: PerformanceEvent): boolean {
    if (this.disposed) return false;
    for (const sessionID of this.prune()) this.publish(sessionID);
    const data = (event.data && typeof event.data === "object" ? event.data : {}) as {
      assistantMessageID?: unknown;
      sessionID?: unknown;
      started?: unknown;
      delta?: unknown;
    };
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
    if (event.type === "session.deleted") {
      if (sessionID) this.deleteSession(sessionID);
      return false;
    }
    const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined;
    if (!sessionID || !messageID) return false;
    const key = this.key(sessionID, messageID);

    if (event.type === "session.step.started") {
      if (!finite(data.started)) return false;
      if (this.active.has(key)) return false;
      this.active.set(key, {
        messageID, sessionID, started: data.started, bytes: 0, events: new Set(),
      });
      return false;
    }

    const step = this.active.get(key);
    if (!step) return false;
    if (event.type === "session.step.streamed") {
      if (!finite(event.created) || event.created < step.started) return false;
      step.streamed = event.created;
      if (step.bytes > 0) this.publish(sessionID);
      return step.bytes > 0;
    }
    if (event.type === "session.step.ended" || event.type === "session.step.failed") {
      step.finishedAt = this.now();
      const sample = this.observed.get(key);
      if (sample) sample.expiresAt = step.finishedAt + this.retention;
      this.scheduleCleanup();
      return false;
    }
    if (event.type !== "session.text.delta" && event.type !== "session.reasoning.delta"
      && event.type !== "session.tool.input.delta") return false;
    if (typeof data.delta !== "string" || data.delta.length === 0 || !finite(event.created) || event.created < step.started) return false;
    if (event.id && step.events.has(event.id)) return false;
    if (event.id) step.events.add(event.id);
    step.bytes += new TextEncoder().encode(data.delta).byteLength;
    step.last = Math.max(step.last ?? event.created, event.created);
    if (step.first === undefined) {
      step.first = event.created;
      this.observed.set(key, { messageID, sessionID, started: step.started, first: event.created });
    }
    this.publish(sessionID);
    return true;
  }

  reconcile(messages: Iterable<UsageMessage>, sessionIDs: Iterable<string>) {
    const sessions = new Set(sessionIDs);
    const represented = new Set<string>();
    for (const message of messages) {
      if (message.type === "assistant" && (message.tokens || message.time?.streamed !== undefined
        || message.time?.completed !== undefined)) represented.add(message.id);
    }
    for (const [key, step] of this.active) {
      if (sessions.has(step.sessionID) && represented.has(step.messageID)
        && (step.finishedAt !== undefined || step.streamed !== undefined)) this.active.delete(key);
    }
  }

  summary(messages: Iterable<UsageMessage>, sessionIDs: Iterable<string>): PerformanceSummary {
    const sessions = new Set(sessionIDs);
    const samples = [...this.observed.values()].filter(sample => sessions.has(sample.sessionID));
    const result = historicalPerformance(messages, samples);
    let bytes = 0;
    let duration = 0;
    for (const step of this.active.values()) {
      if (!sessions.has(step.sessionID) || step.bytes <= 0) continue;
      const last = step.streamed ?? step.last;
      if (!finite(last) || last <= step.started) continue;
      bytes += step.bytes;
      duration += last - step.started;
    }
    if (bytes > 0 && duration > 0) {
      result.tps = (bytes / 4) / (duration / 1_000);
      result.tpsEstimated = true;
    }
    return result;
  }
}
