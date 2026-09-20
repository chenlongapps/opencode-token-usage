import assert from "node:assert/strict";
import { test } from "node:test";
import { contextUsage, estimate, formatCost, formatTokens, normalize, summarize, usageRows } from "../src/usage.js";
import type { Price, UsageMessage } from "../src/usage.js";

const price: Price = { input: 2, output: 8, cache: { read: 0.2, write: 3 } };

test("five disjoint categories, total, cache rate, and message types", () => {
  const value = summarize([
    { id: "a", type: "assistant", tokens: { input: 200, output: 30, reasoning: 10, cache: { read: 600, write: 200 } } },
    { id: "c", type: "compaction", tokens: { input: 100, output: 20 } },
    { id: "u", type: "user", tokens: { input: 99_000 } },
    { id: "in-progress", type: "assistant" },
  ], [price]);
  assert.deepEqual(value.tokens, { input: 300, output: 50, reasoning: 10, cache: { read: 600, write: 200 } });
  assert.equal(value.total, 1160);
  assert.equal(value.cacheRate, 600 / 1100);
  assert.equal(usageRows(value).find(([label]) => label === "Cache Rate")?.[1], "54.5%");
  assert.ok(Math.abs(value.cost - 0.0018) < 1e-12);
});

test("zero input, missing and invalid fields hide zero-value rows", () => {
  assert.deepEqual(normalize({ input: NaN, output: -10, reasoning: Infinity, cache: { read: 5 } }), {
    input: 0, output: 0, reasoning: 0, cache: { read: 5, write: 0 },
  });
  const empty = summarize([], [price]);
  assert.equal(empty.cacheRate, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.cost, 0);
  assert.equal(usageRows(empty).length, 6);
  assert.equal(usageRows(empty).find(([label]) => label === "Cache Rate")?.[1], "0.0%");
  assert.ok(!usageRows(empty).some(([label]) => label === "Cache Write"));
  assert.ok(!usageRows(empty).some(([label]) => label === "Cost"));
  assert.equal(usageRows().length, 6);
  assert.ok(usageRows().every(([, value]) => value === "—"));
});

test("cache write and cost rows are hidden independently when zero", () => {
  const paidWithoutCache = summarize([
    { id: "paid", type: "assistant", tokens: { input: 100 } },
  ], [price]);
  assert.ok(!usageRows(paidWithoutCache).some(([label]) => label === "Cache Write"));
  assert.equal(usageRows(paidWithoutCache).find(([label]) => label === "Cost")?.[1], "<$0.01");

  const freeWithCache = summarize([
    { id: "free", type: "assistant", tokens: { cache: { write: 100 } } },
  ], [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]);
  assert.equal(usageRows(freeWithCache).find(([label]) => label === "Cache Write")?.[1], "100");
  assert.ok(!usageRows(freeWithCache).some(([label]) => label === "Cost"));
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
  assert.equal(summarize([1, 2].map(id => ({ id: String(id), type: "assistant", tokens: { input: 100 } })), tiers).cost, 0.0004);
});

test("free prices are distinct from missing prices and absent applicable tiers", () => {
  const tokens = normalize({ input: 10, output: 10 });
  assert.deepEqual(estimate(tokens, [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]), { cost: 0, defaultPrice: false });
  assert.deepEqual(estimate(tokens), { cost: 0, defaultPrice: true });
  assert.deepEqual(estimate(tokens, [{ ...price, tier: { type: "context", size: 100 } }]), { cost: 0, defaultPrice: true });
  assert.deepEqual(estimate(tokens, [{ input: 2, output: NaN }]), { cost: 0.00002, defaultPrice: true });
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
  assert.deepEqual(usageRows(summarize(messages, [price]), usage), [
    ["Context", "72,400 / 128,000 (56.6%)"],
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
  const rows = usageRows(summarize(messages, []), contextUsage(messages, undefined));
  assert.equal(rows.length, 6);
  assert.ok(!rows.some(([label]) => label === "Context"));
});

test("percentage may exceed the window and stays inline", () => {
  const usage = contextUsage([{ id: "a", type: "assistant", tokens: { input: 200 } }], 100);
  assert.equal(usage?.percent, 200);
  assert.deepEqual(usageRows(summarize([], []), usage)[0], ["Context", "200 / 100 (200.0%)"]);
});

test("performance rows follow usage, mark live TPS estimates and hide unavailable metrics", () => {
  const summary = summarize([], []);
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
