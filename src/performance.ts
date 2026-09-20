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
  bytes: number;
  events: Set<string>;
}

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

/** Tracks ephemeral streaming events without fetching the full session tree. */
export class PerformanceTracker {
  private rootID: string | undefined;
  private sessions = new Set<string>();
  private active = new Map<string, ActiveStep>();
  private observed = new Map<string, FirstTokenObservation>();

  setTree(rootID: string, sessionIDs: Iterable<string>) {
    if (this.rootID !== rootID) {
      this.active.clear();
      this.observed.clear();
      this.rootID = rootID;
    }
    this.sessions = new Set(sessionIDs);
    for (const [id, step] of this.active) if (!this.sessions.has(step.sessionID)) this.active.delete(id);
    for (const [id, sample] of this.observed) if (!this.sessions.has(sample.sessionID)) this.observed.delete(id);
  }

  addSession(sessionID: string | undefined, parentID: string | undefined) {
    if (sessionID && parentID && this.sessions.has(parentID)) this.sessions.add(sessionID);
  }

  handle(event: PerformanceEvent): boolean {
    const data = (event.data && typeof event.data === "object" ? event.data : {}) as {
      assistantMessageID?: unknown;
      sessionID?: unknown;
      started?: unknown;
      delta?: unknown;
    };
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
    const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined;
    if (!sessionID || !messageID || !this.sessions.has(sessionID)) return false;

    if (event.type === "session.step.started") {
      if (!finite(data.started)) return false;
      if (this.active.has(messageID)) return false;
      this.active.set(messageID, {
        messageID, sessionID, started: data.started, bytes: 0, events: new Set(),
      });
      return false;
    }

    const step = this.active.get(messageID);
    if (!step) return false;
    if (event.type === "session.step.streamed") {
      if (!finite(event.created) || event.created < step.started) return false;
      step.streamed = event.created;
      return step.bytes > 0;
    }
    if (event.type === "session.step.ended" || event.type === "session.step.failed") {
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
      this.observed.set(messageID, { messageID, sessionID, started: step.started, first: event.created });
    }
    return true;
  }

  reconcile(messages: Iterable<UsageMessage>) {
    const represented = new Set<string>();
    for (const message of messages) {
      if (message.type === "assistant" && (message.tokens || message.time?.streamed !== undefined
        || message.time?.completed !== undefined)) represented.add(message.id);
    }
    for (const [id, step] of this.active) {
      if (represented.has(id)) this.active.delete(id);
    }
  }

  summary(messages: Iterable<UsageMessage>): PerformanceSummary {
    const samples = [...this.observed.values()].filter(sample => this.sessions.has(sample.sessionID));
    const result = historicalPerformance(messages, samples);
    let bytes = 0;
    let duration = 0;
    for (const step of this.active.values()) {
      if (!this.sessions.has(step.sessionID) || step.bytes <= 0) continue;
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
