import assert from "node:assert/strict";
import { test } from "node:test";
import { officialPrice } from "../src/pricing.js";
import { bar, contextUsage, countLabel, estimate, fitUsageSummary, formatCompact, formatCost, formatDuration, formatEstimatedCost, formatRate, formatRateTier, formatRunTime, formatTokens, modelKey, normalize, rateRows, requestDetails, requestRows, summarize, summarizeModels, summaryRows, usageRows } from "../src/usage.js";
import type { ModelRef, Price, UsageMessage } from "../src/usage.js";

const price: Price = { input: 2, output: 8, cache: { read: 0.2, write: 3 } };
const model = { providerID: "test", id: "model" };
const catalog = (prices: readonly Price[] = [price]) => new Map([[modelKey(model), prices]]);
const priced = (message: UsageMessage): UsageMessage => ({ ...message, model });
const snapshotPrices = (model: ModelRef) => {
  const entry = officialPrice(model);
  assert.ok(entry, modelKey(model));
  return entry.prices;
};

test("five disjoint categories, per-message model cost, cache rate, and message types", () => {
  const value = summarize([
    priced({ id: "a", type: "assistant", tokens: { input: 200, output: 30, reasoning: 10, cache: { read: 600, write: 200 } } }),
    priced({ id: "c", type: "compaction", tokens: { input: 100, output: 20 } }),
    { id: "u", type: "user", tokens: { input: 99_000 } },
    { id: "in-progress", type: "assistant" },
  ], catalog());
  assert.deepEqual(value.tokens, { input: 300, output: 50, reasoning: 10, cache: { read: 600, write: 200 } });
  assert.equal(value.total, 1160);
  assert.equal(value.cacheRate, 600 / 1100);
  assert.equal(usageRows(value).find(([label]) => label === "Cache Rate")?.[1], "54.5%");
  assert.ok(Math.abs(value.cost - 0.0018) < 1e-12);
  assert.equal(value.costStatus, "complete");
});

test("steps count every assistant message across the tree and lead the panel", () => {
  const messages: UsageMessage[] = [
    { id: "a", type: "assistant", tokens: { input: 200 } },
    { id: "b", type: "assistant" }, // A step still running or without reported usage counts.
    { id: "c", type: "compaction", status: "completed", tokens: { input: 100 } },
    { id: "u", type: "user", tokens: { input: 99_000 } },
  ];
  const summary = summarize(messages);
  assert.equal(summary.steps, 2);
  assert.equal(summarize([]).steps, 0);
  assert.equal(formatTokens(12_500), "12,500");
  assert.equal(usageRows(summary).find(([label]) => label === "Steps")?.[1], "2");

  // The compaction boundary above hides the context row; use plain history for ordering.
  const context = contextUsage(messages.slice(0, 2), 128_000);
  const rows = usageRows(summary, context);
  assert.deepEqual(rows[0], ["Context", "200 / 128,000 (0.2%)"]);
  assert.deepEqual(rows[1], ["Steps", "2"]);
  assert.equal(rows[2]?.[0], "Input");
  // Without a context limit the steps row becomes the panel lead.
  assert.deepEqual(usageRows(summary, undefined)[0], ["Steps", "2"]);
  // A missing summary keeps the row visible with the em-dash placeholder.
  assert.deepEqual(usageRows(undefined, undefined)[0], ["Steps", "—"]);
});

test("zero input, missing and invalid fields hide zero-value rows", () => {
  assert.deepEqual(normalize({ input: NaN, output: -10, reasoning: Infinity, cache: { read: 5 } }), {
    input: 0, output: 0, reasoning: 0, cache: { read: 5, write: 0 },
  });
  const empty = summarize([]);
  assert.equal(empty.cacheRate, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.cost, 0);
  assert.equal(empty.costStatus, "empty");
  assert.equal(usageRows(empty).length, 7);
  assert.equal(usageRows(empty).find(([label]) => label === "Cache Rate")?.[1], "0.0%");
  assert.ok(!usageRows(empty).some(([label]) => label === "Cache Write"));
  assert.ok(!usageRows(empty).some(([label]) => label === "Est. Cost"));
  assert.equal(usageRows().length, 7);
  assert.ok(usageRows().every(([, value]) => value === "—"));
});

test("compact numbers, bars and the detailed session rows feed the redesigned dialog", () => {
  assert.equal(formatCompact(812), "812");
  assert.equal(formatCompact(1_270), "1.3K");
  assert.equal(formatCompact(5_197), "5.2K");
  assert.equal(formatCompact(139_382), "139.4K");
  assert.equal(formatCompact(1_000_000), "1.00M");
  assert.equal(formatCompact(3_700_338), "3.70M");
  // Rounding never produces an impossible "1000.0K".
  assert.equal(formatCompact(999_949), "999.9K");
  assert.equal(formatCompact(999_999), "1.00M");
  assert.equal(formatCompact(NaN), "0");
  assert.deepEqual(bar(0, 10), { filled: 0, empty: 10 });
  assert.deepEqual(bar(37.4, 10), { filled: 4, empty: 6 });
  assert.deepEqual(bar(176.3, 10), { filled: 10, empty: 0 });
  assert.deepEqual(bar(50, -3), { filled: 0, empty: 0 });

  const summary = summarize([
    { id: "a", type: "assistant", tokens: { input: 200, output: 50, cache: { read: 800 } } },
    { id: "b", type: "assistant", tokens: { input: 0 } },
    { id: "c", type: "compaction", status: "completed", tokens: { input: 100 } },
    { id: "u", type: "user", tokens: { input: 90 } },
  ], catalog());
  // Steps count every assistant message; calls count only priced ones.
  assert.equal(summary.steps, 2);
  assert.equal(summary.calls, 2);
  assert.deepEqual(summaryRows(summary).map(([label]) => label), [
    "Steps", "Calls", "Input", "Output", "Reasoning", "Cache Read", "Cache Rate", "Total", "Est. Cost",
  ]);
  assert.equal(countLabel(1, "step"), "1 step");
  assert.equal(countLabel(2, "step"), "2 steps");
  assert.equal(countLabel(29, "call"), "29 calls");
});

