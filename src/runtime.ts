import type { UsageMessage } from "./usage.js";

export interface RuntimeSummary {
  status: "loading" | "ready" | "stale" | "unavailable";
  /** Sum of one native response duration per turn in the viewed session's retained history. */
  milliseconds?: number | undefined;
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
  // Even a copied marker identifies the host's turn semantics for an open fork.
  const legacy = !messages.some(message => message.type === "idle");
  // Fork copies belong to the original session, including copied turn boundaries.
  const history = fork ? messages.filter(message => !/_\d+$/.test(message.id)) : messages;
  let milliseconds = 0, unavailable = false;
  let input: UsageMessage | undefined;
  let response: Response | undefined, completedResponse: Response | undefined;
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
    milliseconds += Math.max(0, completed - created);
  };
  for (const message of history) {
    if (message.type === "idle") {
      finish(true);
      input = undefined;
      response = completedResponse = undefined;
    } else if (message.type === "user" || message.type === "synthetic") {
      if (legacy) { finish(true); input = undefined; response = completedResponse = undefined; }
      input ??= message;
    } else if (message.type === "assistant") {
      // Matches native footer eligibility. Older imported messages can lack
      // finish metadata; their completed timestamp still permits a duration.
      if (!message.error && !message.retry && (message.finish === "tool-calls" || message.finish === "unknown")) continue;
      response = { message, created: input ? input.time?.created : message.time?.created };
      if (message.time?.completed !== undefined) completedResponse = response;
    }
  }
  finish(false);
  return unavailable || !Number.isFinite(milliseconds)
    ? { status: "unavailable" } : { status: "ready", milliseconds };
}
