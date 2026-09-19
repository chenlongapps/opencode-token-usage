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

export interface UsageMessage {
  id: string;
  type: string;
  tokens?: TokenInput;
}

const safe = (n: number | undefined) => n !== undefined && Number.isFinite(n) ? Math.max(0, n) : 0;

export function normalize(tokens?: TokenInput): Tokens {
  return {
    input: safe(tokens?.input), output: safe(tokens?.output), reasoning: safe(tokens?.reasoning),
    cache: { read: safe(tokens?.cache?.read), write: safe(tokens?.cache?.write) },
  };
}

export const incoming = (t: Tokens) => t.input + t.cache.read + t.cache.write;
export const total = (t: Tokens) => incoming(t) + t.output + t.reasoning;

// Matches OpenCode 2.0.9 SessionUsage.calculateCost: thresholds are exclusive.
export function estimate(tokens: Tokens, prices: readonly Price[] = []) {
  const tier = prices.filter(p => p.tier && incoming(tokens) > p.tier.size)
    .sort((a, b) => b.tier!.size - a.tier!.size)[0];
  const price = tier ?? prices.find(p => !p.tier);
  const rates = [price?.input, price?.output, price?.cache?.read, price?.cache?.write];
  return {
    cost: (tokens.input * safe(rates[0]) + (tokens.output + tokens.reasoning) * safe(rates[1])
      + tokens.cache.read * safe(rates[2]) + tokens.cache.write * safe(rates[3])) / 1_000_000,
    defaultPrice: rates.some(rate => rate === undefined || !Number.isFinite(rate) || rate < 0),
  };
}

export function summarize(messages: Iterable<UsageMessage>, prices: readonly Price[] = []) {
  const tokens = normalize();
  let cost = 0;
  let defaultPrice = prices.length === 0;
  for (const message of messages) {
    if ((message.type !== "assistant" && message.type !== "compaction") || !message.tokens) continue;
    const t = normalize(message.tokens);
    tokens.input += t.input;
    tokens.output += t.output;
    tokens.reasoning += t.reasoning;
    tokens.cache.read += t.cache.read;
    tokens.cache.write += t.cache.write;
    const value = estimate(t, prices);
    cost += value.cost;
    defaultPrice ||= value.defaultPrice;
  }
  return { tokens, total: total(tokens), cacheRate: incoming(tokens) ? tokens.cache.read / incoming(tokens) : 0, cost, defaultPrice };
}

export type Summary = ReturnType<typeof summarize>;

export function formatTokens(value: number): string {
  return Math.round(safe(value)).toLocaleString("en-US");
}

export const formatCost = (value: number) => value > 0 && value < 0.01 ? "<$0.01" : `$${safe(value).toFixed(2)}`;

export function usageRows(summary?: Summary): readonly (readonly [string, string])[] {
  const t = summary?.tokens;
  const number = (value?: number) => value === undefined ? "—" : formatTokens(value);
  const rows: Array<readonly [string, string]> = [
    ["Input", number(t?.input)], ["Output", number(t?.output)], ["Reasoning", number(t?.reasoning)],
    ["Cache Read", number(t?.cache.read)],
    ["Cache Rate", summary ? `${(summary.cacheRate * 100).toFixed(1)}%` : "—"],
    ["Total", number(summary?.total)],
  ];
  if (t && t.cache.write > 0) rows.splice(4, 0, ["Cache Write", number(t.cache.write)]);
  if (summary && summary.cost > 0) rows.push(["Cost", formatCost(summary.cost)]);
  return rows;
}