test("cache write stays conditional while confirmed free cost displays as zero", () => {
  const paidWithoutCache = summarize([
    priced({ id: "paid", type: "assistant", tokens: { input: 100 } }),
  ], catalog());
  assert.ok(!usageRows(paidWithoutCache).some(([label]) => label === "Cache Write"));
  assert.equal(usageRows(paidWithoutCache).find(([label]) => label === "Est. Cost")?.[1], "<$0.001");

  const freePrice: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } };
  const freeWithCache = summarize([
    { id: "free", type: "assistant", model, tokens: { cache: { write: 100 } } },
  ], catalog([freePrice]));
  assert.equal(usageRows(freeWithCache).find(([label]) => label === "Cache Write")?.[1], "100");
  assert.equal(usageRows(freeWithCache).find(([label]) => label === "Est. Cost")?.[1], "$0.00");
});

test("ordinary, cache, and reasoning prices are per million tokens", () => {
  assert.equal(estimate(normalize({ input: 1_000_000 }), [price]).cost, 2);
  assert.equal(estimate(normalize({ output: 1_000_000, reasoning: 500_000 }), [price]).cost, 12);
  assert.equal(estimate(normalize({ cache: { read: 1_000_000, write: 1_000_000 } }), [price]).cost, 3.2);
  assert.equal(estimate(normalize({ output: 1_000_000, reasoning: 500_000 }), [{ ...price, reasoning: 12 }]).cost, 14);
  assert.equal(estimate(normalize({ reasoning: 50 }), [{ input: 2, reasoning: 12 }]).defaultPrice, false);
});

test("tiers use per-message incoming tokens and strict thresholds", () => {
  const tiers: Price[] = [
    { ...price, tier: { type: "context", size: 200 }, input: 20 },
    price,
    { ...price, tier: { type: "context", size: 100 }, input: 10 },
  ];
  assert.equal(estimate(normalize({ input: 100 }), tiers).cost, 0.0002);
  assert.equal(estimate(normalize({ input: 101 }), tiers).cost, 0.00101);
  assert.equal(estimate(normalize({ input: 200 }), tiers).cost, 0.002);
  assert.equal(estimate(normalize({ input: 201 }), tiers).cost, 0.00402);
  assert.equal(estimate(normalize({ input: 1, cache: { read: 100, write: 100 } }), tiers).cost, 0.00034);
});

test("free prices are distinct from missing prices and absent applicable tiers", () => {
  const tokens = normalize({ input: 10, output: 10 });
  assert.deepEqual(estimate(tokens, [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]), { cost: 0, defaultPrice: false });
  assert.deepEqual(estimate(tokens), { cost: 0, defaultPrice: true });
  assert.deepEqual(estimate(tokens, [{ ...price, tier: { type: "context", size: 100 } }]), { cost: 0, defaultPrice: true });
  assert.deepEqual(estimate(tokens, [{ input: 2, output: NaN }]), { cost: 0.00002, defaultPrice: true });
  assert.deepEqual(estimate(normalize({ input: 10 }), [{ input: 2 }]), { cost: 0.00002, defaultPrice: false });
});

test("OpenCode prices win, official prices fill gaps, and message-recorded cost is ignored", () => {
  const officialModel = { providerID: "gateway", id: "openai/gpt-5.6-luna" };
  const usage: UsageMessage = { id: "official", type: "assistant", model: officialModel, cost: 999, tokens: { input: 1_000_000 } };
  const expected = estimate(normalize(usage.tokens), snapshotPrices(officialModel)).cost;
  const complete = summarize([usage]);
  assert.equal(complete.cost, expected);
  assert.equal(complete.costStatus, "complete");
  assert.equal(usageRows(complete).find(([label]) => label === "Est. Cost")?.[1], formatEstimatedCost(expected, "complete"));

  const runtime = new Map([[modelKey(officialModel), [{ input: 3 }]]]);
  assert.equal(summarize([usage], runtime).cost, 3);

  const unavailable = summarize([{ id: "missing", type: "assistant", model: { providerID: "test", id: "unknown" }, tokens: { input: 10 } }]);
  assert.equal(unavailable.costStatus, "unavailable");
  assert.equal(usageRows(unavailable).find(([label]) => label === "Est. Cost")?.[1], "—");

  const partial = summarize([
    usage,
    { id: "missing", type: "assistant", model: { providerID: "test", id: "unknown" }, tokens: { input: 10 } },
  ]);
  assert.equal(partial.cost, expected);
  assert.equal(partial.costStatus, "partial");
  assert.equal(usageRows(partial).find(([label]) => label === "Est. Cost")?.[1], formatEstimatedCost(expected, "partial"));
});

