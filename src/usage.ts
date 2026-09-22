import type { PerformanceSummary } from "./performance.js";
import { officialPrice } from "./pricing.js";

export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface TokenInput {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export interface Price {
  tier?: { type: "context"; size: number };
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

export type PriceCatalog = ReadonlyMap<string, readonly Price[]>;

export const modelKey = (model: Pick<ModelRef, "providerID" | "id">) => `${model.providerID}/${model.id}`;

export interface UsageMessage {
  id: string;
  type: string;
  status?: string;
  model?: ModelRef;
  cost?: number;
  tokens?: TokenInput;
  time?: { created: number; streamed?: number; completed?: number };
  content?: readonly UsageContent[];
}

export type UsageContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; time?: { created: number; completed?: number } }
  | { type: "tool"; time: { created: number; ran?: number; completed?: number } }
  | { type: string; text?: string; time?: { created: number; completed?: number } };

const safe = (n: number | undefined) => n !== undefined && Number.isFinite(n) ? Math.max(0, n) : 0;

export function normalize(tokens?: TokenInput): Tokens {
  return {
    input: safe(tokens?.input), output: safe(tokens?.output), reasoning: safe(tokens?.reasoning),
    cache: { read: safe(tokens?.cache?.read), write: safe(tokens?.cache?.write) },
  };
}

export const incoming = (t: Tokens) => t.input + t.cache.read + t.cache.write;
export const total = (t: Tokens) => incoming(t) + t.output + t.reasoning;

// Matches OpenCode 2.0.11 SessionUsage.calculateCost: thresholds are exclusive.
export function estimate(tokens: Tokens, prices: readonly Price[] = []) {
  const tier = prices.filter(p => p.tier && incoming(tokens) > p.tier.size)
    .sort((a, b) => b.tier!.size - a.tier!.size)[0];
  const price = tier ?? prices.find(p => !p.tier);
  const rates = [price?.input, price?.output, price?.cache?.read, price?.cache?.write];
  const quantities = [tokens.input, tokens.output + tokens.reasoning, tokens.cache.read, tokens.cache.write];
  return {
    cost: quantities.reduce((sum, quantity, index) => sum + quantity * safe(rates[index]), 0) / 1_000_000,
    defaultPrice: total(tokens) > 0 && (!price || rates.some((rate, index) => quantities[index]! > 0
      && (rate === undefined || !Number.isFinite(rate) || rate < 0))),
  };
}

export type CostStatus = "empty" | "complete" | "partial" | "unavailable";

/** Prices every call with its recorded model. OpenCode's resolved price wins;
 * the built-in manufacturer snapshot is used only when that price is incomplete. */
export function summarize(messages: Iterable<UsageMessage>, catalog: PriceCatalog = new Map()) {
  const tokens = normalize();
  let cost = 0;
  let steps = 0;
  let knownCosts = 0;
  let missingCosts = 0;
  for (const message of messages) {
    // Matches OpenCode SessionStats: every assistant message is one step,
    // with or without reported usage; compaction and user messages are not.
    if (message.type === "assistant") steps++;
    if (message.type !== "assistant" && message.type !== "compaction") continue;
    const t = normalize(message.tokens);
    tokens.input += t.input;
    tokens.output += t.output;
    tokens.reasoning += t.reasoning;
    tokens.cache.read += t.cache.read;
    tokens.cache.write += t.cache.write;
    if (total(t) === 0) continue;
    if (!message.model) {
      missingCosts++;
      continue;
    }
    let value = estimate(t, catalog.get(modelKey(message.model)));
    if (value.defaultPrice) value = estimate(t, officialPrice(message.model)?.prices);
    if (value.defaultPrice) missingCosts++;
    else { cost += value.cost; knownCosts++; }
  }
  const costStatus: CostStatus = missingCosts > 0
    ? knownCosts > 0 ? "partial" : "unavailable"
    : knownCosts > 0 ? "complete" : "empty";
  return {
    tokens, total: total(tokens), cacheRate: incoming(tokens) ? tokens.cache.read / incoming(tokens) : 0,
    steps, cost, costStatus,
  };
}

export type Summary = ReturnType<typeof summarize>;

export interface ContextUsage {
  used: number;
  limit: number;
  percent: number;
}

const usableLimit = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;

// Matches the OpenCode 2.0.10 sidebar: the last assistant message with tokens that follows
// the last completed compaction carries the current context size. Running or failed
// compactions do not reset it, and a last message without usage hides the row entirely
// instead of falling back to pre-compaction history.
export function contextUsage(messages: readonly UsageMessage[], limit?: number): ContextUsage | undefined {
  if (!usableLimit(limit)) return undefined;
  let boundary = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.type === "compaction" && message.status === "completed") { boundary = index; break; }
  }
  for (let index = messages.length - 1; index > boundary; index--) {
    const message = messages[index]!;
    if (message.type !== "assistant" || !message.tokens) continue;
    const used = total(normalize(message.tokens));
    return used > 0 ? { used, limit, percent: used / limit * 100 } : undefined;
  }
  return undefined;
}

export function formatTokens(value: number): string {
  return Math.round(safe(value)).toLocaleString("en-US");
}

export const formatCost = (value: number) => value > 0 && value < 0.01 ? "<$0.01" : `$${safe(value).toFixed(2)}`;

export function usageRows(summary?: Summary, context?: ContextUsage, performance?: PerformanceSummary): readonly (readonly [string, string])[] {
  const t = summary?.tokens;
  const number = (value?: number) => value === undefined ? "—" : formatTokens(value);
  const rows: Array<readonly [string, string]> = [];
  if (context) rows.push(["Context", `${formatTokens(context.used)} / ${formatTokens(context.limit)} (${context.percent.toFixed(1)}%)`]);
  rows.push(
    ["Steps", number(summary?.steps)],
    ["Input", number(t?.input)], ["Output", number(t?.output)], ["Reasoning", number(t?.reasoning)],
    ["Cache Read", number(t?.cache.read)],
  );
  if (t && t.cache.write > 0) rows.push(["Cache Write", number(t.cache.write)]);
  rows.push(
    ["Cache Rate", summary ? `${(summary.cacheRate * 100).toFixed(1)}%` : "—"],
    ["Total", number(summary?.total)],
  );
  if (summary?.costStatus === "complete") rows.push(["Cost", formatCost(summary.cost)]);
  if (summary?.costStatus === "partial") rows.push(["Cost", `${formatCost(summary.cost)} · partial`]);
  if (summary?.costStatus === "unavailable") rows.push(["Cost", "—"]);
  if (performance?.tps !== undefined && Number.isFinite(performance.tps)) {
    rows.push(["TPS", `${performance.tpsEstimated ? "~" : ""}${Math.max(0, performance.tps).toFixed(1)} tok/s`]);
  }
  if (performance?.ttft !== undefined && Number.isFinite(performance.ttft)) {
    rows.push(["TTFT", `${(Math.max(0, performance.ttft) / 1_000).toFixed(1)}s`]);
  }
  return rows;
}
