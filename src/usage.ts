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
  /** Optional first-party rate when reasoning differs from ordinary output. */
  reasoning?: number;
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
function selectedPrice(tokens: Tokens, prices: readonly Price[]): Price | undefined {
  const tier = prices.filter(p => p.tier && incoming(tokens) > p.tier.size)
    .sort((a, b) => b.tier!.size - a.tier!.size)[0];
  return tier ?? prices.find(p => !p.tier);
}

export function estimate(tokens: Tokens, prices: readonly Price[] = []) {
  const price = selectedPrice(tokens, prices);
  const rates = [price?.input, price?.output, price?.reasoning ?? price?.output, price?.cache?.read, price?.cache?.write];
  const quantities = [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write];
  return {
    cost: quantities.reduce((sum, quantity, index) => sum + quantity * safe(rates[index]), 0) / 1_000_000,
    defaultPrice: total(tokens) > 0 && (!price || rates.some((rate, index) => quantities[index]! > 0
      && (rate === undefined || !Number.isFinite(rate) || rate < 0))),
  };
}

export type CostStatus = "empty" | "complete" | "partial" | "unavailable";

export type PriceSource = "OpenCode" | "Built-in snapshot";

export interface AppliedRates {
  source: PriceSource;
  lowerExclusive: number | undefined;
  upperInclusive: number | undefined;
  calls: number;
  rates: {
    input: number | undefined;
    output: number | undefined;
    reasoning: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
  };
}

interface PricedMessage {
  cost: number;
  source: PriceSource;
  price: Price;
  prices: readonly Price[];
}

function priceMessage(tokens: Tokens, model: ModelRef | undefined, catalog: PriceCatalog): PricedMessage | undefined {
  if (!model) return undefined;
  let prices = catalog.get(modelKey(model)) ?? [];
  let source: PriceSource = "OpenCode";
  let value = estimate(tokens, prices);
  if (value.defaultPrice || value.cost === 0) {
    const fallback = officialPrice(model)?.prices ?? [];
    const snapshot = estimate(tokens, fallback);
    if (!snapshot.defaultPrice) {
      value = snapshot;
      prices = fallback;
      source = "Built-in snapshot";
    }
  }
  const price = selectedPrice(tokens, prices);
  return value.defaultPrice || !price ? undefined : { cost: value.cost, source, price, prices };
}

const validRate = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;

function appliedRates(value: PricedMessage): AppliedRates {
  const lowerExclusive = value.price.tier?.size;
  const next = value.prices.reduce((size, price) => {
    const threshold = price.tier?.size;
    return threshold !== undefined && threshold > (lowerExclusive ?? -Infinity) && threshold < size ? threshold : size;
  }, Infinity);
  return {
    source: value.source,
    lowerExclusive,
    upperInclusive: Number.isFinite(next) ? next : undefined,
    calls: 1,
    rates: {
      input: validRate(value.price.input),
      output: validRate(value.price.output),
      reasoning: validRate(value.price.reasoning ?? value.price.output),
      cacheRead: validRate(value.price.cache?.read),
      cacheWrite: validRate(value.price.cache?.write),
    },
  };
}

function costStatus(known: number, missing: number): CostStatus {
  if (missing > 0) return known > 0 ? "partial" : "unavailable";
  return known > 0 ? "complete" : "empty";
}

/** Prices every call with its recorded model. A complete non-zero OpenCode
 * price wins; a complete snapshot price can replace a complete OpenCode zero.
 * Incomplete OpenCode prices fall back to the snapshot as a whole. */
export function summarize(messages: Iterable<UsageMessage>, catalog: PriceCatalog = new Map()) {
  const tokens = normalize();
  let cost = 0;
  let steps = 0;
  let calls = 0;
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
    // Same population the per-model rows price, so the dialog's call count reconciles with them.
    calls++;
    const value = priceMessage(t, message.model, catalog);
    if (value === undefined) missingCosts++;
    else { cost += value.cost; knownCosts++; }
  }
  return {
    tokens, total: total(tokens), cacheRate: incoming(tokens) ? tokens.cache.read / incoming(tokens) : 0,
    steps, calls, cost, costStatus: costStatus(knownCosts, missingCosts),
  };
}

export type Summary = ReturnType<typeof summarize>;