test("mixed-model trees price every message with its own model", () => {
  const fast = { providerID: "test", id: "fast" };
  const strong = { providerID: "test", id: "strong" };
  const prices = new Map([
    [modelKey(fast), [{ input: 1, output: 2 }]],
    [modelKey(strong), [{ input: 10, output: 20 }]],
  ]);
  const summary = summarize([
    { id: "fast", type: "assistant", model: fast, tokens: { input: 1_000_000, output: 1_000_000 } },
    { id: "strong", type: "assistant", model: strong, tokens: { input: 1_000_000, output: 1_000_000 } },
  ], prices);
  assert.equal(summary.cost, 33);
  assert.equal(summary.costStatus, "complete");
});

test("model cost rows reconcile with tree cost across runtime, official, free and missing prices", () => {
  const runtime = { providerID: "test", id: "priced" };
  const fallback = { providerID: "gateway", id: "gpt-5.6-luna" };
  const free = { providerID: "test", id: "free" };
  const catalog = new Map([
    [modelKey(runtime), [{ input: 2 }]],
    [modelKey(free), [{ input: 0 }]],
  ]);
  const messages: UsageMessage[] = [
    { id: "one", type: "assistant", model: runtime, tokens: { input: 1_000_000 } },
    { id: "two", type: "compaction", model: runtime, tokens: { input: 500_000 } },
    { id: "three", type: "assistant", model: fallback, tokens: { input: 1_000_000 } },
    { id: "four", type: "assistant", model: free, tokens: { input: 100 } },
    { id: "five", type: "assistant", model: runtime, tokens: { output: 100 } }, // Runtime has no output rate.
    { id: "six", type: "assistant", tokens: { input: 50 } },
    { id: "seven", type: "user", tokens: { input: 100_000 } },
    { id: "eight", type: "assistant", model: runtime },
  ];
  const tree = summarize(messages, catalog);
  const models = summarizeModels(messages, catalog);
  assert.equal(tree.costStatus, "partial");
  assert.equal(models.reduce((sum, value) => sum + value.cost, 0), tree.cost);
  assert.deepEqual(models.map(({ model, costStatus, calls }) => [model, costStatus, calls]).sort(), [
    ["test/priced", "partial", 3], ["gateway/gpt-5.6-luna", "complete", 1],
    ["test/free", "complete", 1], ["Unknown model", "unavailable", 1],
  ].sort());
  const runtimeRow = models.find(row => row.model === modelKey(runtime))!;
  const fallbackRow = models.find(row => row.model === modelKey(fallback))!;
  assert.equal(runtimeRow.cost, 3);
  assert.equal(runtimeRow.tokens, 1_500_100);
  assert.equal(fallbackRow.cost, estimate(normalize({ input: 1_000_000 }), snapshotPrices(fallback)).cost);
  assert.equal(formatEstimatedCost(runtimeRow.cost, runtimeRow.costStatus), "$3.00 · partial");
  const freeRow = models.find(row => row.model === modelKey(free))!;
  assert.equal(formatEstimatedCost(freeRow.cost, freeRow.costStatus), "$0.00");
  const unknownRow = models.find(row => row.model === "Unknown model")!;
  assert.equal(formatEstimatedCost(unknownRow.cost, unknownRow.costStatus), "—");
  assert.ok(models.every((row, index) => index === 0 || models[index - 1]!.cost >= row.cost));
  assert.deepEqual(summarizeModels([]), []);
});

test("model rate groups reflect the source and context tier actually used by each call", () => {
  // This manually reviewed override is not changed by the models.dev updater.
  const model = { providerID: "openai", id: "gpt-5.6-luna-fast" };
  const runtime = new Map([[modelKey(model), [
    { input: 3, output: 6 },
    { tier: { type: "context" as const, size: 100 }, input: 5, output: 10 },
  ]]]);
  const messages: UsageMessage[] = [
    { id: "base", type: "assistant", model, tokens: { input: 100, output: 10 } },
    { id: "tier", type: "assistant", model, tokens: { input: 101, output: 10 } },
    { id: "reasoning", type: "compaction", model, tokens: { input: 50, reasoning: 5 } },
    { id: "cache-read", type: "assistant", model, tokens: { input: 50, cache: { read: 10 } } },
    { id: "cache-write", type: "assistant", model, tokens: { input: 50, cache: { write: 10 } } },
  ];
  const group = summarizeModels(messages, runtime)[0]!;
  const tree = summarize(messages, runtime);
  assert.equal(group.cost, tree.cost);
  assert.equal(group.costStatus, "complete");
  assert.equal(group.unpricedCalls, 0);
  assert.equal(group.appliedRates.length, 3);
  const base = group.appliedRates.find(rate => rate.source === "OpenCode" && rate.lowerExclusive === undefined)!;
  const tier = group.appliedRates.find(rate => rate.source === "OpenCode" && rate.lowerExclusive === 100)!;
  const fallback = group.appliedRates.find(rate => rate.source === "Built-in snapshot")!;
  assert.equal(base.calls, 2);
  assert.equal(tier.calls, 1);
  assert.equal(fallback.calls, 2);
  assert.equal(formatRateTier(base), "≤100 incoming");
  assert.equal(formatRateTier(tier), ">100 incoming");
  assert.equal(formatRateTier(fallback), "≤272,000 incoming");
  assert.deepEqual(rateRows(base), [
    ["Input", "$3.00"], ["Output", "$6.00"], ["Reasoning", "$6.00"],
    ["Cache Read", "—"], ["Cache Write", "—"],
  ]);
  assert.deepEqual(rateRows(fallback), [
    ["Input", "$0.40"], ["Output", "$2.40"], ["Reasoning", "$2.40"],
    ["Cache Read", "$0.04"], ["Cache Write", "$0.50"],
  ]);
});

