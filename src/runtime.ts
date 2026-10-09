import type { UsageMessage } from "./usage.js";

export interface RuntimeSummary {
  status: "loading" | "ready" | "stale" | "unavailable";
  /** Sum of one native response duration per turn in the viewed session's retained history. */
  milliseconds?: number | undefined;
  /** Display-only projection; never becomes part of the native historical subtotal. */
  estimatedMilliseconds?: number | undefined;
}

export interface PreparedRuntime {
  summary: RuntimeSummary;
  /** Only a response/continuation at the open tail can be projected while the host is running. */
  turn?: { messageID: string; started: number; milliseconds: number };
}

const timestamp = (value: unknown): value is number => typeof value === "number" && value >= 0
  && Number.isFinite(new Date(value).getTime());

interface Response {
  message: UsageMessage;
  created: number | undefined;
}

/**
 * OpenCode 2.0.26's TUI turnDuration/inputIndex: completed assistant time minus
 * the first user/synthetic input after the previous idle marker, or the nearest
 * input in legacy histories with no idle markers. With no input it falls back
 * to the assistant's creation time. Take only the final response in each turn:
 * intermediate footer durations overlap and must never be added separately.
 * No execution-log API, client clock, child history, or additional reads.
 */
export function summarizeRuntime(messages: readonly UsageMessage[], fork = false): RuntimeSummary {
  return prepareRuntime(messages, fork).summary;
}

/** Scan history once per snapshot, keeping the current turn's overlapping subtotal separate. */
export function prepareRuntime(messages: readonly UsageMessage[], fork = false): PreparedRuntime {
  // Even a copied marker identifies the host's turn semantics for an open fork.
  const legacy = !messages.some(message => message.type === "idle");
  // Fork copies belong to the original session, including copied turn boundaries.
  const history = fork ? messages.filter(message => !/_\d+$/.test(message.id)) : messages;
  let milliseconds = 0, unavailable = false;
  let input: UsageMessage | undefined;
  let response: Response | undefined, completedResponse: Response | undefined;
  let lastAssistant: UsageMessage | undefined;
  let turnMilliseconds = 0;
  const finish = (closed: boolean) => {
    if (!response) return;
    let selected = response;
    if (selected.message.time?.completed === undefined) {
      // A live tail has no displayed duration yet. Missing closed-turn metadata
      // is different: don't disguise an unknown historical subtotal as zero.
      const message = selected.message;
      if (closed || !timestamp(message.time?.created) || !timestamp(selected.created) || message.finish || message.error || message.retry) {
        unavailable = true;
        return;
      }
      // A steer can start another response before idle. Keep the previously
      // displayed footer until a newer completed response replaces it.
      if (!completedResponse) return;
      selected = completedResponse;
    }
    const completed = selected.message.time?.completed;
    const created = selected.created;
    if (!timestamp(created) || !timestamp(completed)) { unavailable = true; return; }
    turnMilliseconds = Math.max(0, completed - created);
    milliseconds += turnMilliseconds;
  };
  for (const message of history) {
    if (message.type === "idle") {
      finish(true);
      input = undefined;
      response = completedResponse = undefined;
      lastAssistant = undefined;
      turnMilliseconds = 0;
    } else if (message.type === "user" || message.type === "synthetic") {
      if (legacy) {
        finish(true); input = undefined; response = completedResponse = undefined;
        lastAssistant = undefined; turnMilliseconds = 0;
      }
      input ??= message;
    } else if (message.type === "assistant") {
      lastAssistant = message;
      // Matches native footer eligibility. Older imported messages can lack
      // finish metadata; their completed timestamp still permits a duration.
      if (!message.error && !message.retry && (message.finish === "tool-calls" || message.finish === "unknown")) continue;
      response = { message, created: input ? input.time?.created : message.time?.created };
      if (message.time?.completed !== undefined) completedResponse = response;
    }
  }
  finish(false);
  if (unavailable || !Number.isFinite(milliseconds)) return { summary: { status: "unavailable" } };
  const summary: RuntimeSummary = { status: "ready", milliseconds };
  const started = input ? input.time?.created : lastAssistant?.time?.created;
  // Tool steps and scheduled retries can be completed without ending the turn.
  // A terminal response must not keep growing during the later idle/cleanup transition.
  const continuing = lastAssistant && (lastAssistant.retry || (!lastAssistant.error
    && (lastAssistant.finish === "tool-calls" || lastAssistant.finish === "unknown"
      || (!lastAssistant.finish && lastAssistant.time?.completed === undefined))));
  if (!lastAssistant || !continuing || !timestamp(started) || !timestamp(lastAssistant.time?.created)) return { summary };
  return { summary, turn: { messageID: lastAssistant.id, started, milliseconds: turnMilliseconds } };
}

/** Replace, rather than add to, an already-counted footer in the same steered turn. */
export function projectRuntime(prepared: PreparedRuntime, now: number | undefined): RuntimeSummary {
  const { summary, turn } = prepared;
  if (summary.status !== "ready" || summary.milliseconds === undefined || !turn || !timestamp(now)) return summary;
  const elapsed = Math.max(turn.milliseconds, now - turn.started, 0);
  const estimatedMilliseconds = Math.round(summary.milliseconds - turn.milliseconds + elapsed);
  return Number.isFinite(estimatedMilliseconds) ? { ...summary, estimatedMilliseconds } : summary;
}