export interface ModelCost {
  model: string;
  calls: number;
  tokens: number;
  cost: number;
  costStatus: CostStatus;
  appliedRates: readonly AppliedRates[];
  unpricedCalls: number;
}

/** Groups the same per-message estimates used by the tree total; unlabelled calls stay visible. */
export function summarizeModels(messages: Iterable<UsageMessage>, catalog: PriceCatalog = new Map()): ModelCost[] {
  const groups = new Map<string | undefined, { calls: number; tokens: number; cost: number; known: number; missing: number; rates: Map<string, AppliedRates> }>();
  for (const message of messages) {
    if (message.type !== "assistant" && message.type !== "compaction") continue;
    const tokens = normalize(message.tokens);
    const count = total(tokens);
    if (count === 0) continue;
    const key = message.model && modelKey(message.model);
    const group = groups.get(key) ?? { calls: 0, tokens: 0, cost: 0, known: 0, missing: 0, rates: new Map<string, AppliedRates>() };
    group.calls++;
    group.tokens += count;
    const value = priceMessage(tokens, message.model, catalog);
    if (value === undefined) group.missing++;
    else {
      group.cost += value.cost;
      group.known++;
      const applied = appliedRates(value);
      const rateKey = JSON.stringify([applied.source, applied.lowerExclusive, applied.upperInclusive, ...Object.values(applied.rates)]);
      const existing = group.rates.get(rateKey);
      if (existing) existing.calls++;
      else group.rates.set(rateKey, applied);
    }
    groups.set(key, group);
  }
  return [...groups].map(([model, group]) => ({
    model: model ?? "Unknown model", calls: group.calls, tokens: group.tokens,
    cost: group.cost, costStatus: costStatus(group.known, group.missing),
    appliedRates: [...group.rates.values()].sort((a, b) => {
      const lowerA = a.lowerExclusive ?? -Infinity, lowerB = b.lowerExclusive ?? -Infinity;
      return lowerA === lowerB ? a.source.localeCompare(b.source) : lowerA - lowerB;
    }),
    unpricedCalls: group.missing,
  })).sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));
}

export interface ContextUsage {
  used: number;
  limit: number;
  percent: number;
}

export interface RequestDetails {
  tokens: Tokens;
  total: number;
  /** The selected assistant's stream end, completion, or creation time, in that order. */
  time?: number | undefined;
}

const usableLimit = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;
const usableTime = (value: number | undefined): value is number => value !== undefined && value >= 0 && Number.isFinite(new Date(value).getTime());

// Matches the OpenCode 2.0.10 sidebar: the last assistant message with tokens that follows
// the last completed compaction carries the current context size. Running or failed
// compactions do not reset it. Missing token reports are skipped, while an explicit
// zero report is not replaced by older usage. Request details need no model limit.
export function requestDetails(
  messages: readonly UsageMessage[], revertMessageID?: string,
): RequestDetails | undefined {
  // The staged revert excludes its boundary message and every later message.
  // Session.message.list is ascending; an absent marker can occur during a
  // concurrent commit, in which case the ordered ID still gives the cutoff.
  const found = revertMessageID ? messages.findIndex(message => message.id === revertMessageID) : -1;
  const next = revertMessageID && found < 0 ? messages.findIndex(message => message.id > revertMessageID) : -1;
  const end = !revertMessageID ? messages.length : found >= 0 ? found
    : next >= 0 ? next : messages.length;
  let boundary = -1;
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.type === "compaction" && message.status === "completed") { boundary = index; break; }
  }
  for (let index = end - 1; index > boundary; index--) {
    const message = messages[index]!;
    if (message.type !== "assistant" || !message.tokens) continue;
    const tokens = normalize(message.tokens);
    const used = total(tokens);
    const time = [message.time?.streamed, message.time?.completed, message.time?.created].find(usableTime);
    return used > 0 ? { tokens, total: used, time } : undefined;
  }
  return undefined;
}

export function contextUsage(messages: readonly UsageMessage[], limit?: number, revertMessageID?: string): ContextUsage | undefined {
  if (!usableLimit(limit)) return undefined;
  const request = requestDetails(messages, revertMessageID);
  return request ? { used: request.total, limit, percent: request.total / limit * 100 } : undefined;
}

export function formatTokens(value: number): string {
  return Math.round(safe(value)).toLocaleString("en-US");
}