test("rate details keep free, unavailable, and partial calls distinct", () => {
  const model = { providerID: "test", id: "free-input" };
  const messages: UsageMessage[] = [
    { id: "free", type: "assistant", model, tokens: { input: 10 } },
    { id: "missing", type: "assistant", model, tokens: { output: 10 } },
    { id: "unknown", type: "assistant", tokens: { input: 10 } },
  ];
  const groups = summarizeModels(messages, new Map([[modelKey(model), [{ input: 0, cache: { read: 0 } }]]]));
  assert.equal(groups[0]?.model, "test/free-input");
  assert.equal(groups[0]?.costStatus, "partial");
  assert.equal(groups[0]?.unpricedCalls, 1);
  assert.equal(groups[0]?.appliedRates[0]?.source, "OpenCode");
  assert.deepEqual(rateRows(groups[0]!.appliedRates[0]!), [
    ["Input", "$0.00"], ["Output", "—"], ["Reasoning", "—"],
    ["Cache Read", "$0.00"], ["Cache Write", "—"],
  ]);
  assert.equal(groups[1]?.model, "Unknown model");
  assert.equal(groups[1]?.unpricedCalls, 1);
  assert.deepEqual(groups[1]?.appliedRates, []);
  assert.equal(formatRate(0.006), "$0.006");
  assert.equal(formatRate(1e-14), "$1.00e-14");
  assert.equal(formatRate(undefined), "—");
  assert.equal(formatRateTier({ lowerExclusive: 100, upperInclusive: 200 }), ">100 to ≤200 incoming");
  assert.equal(formatRateTier({ lowerExclusive: undefined, upperInclusive: undefined }), "all incoming sizes");
});

test("incomplete OpenCode prices fall back as a whole and complete zero prices use the snapshot", () => {
  const officialModel = { providerID: "gateway", id: "gpt-5.6-luna" };
  const usage: UsageMessage = { id: "fallback", type: "compaction", model: officialModel, tokens: { input: 1_000_000, output: 1_000_000 } };
  const expected = estimate(normalize(usage.tokens), snapshotPrices(officialModel)).cost;
  const incomplete = new Map([[modelKey(officialModel), [{ input: 9 }]]]);
  assert.equal(summarize([usage], incomplete).cost, expected);
  const free = new Map([[modelKey(officialModel), [{ input: 0, output: 0 }]]]);
  assert.equal(summarize([usage], free).cost, expected);
  assert.equal(summarize([usage], free).costStatus, "complete");
});

test("a complete OpenCode zero yields to a complete snapshot price only", () => {
  const model = { providerID: "gateway", id: "gpt-5.6-luna" };
  const usage: UsageMessage = { id: "zero", type: "assistant", model, tokens: { input: 1_000_000 } };
  const freeRuntime = new Map([[modelKey(model), [{ input: 0 }]]]);
  assert.equal(summarize([usage], freeRuntime).cost, estimate(normalize(usage.tokens), snapshotPrices(model)).cost);
  assert.equal(summarize([usage], freeRuntime).costStatus, "complete");
  assert.equal(summarizeModels([usage], freeRuntime)[0]?.appliedRates[0]?.source, "Built-in snapshot");

  const paidRuntime = new Map([[modelKey(model), [{ input: 3 }]]]);
  assert.equal(summarize([usage], paidRuntime).cost, 3);

  const cacheModel = { providerID: "gateway", id: "qwen3.8-27b" }; // Reviewed override has no cache-write rate.
  const cacheUsage: UsageMessage = {
    id: "unpriced-cache-write", type: "assistant", model: cacheModel, tokens: { cache: { write: 1_000_000 } },
  };
  const freeCacheWrite = new Map([[modelKey(cacheModel), [{ cache: { write: 0 } }]]]);
  assert.equal(summarize([cacheUsage], freeCacheWrite).cost, 0);
  assert.equal(summarize([cacheUsage], freeCacheWrite).costStatus, "complete");
  assert.equal(summarizeModels([cacheUsage], freeCacheWrite)[0]?.appliedRates[0]?.source, "OpenCode");
});

test("runtime zero prices for OpenCode Zen free models display as zero", () => {
  const ids = [
    "ling-3.0-flash-fin-free",
    "nemotron-3.5-lightning-free",
    "nemotron-3-ultra-free",
  ];
  const freePrice: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } };
  const prices = new Map(ids.map(id => [modelKey({ providerID: "opencode", id }), [freePrice]]));
  const messages = ids.map((id, index): UsageMessage => ({
    id: `free-${index}`, type: "assistant", model: { providerID: "opencode", id },
    tokens: { input: 1_000, output: 100 },
  }));
  const summary = summarize(messages, prices);
  assert.equal(summary.cost, 0);
  assert.equal(summary.costStatus, "complete");
  assert.equal(usageRows(summary).find(([label]) => label === "Est. Cost")?.[1], "$0.00");
});

