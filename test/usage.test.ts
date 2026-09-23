import assert from "node:assert/strict";
import { test } from "node:test";
import { contextUsage, estimate, formatCost, formatTokens, modelKey, normalize, summarize, usageRows } from "../src/usage.js";
import type { Price, UsageMessage } from "../src/usage.js";

const price: Price = { input: 2, output: 8, cache: { read: 0.2, write: 3 } };
const model = { providerID: "test", id: "model" };
const catalog = (prices: readonly Price[] = [price]) => new Map([[modelKey(model), prices]]);
const priced = (message: UsageMessage): UsageMessage => ({ ...message, model });

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
  assert.ok(!usageRows(empty).some(([label]) => label === "Cost"));
  assert.equal(usageRows().length, 7);
  assert.ok(usageRows().every(([, value]) => value === "—"));
});

test("cache write stays conditional while confirmed free cost displays as zero", () => {
  const paidWithoutCache = summarize([
    priced({ id: "paid", type: "assistant", tokens: { input: 100 } }),
  ], catalog());
  assert.ok(!usageRows(paidWithoutCache).some(([label]) => label === "Cache Write"));
  assert.equal(usageRows(paidWithoutCache).find(([label]) => label === "Cost")?.[1], "<$0.01");

  const freePrice: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } };
  const freeWithCache = summarize([
    { id: "free", type: "assistant", model, tokens: { cache: { write: 100 } } },
  ], catalog([freePrice]));
  assert.equal(usageRows(freeWithCache).find(([label]) => label === "Cache Write")?.[1], "100");
  assert.equal(usageRows(freeWithCache).find(([label]) => label === "Cost")?.[1], "$0.00");
});

test("ordinary, cache, and reasoning prices are per million tokens", () => {
  assert.equal(estimate(normalize({ input: 1_000_000 }), [price]).cost, 2);
  assert.equal(estimate(normalize({ output: 1_000_000, reasoning: 500_000 }), [price]).cost, 12);
  assert.equal(estimate(normalize({ cache: { read: 1_000_000, write: 1_000_000 } }), [price]).cost, 3.2);
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
  const complete = summarize([usage]);
  assert.equal(complete.cost, 0.4);
  assert.equal(complete.costStatus, "complete");
  assert.equal(usageRows(complete).find(([label]) => label === "Cost")?.[1], "$0.40");

  const runtime = new Map([[modelKey(officialModel), [{ input: 3 }]]]);
  assert.equal(summarize([usage], runtime).cost, 3);

  const unavailable = summarize([{ id: "missing", type: "assistant", model: { providerID: "test", id: "unknown" }, tokens: { input: 10 } }]);
  assert.equal(unavailable.costStatus, "unavailable");
  assert.equal(usageRows(unavailable).find(([label]) => label === "Cost")?.[1], "—");

  const partial = summarize([
    usage,
    { id: "missing", type: "assistant", model: { providerID: "test", id: "unknown" }, tokens: { input: 10 } },
  ]);
  assert.equal(partial.cost, 0.4);
  assert.equal(partial.costStatus, "partial");
  assert.equal(usageRows(partial).find(([label]) => label === "Cost")?.[1], "$0.40 · partial");
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

test("incomplete OpenCode prices fall back as a whole and complete zero prices use the snapshot", () => {
  const officialModel = { providerID: "gateway", id: "gpt-5.6-luna" };
  const usage: UsageMessage = { id: "fallback", type: "compaction", model: officialModel, tokens: { input: 1_000_000, output: 1_000_000 } };
  const incomplete = new Map([[modelKey(officialModel), [{ input: 9 }]]]);
  assert.equal(summarize([usage], incomplete).cost, 2.2);
  const free = new Map([[modelKey(officialModel), [{ input: 0, output: 0 }]]]);
  assert.equal(summarize([usage], free).cost, 2.2);
  assert.equal(summarize([usage], free).costStatus, "complete");
});

test("a complete OpenCode zero yields to a complete snapshot price only", () => {
  const model = { providerID: "gateway", id: "gpt-5.6-luna" };
  const usage: UsageMessage = { id: "zero", type: "assistant", model, tokens: { input: 1_000_000 } };
  const freeRuntime = new Map([[modelKey(model), [{ input: 0 }]]]);
  assert.equal(summarize([usage], freeRuntime).cost, 0.4);
  assert.equal(summarize([usage], freeRuntime).costStatus, "complete");

  const paidRuntime = new Map([[modelKey(model), [{ input: 3 }]]]);
  assert.equal(summarize([usage], paidRuntime).cost, 3);

  const cacheModel = { providerID: "gateway", id: "mimo-v2.6-flash" };
  const cacheUsage: UsageMessage = {
    id: "unpriced-cache-write", type: "assistant", model: cacheModel, tokens: { cache: { write: 1_000_000 } },
  };
  const freeCacheWrite = new Map([[modelKey(cacheModel), [{ cache: { write: 0 } }]]]);
  assert.equal(summarize([cacheUsage], freeCacheWrite).cost, 0);
  assert.equal(summarize([cacheUsage], freeCacheWrite).costStatus, "complete");
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
  assert.equal(usageRows(summary).find(([label]) => label === "Cost")?.[1], "$0.00");
});

test("Muse Spark Contributor snapshot prices replace OpenCode's complete free rate", () => {
  const model = { providerID: "opencode", id: "muse-spark-1.3-contributor-free" };
  const freePrice: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } };
  const summary = summarize([{
    id: "contributor", type: "assistant", model,
    tokens: { input: 1_000_000, output: 1_000_000 },
  }], new Map([[modelKey(model), [freePrice]]]));
  assert.equal(summary.cost, 0.3);
  assert.equal(summary.costStatus, "complete");
  assert.equal(usageRows(summary).find(([label]) => label === "Cost")?.[1], "$0.30");
});

test("comma grouping, rounding boundaries and dollar display", () => {
  for (const [number, expected] of [
    [0, "0"], [999, "999"], [1000, "1,000"], [1200, "1,200"], [125000, "125,000"],
    [999949, "999,949"], [999950, "999,950"], [999999, "999,999"],
    [1_000_000, "1,000,000"], [1_500_000, "1,500,000"],
    [1200.4, "1,200"], [1200.5, "1,201"],
  ] as const) assert.equal(formatTokens(number), expected);
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.00001), "<$0.01");
  assert.equal(formatCost(0.01), "$0.01");
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
    ["Cost", "$0.22"],
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

test("unusable context limits and missing usage hide the context rows", () => {
  const messages: UsageMessage[] = [{ id: "a", type: "assistant", tokens: { input: 100 } }];
  for (const limit of [undefined, 0, -1, NaN, Infinity]) assert.equal(contextUsage(messages, limit), undefined);
  const rows = usageRows(summarize(messages), contextUsage(messages, undefined));
  assert.equal(rows.length, 8);
  assert.ok(!rows.some(([label]) => label === "Context"));
  assert.deepEqual(rows.find(([label]) => label === "Cost"), ["Cost", "—"]);
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