export const formatCost = (value: number) => value > 0 && value < 0.01 ? "<$0.01" : `$${safe(value).toFixed(2)}`;

export function formatEstimatedCost(cost: number, status: CostStatus): string | undefined {
  if (status === "empty") return undefined;
  if (status === "unavailable") return "—";
  return `${formatCost(cost)}${status === "partial" ? " · partial" : ""}`;
}

/** Per-million rates need more precision than a rounded total cost. */
export function formatRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0.00";
  const decimal = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 12 });
  return `$${decimal === "0.00" ? value.toExponential(2) : decimal}`;
}

export function formatRateTier(value: Pick<AppliedRates, "lowerExclusive" | "upperInclusive">): string {
  const lower = value.lowerExclusive, upper = value.upperInclusive;
  if (lower === undefined && upper === undefined) return "all incoming sizes";
  if (lower === undefined) return `≤${formatTokens(upper!)} incoming`;
  if (upper === undefined) return `>${formatTokens(lower)} incoming`;
  return `>${formatTokens(lower)} to ≤${formatTokens(upper)} incoming`;
}

export function rateRows(value: AppliedRates): readonly (readonly [string, string])[] {
  const rates = value.rates;
  return [
    ["Input", formatRate(rates.input)], ["Output", formatRate(rates.output)],
    ["Reasoning", formatRate(rates.reasoning)], ["Cache Read", formatRate(rates.cacheRead)],
    ["Cache Write", formatRate(rates.cacheWrite)],
  ];
}

/** Compact display for scan-first views: 812, 139.4K, 3.70M. Detailed views keep formatTokens. */
export function formatCompact(value: number): string {
  const n = safe(value);
  if (n < 1_000) return String(Math.round(n));
  const k = n / 1_000;
  return k >= 999.95 ? `${(n / 1_000_000).toFixed(2)}M` : `${k.toFixed(1)}K`;
}

/** Splits a percentage into filled and empty cell counts for a plain-text bar. */
export function bar(percent: number, width: number): { filled: number; empty: number } {
  const size = Math.max(0, Math.floor(width));
  const filled = Math.max(0, Math.min(size, Math.round(percent / 100 * size)));
  return { filled, empty: size - filled };
}

/**
 * One model request: the five categories of the last assistant call plus its cache rate.
 * Compact mode hides zero rows and drops percentages; detailed mode keeps both.
 */
export function requestRows(details: RequestDetails, compact: boolean): readonly (readonly [string, string])[] {
  const t = details.tokens;
  const rows = ([
    ["Input", t.input], ["Output", t.output], ["Reasoning", t.reasoning],
    ["Cache Read", t.cache.read], ["Cache Write", t.cache.write],
  ] as const).filter(([, count]) => !compact || count > 0);
  const incomingTokens = incoming(t);
  return [
    ...rows.map(([label, count]) => [
      label,
      compact ? formatCompact(count) : `${formatTokens(count)} (${(count / details.total * 100).toFixed(1)}%)`,
    ] as const),
    ["Cache Rate", `${(incomingTokens ? t.cache.read / incomingTokens * 100 : 0).toFixed(1)}%`] as const,
  ];
}

/** Tree summary rows for the dialog's detailed Session view, calls included. */
export function summaryRows(summary: Summary): readonly (readonly [string, string])[] {
  return [
    ["Steps", formatTokens(summary.steps)], ["Calls", formatTokens(summary.calls)],
    ...usageRows(summary).filter(([label]) => label !== "Steps"),
  ];
}

/** `1 step` reads better than `1 steps` in the dialog's single-line summaries. */
export const countLabel = (value: number, noun: string) => `${formatTokens(value)} ${noun}${value === 1 ? "" : "s"}`;

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
  const cost = summary && formatEstimatedCost(summary.cost, summary.costStatus);
  if (cost !== undefined) rows.push(["Est. Cost", cost]);
  if (performance?.tps !== undefined && Number.isFinite(performance.tps)) {
    rows.push(["TPS", `${performance.tpsEstimated ? "~" : ""}${Math.max(0, performance.tps).toFixed(1)} tok/s`]);
  }
  if (performance?.ttft !== undefined && Number.isFinite(performance.ttft)) {
    rows.push(["TTFT", `${(Math.max(0, performance.ttft) / 1_000).toFixed(1)}s`]);
  }
  return rows;
}