test("Muse Spark Contributor snapshot prices replace OpenCode's complete free rate", () => {
  const model = { providerID: "opencode", id: "muse-spark-1.3-contributor-free" };
  const freePrice: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } };
  const tokens = { input: 1_000_000, output: 1_000_000 };
  const expected = estimate(normalize(tokens), snapshotPrices(model)).cost;
  const summary = summarize([{
    id: "contributor", type: "assistant", model,
    tokens,
  }], new Map([[modelKey(model), [freePrice]]]));
  assert.equal(summary.cost, expected);
  assert.equal(summary.costStatus, "complete");
  assert.equal(usageRows(summary).find(([label]) => label === "Est. Cost")?.[1], formatEstimatedCost(expected, "complete"));
});

test("first-party fallback keeps distinct reasoning and unknown cache-write billing honest", () => {
  const qwen = { providerID: "alibaba", id: "qwen-plus" };
  const tokens = { input: 1_000_000, output: 1_000_000, reasoning: 1_000_000 };
  const prices = snapshotPrices(qwen);
  const priced = summarize([{
    id: "reasoned", type: "assistant", model: qwen,
    tokens,
  }]);
  assert.equal(priced.cost, estimate(normalize(tokens), prices).cost);
  assert.equal(priced.costStatus, "complete");
  assert.equal(summarizeModels([{
    id: "reasoned", type: "assistant", model: qwen,
    tokens,
  }])[0]?.appliedRates[0]?.rates.reasoning, prices[0]?.reasoning ?? prices[0]?.output);

  const unknownWrite = summarize([{
    id: "write", type: "assistant", model: { providerID: "alibaba", id: "qwen3.8-27b" },
    tokens: { cache: { write: 1_000_000 } },
  }]);
  assert.equal(unknownWrite.costStatus, "unavailable");
});

test("comma grouping, rounding boundaries and dollar display", () => {
  for (const [number, expected] of [
    [0, "0"], [999, "999"], [1000, "1,000"], [1200, "1,200"], [125000, "125,000"],
    [999949, "999,949"], [999950, "999,950"], [999999, "999,999"],
    [1_000_000, "1,000,000"], [1_500_000, "1,500,000"],
    [1200.4, "1,200"], [1200.5, "1,201"],
  ] as const) assert.equal(formatTokens(number), expected);
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.00001), "<$0.001");
  assert.equal(formatCost(0.000999), "<$0.001");
  assert.equal(formatCost(0.001), "$0.001");
  assert.equal(formatCost(0.00504), "$0.005");
  assert.equal(formatCost(0.01), "$0.010");
  assert.equal(formatCost(0.0101), "$0.01");
  assert.equal(formatCost(1.234), "$1.23");
});

test("context row leads the panel and carries the percentage inline", () => {
  const messages: UsageMessage[] = [
    { id: "a", type: "assistant", tokens: { input: 60_000, output: 10_000, reasoning: 2_400 } },
  ];
  const usage = contextUsage(messages, 128_000);
  assert.equal(usage?.used, 72_400);
  assert.equal(usage?.limit, 128_000);
  assert.equal(usage?.percent.toFixed(1), "56.6");
  assert.deepEqual(usageRows(summarize(messages.map(message => priced(message)), catalog()), usage), [
    ["Context", "72,400 / 128,000 (56.6%)"],
    ["Steps", "1"],
    ["Input", "60,000"],
    ["Output", "10,000"],
    ["Reasoning", "2,400"],
    ["Cache Read", "0"],
    ["Cache Rate", "0.0%"],
    ["Total", "72,400"],
    ["Est. Cost", "$0.22"],
  ]);
});

test("context uses the last assistant with tokens after the last completed compaction", () => {
  const limit = 1_000;
  const assistant = (id: string, input: number): UsageMessage => ({ id, type: "assistant", tokens: { input } });
  const compact = (status: string, input = 700): UsageMessage => ({ id: `c-${status}`, type: "compaction", status, tokens: { input } });
  assert.equal(contextUsage([], limit), undefined);
  assert.equal(contextUsage([{ id: "u", type: "user", tokens: { input: 900 } }], limit), undefined);
  assert.equal(contextUsage([assistant("a", 100)], limit)?.used, 100);
  assert.equal(contextUsage([assistant("a", 100), assistant("b", 300)], limit)?.used, 300);
  // A trailing assistant without usage is skipped, but a zero-usage one is not replaced.
  assert.equal(contextUsage([assistant("a", 100), { id: "b", type: "assistant" }], limit)?.used, 100);
  assert.equal(contextUsage([assistant("a", 100), assistant("b", 0)], limit), undefined);
  // Only a completed compaction resets the window, and its own tokens are never the answer.
  const boundary = [assistant("a", 100), compact("completed"), { id: "u", type: "user" }];
  assert.equal(contextUsage(boundary, limit), undefined);
  assert.equal(contextUsage([...boundary, assistant("b", 250)], limit)?.used, 250);
  for (const status of ["running", "failed"]) assert.equal(contextUsage([assistant("a", 100), compact(status)], limit)?.used, 100);
});

test("revert bounds current context across regeneration and completed compaction", () => {
  const history: UsageMessage[] = [
    { id: "a", type: "assistant", tokens: { input: 100 } },
    { id: "b", type: "user" },
    { id: "c", type: "assistant", tokens: { input: 200 } },
    { id: "d", type: "compaction", status: "completed", tokens: { input: 900 } },
    { id: "e", type: "assistant", tokens: { input: 300 } },
    { id: "f", type: "user" },
    { id: "g", type: "assistant", tokens: { input: 400 } },
  ];
  assert.equal(contextUsage(history, 1_000)?.used, 400);
  assert.equal(contextUsage(history, 1_000, "f")?.used, 300);
  assert.equal(contextUsage(history, 1_000, "e"), undefined, "the last completed compaction is still in scope");
  assert.equal(contextUsage(history, 1_000, "d")?.used, 200, "a reverted compaction is out of scope");
  assert.equal(contextUsage(history, 1_000, "b")?.used, 100);
  const regenerated = [...history.slice(0, 5), { id: "h", type: "assistant", tokens: { input: 350 } }];
  assert.equal(contextUsage(regenerated, 1_000)?.used, 350);
  assert.equal(summarize(history.map(value => priced(value))).total, 1_900,
    "staging a revert does not remove historical costs from the tree");
});

test("request composition uses the viewed call's five categories without a context limit", () => {
  const history: UsageMessage[] = [
    { id: "old", type: "assistant", tokens: { input: 900 } },
    { id: "compact", type: "compaction", status: "completed", tokens: { input: 1_000 } },
    { id: "current", type: "assistant", tokens: {
      input: 100, output: 20, reasoning: 10, cache: { read: 60, write: 10 },
    } },
    { id: "pending", type: "assistant" },
  ];
  const details = requestDetails(history)!;
  assert.equal(details.total, 200);
  assert.deepEqual(requestRows(details, false), [
    ["Input", "100 (50.0%)"], ["Output", "20 (10.0%)"], ["Reasoning", "10 (5.0%)"],
    ["Cache Read", "60 (30.0%)"], ["Cache Write", "10 (5.0%)"], ["Cache Rate", "35.3%"],
  ]);
  // Compact mode drops empty categories and percentages; the cache rate stays.
  assert.deepEqual(requestRows(requestDetails([
    { id: "a", type: "assistant", tokens: { input: 812, cache: { read: 138_542 } } },
  ])!, true), [
    ["Input", "812"], ["Cache Read", "138.5K"], ["Cache Rate", "99.4%"],
  ]);
  assert.deepEqual(contextUsage(history, 100), { used: 200, limit: 100, percent: 200 });
  assert.equal(contextUsage(history, undefined), undefined);
  assert.equal(requestDetails([...history, { id: "last", type: "assistant", tokens: { input: 0 } }]), undefined);
});

test("request time belongs to the reported assistant and falls back only to its valid timestamps", () => {
  const reported: UsageMessage = {
    id: "a", type: "assistant", tokens: { input: 100 }, time: { created: 1_000, streamed: 2_000, completed: 3_000 },
  };
  const pending: UsageMessage = { id: "b", type: "assistant", time: { created: 4_000 } };
  assert.equal(requestDetails([reported, pending])?.time, 2_000, "stream end precedes any tool execution completion");
  assert.equal(requestDetails([{ ...reported, time: { created: 1_000, completed: 3_000 } }])?.time, 3_000);
  assert.equal(requestDetails([{ ...reported, time: { created: 1_000 } }])?.time, 1_000);
  for (const invalid of [NaN, Infinity, -Infinity, -1, Number.MAX_VALUE]) {
    assert.equal(requestDetails([{ ...reported, time: { created: 1_000, streamed: invalid, completed: 3_000 } }])?.time, 3_000);
    assert.equal(requestDetails([{ ...reported, time: { created: 1_000, streamed: invalid, completed: invalid } }])?.time, 1_000);
    const request = requestDetails([{ ...reported, time: { created: invalid } }]);
    assert.equal(request?.time, undefined);
    assert.equal(request?.total, 100, "invalid time does not hide reported usage");
  }
  assert.equal(requestDetails([{ ...reported, time: { created: 0 } }])?.time, 0);
  const withoutTime = requestDetails([{ id: "a", type: "assistant", tokens: { input: 100 } }]);
  assert.equal(withoutTime?.time, undefined);
  assert.equal(withoutTime?.total, 100);
});

test("request details apply compaction and revert boundaries independently of the context limit", () => {
  const history: UsageMessage[] = [
    { id: "a", type: "assistant", tokens: { input: 100 }, time: { created: 1_000 } },
    { id: "b", type: "compaction", status: "completed", tokens: { input: 900 }, time: { created: 2_000 } },
    { id: "c", type: "user" },
    { id: "d", type: "assistant", tokens: { input: 200 }, time: { created: 3_000 } },
    { id: "e", type: "assistant", time: { created: 4_000 } },
  ];
  assert.equal(requestDetails(history)?.total, 200);
  assert.equal(requestDetails(history)?.time, 3_000);
  assert.equal(requestDetails(history, "d"), undefined, "no reported call after the completed compaction");
  assert.equal(requestDetails(history, "c"), undefined);
  assert.equal(requestDetails(history, "b")?.time, 1_000, "a reverted compaction is excluded");
  assert.equal(requestDetails(history, "bb"), undefined, "an absent revert marker still cuts off later IDs");
  assert.equal(requestDetails(history, "a"), undefined);
  assert.equal(requestDetails([]), undefined);
  assert.equal(requestDetails([{ id: "u", type: "user", tokens: { input: 100 } }]), undefined);
  for (const status of ["running", "failed"]) {
    assert.equal(requestDetails([history[0]!, { ...history[1]!, status }])?.time, 1_000);
  }
});

test("unusable context limits and missing usage hide the context rows", () => {
  const messages: UsageMessage[] = [{ id: "a", type: "assistant", tokens: { input: 100 } }];
  for (const limit of [undefined, 0, -1, NaN, Infinity]) assert.equal(contextUsage(messages, limit), undefined);
  const rows = usageRows(summarize(messages), contextUsage(messages, undefined));
  assert.equal(rows.length, 8);
  assert.ok(!rows.some(([label]) => label === "Context"));
  assert.deepEqual(rows.find(([label]) => label === "Est. Cost"), ["Est. Cost", "—"]);
});

test("percentage may exceed the window and stays inline", () => {
  const usage = contextUsage([{ id: "a", type: "assistant", tokens: { input: 200 } }], 100);
  assert.equal(usage?.percent, 200);
  assert.deepEqual(usageRows(summarize([]), usage)[0], ["Context", "200 / 100 (200.0%)"]);
});

test("performance rows follow usage, mark live TPS estimates and hide unavailable metrics", () => {
  const summary = summarize([]);
  const context = { used: 50, limit: 100, percent: 50 };
  const rows = usageRows(summary, context, { tps: 48.74, tpsEstimated: true, ttft: 2_650 });
  assert.deepEqual(rows.slice(-3), [
    ["Total", "0"],
    ["TPS", "~48.7 tok/s"],
    ["TTFT", "2.6s"],
  ]);
  assert.deepEqual(rows[0], ["Context", "50 / 100 (50.0%)"]);
  assert.deepEqual(usageRows(summary, undefined, { tps: 12.04 }).slice(-2), [
    ["Total", "0"], ["TPS", "12.0 tok/s"],
  ]);
  assert.deepEqual(usageRows(summary, undefined, { ttft: 1_250 }).slice(-2), [
    ["Total", "0"], ["TTFT", "1.3s"],
  ]);
  assert.ok(!usageRows(summary, undefined, {}).some(([label]) => label === "TPS" || label === "TTFT"));
});

test("runtime keeps native millisecond/second precision and readable minutes/hours; unknown and stale are not zero", () => {
  for (const [milliseconds, expected, compact] of [
    [0, "0s", "0s"], [999, "999ms", "999ms"], [1_600, "1.6s", "1.6s"], [59_999, "60.0s", "60.0s"],
    [60_000, "1m 00s", "1m0s"], [318_999, "5m 18s", "5m18s"],
    [3_723_000, "1h 02m 03s", "1h2m3s"], [90_061_000, "25h 01m 01s", "25h1m1s"],
  ] as const) {
    assert.equal(formatDuration(milliseconds), expected);
    assert.equal(formatDuration(milliseconds, true), compact);
  }
  for (const invalid of [NaN, Infinity, -1]) assert.equal(formatDuration(invalid), "—");
  assert.equal(formatRunTime(), "—");
  assert.equal(formatRunTime({ status: "unavailable" }), "—");
  assert.equal(formatRunTime({ status: "ready", milliseconds: 60_000 }), "1m 00s");
  assert.equal(formatRunTime({ status: "stale", milliseconds: 60_000 }), "1m 00s · Not updated");
  assert.equal(formatRunTime({ status: "stale", milliseconds: 60_000 }, true), "1m0s · stale");
});

test("runtime display hides only confirmed zero totals in both formats", () => {
  for (const compact of [false, true]) {
    assert.equal(formatRunTime({ status: "ready", milliseconds: 0 }, compact), undefined);
    for (const milliseconds of [1, 999, 1_000]) {
      assert.equal(formatRunTime({ status: "ready", milliseconds }, compact), formatDuration(milliseconds, compact));
    }
    for (const milliseconds of [NaN, Infinity, -1]) {
      assert.equal(formatRunTime({ status: "ready", milliseconds }, compact), "—");
    }
    for (const status of ["loading", "ready", "unavailable", "stale"] as const) {
      assert.equal(formatRunTime({ status }, compact), "—");
    }
    assert.equal(formatRunTime({ status: "stale", milliseconds: 0 }, compact), `0s · ${compact ? "stale" : "Not updated"}`);
  }
});

test("runtime projections use ~, reveal the first nonzero turn and keep frozen freshness markers", () => {
  for (const compact of [false, true]) {
    const runtime = { status: "ready" as const, milliseconds: 0, estimatedMilliseconds: 1_500 };
    assert.equal(formatRunTime(runtime, compact), "~1.5s");
    assert.equal(formatRunTime({ ...runtime, estimatedMilliseconds: 0 }, compact), undefined);
    assert.equal(formatRunTime({ ...runtime, status: "stale" }, compact), `~1.5s · ${compact ? "stale" : "Not updated"}`);
    assert.equal(formatRunTime({ status: "unavailable", estimatedMilliseconds: 1_500 }, compact), "—");
    assert.equal(formatRunTime({ ...runtime, estimatedMilliseconds: NaN }, compact), "—");
    assert.deepEqual(runtime, { status: "ready", milliseconds: 0, estimatedMilliseconds: 1_500 });
  }
  assert.deepEqual(usageRows(summarize([]), undefined, { tps: 10 }, {
    status: "ready", milliseconds: 0, estimatedMilliseconds: 1_500,
  }).slice(-2), [["TPS", "10.0 tok/s"], ["Run Time", "~1.5s"]]);
});

test("runtime is the last panel row without changing token or performance rows", () => {
  const summary = summarize([]);
  const context = { used: 50, limit: 100, percent: 50 };
  const rows = usageRows(summary, context, { tps: 10, ttft: 2_000 }, { status: "ready", milliseconds: 318_000 });
  assert.deepEqual(rows[0], ["Context", "50 / 100 (50.0%)"]);
  assert.deepEqual(rows.slice(-4), [["Total", "0"], ["TPS", "10.0 tok/s"], ["TTFT", "2.0s"], ["Run Time", "5m 18s"]]);
  for (const performance of [{ tps: 10 }, { ttft: 2_000 }, {}, { tps: NaN, ttft: Infinity }]) {
    const withRuntime = usageRows(summary, context, performance, { status: "ready", milliseconds: 318_000 });
    assert.deepEqual(withRuntime.slice(0, -1), usageRows(summary, context, performance));
    assert.deepEqual(withRuntime.at(-1), ["Run Time", "5m 18s"]);
  }
  assert.deepEqual(usageRows(summary, undefined, undefined, { status: "unavailable" }).at(-1), ["Run Time", "—"]);
});

test("panels omit the entire zero runtime row without changing other metrics", () => {
  const summary = summarize([]);
  for (const context of [undefined, { used: 50, limit: 100, percent: 50 }]) {
    for (const performance of [undefined, { tps: 10 }, { ttft: 2_000 }, { tps: 10, ttft: 2_000 }]) {
      assert.deepEqual(usageRows(summary, context, performance, { status: "ready", milliseconds: 0 }), usageRows(summary, context, performance));
    }
  }
  assert.deepEqual(usageRows(summary, undefined, undefined, { status: "ready", milliseconds: 1 }).at(-1), ["Run Time", "1ms"]);
  assert.deepEqual(usageRows(summary, undefined, undefined, { status: "stale", milliseconds: 0 }).at(-1), ["Run Time", "0s · Not updated"]);
});

test("child summary retains session-local time on narrow terminals without extra lines", () => {
  const fields = [
    ["Context", "1,270 / 128,000 (1.0%)"], ["Total", "5,080"], ["Cost", "$0.005"],
    ["Time", "5m18s"], ["TPS", "48.7 tok/s"],
  ] as const;
  assert.equal(fitUsageSummary(fields, 160), "Token Usage · Context 1,270 / 128,000 (1.0%) · Total 5,080 · Cost $0.005 · Time 5m18s · TPS 48.7 tok/s");
  for (const width of [100, 80, 48, 32, 20]) {
    const line = fitUsageSummary(fields, width);
    assert.ok(line.length <= width, `summary fits ${width} columns`);
    assert.match(line, /Time 5m18s/);
    assert.doesNotMatch(line, /\n/);
  }
  assert.match(fitUsageSummary(fields, 160, true), /Not updated$/);
});

test("child summaries retain live time and freshness markers without running labels", () => {
  for (const [runtime, expected] of [
    [{ status: "ready", milliseconds: 318_000, estimatedMilliseconds: 319_500 }, "~5m19s"],
    [{ status: "stale", milliseconds: 318_000, estimatedMilliseconds: 319_500 }, "~5m19s · stale"],
    [{ status: "unavailable" }, "—"],
    [{ status: "stale", milliseconds: 0 }, "0s · stale"],
  ] as const) {
    const fields = [
      ["Context", "—"], ["Total", "5,080"], ["Cost", "$0.005"],
      ["Time", formatRunTime(runtime, true)], ["TPS", "48.7 tok/s"],
    ] as const;
    assert.equal(fitUsageSummary(fields, 160), `Token Usage · Context — · Total 5,080 · Cost $0.005 · Time ${expected} · TPS 48.7 tok/s`);
    for (const width of [100, 80, 48, 40, 32, 20]) {
      const line = fitUsageSummary(fields, width);
      assert.ok(line.length <= width, `summary fits ${width} columns`);
      assert.ok(line.includes(`Time ${expected}`));
      assert.doesNotMatch(line, /Running\.|\n|undefined/);
    }
  }
});

test("child summary omits zero runtime without empty separators or losing all metrics on narrow terminals", () => {
  const fields = [
    ["Context", "—"], ["Total", "0"], ["Cost", "—"],
    ["Time", formatRunTime({ status: "ready", milliseconds: 0 }, true)], ["TPS", "—"],
  ] as const;
  assert.equal(fitUsageSummary(fields, 160), "Token Usage · Context — · Total 0 · Cost — · TPS —");
  for (const width of [80, 48, 32, 20]) {
    const line = fitUsageSummary(fields, width);
    assert.ok(line.length <= width, `summary fits ${width} columns`);
    assert.match(line, /Total 0/);
    assert.doesNotMatch(line, /Time|undefined|\n|·\s*·|·\s*$/);
  }
  assert.equal(fitUsageSummary(fields, 20), "Usage · Total 0");
  assert.equal(fitUsageSummary(fields, 20, true), "Total 0 · stale");
  assert.equal(fitUsageSummary([["Time", undefined]], 160), "Token Usage");
  assert.equal(fitUsageSummary([["Time", "—"]], 160), "Token Usage · Time —");
  assert.equal(fitUsageSummary([["Time", formatRunTime({ status: "stale", milliseconds: 0 }, true)]], 160), "Token Usage · Time 0s · stale");
});
