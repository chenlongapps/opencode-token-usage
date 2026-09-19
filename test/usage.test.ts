import assert from "node:assert/strict";
import { test } from "node:test";
import { estimate, formatCost, formatTokens, normalize, summarize, usageRows } from "../src/usage.js";
import type { Price } from "../src/usage.js";

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

test("zero input, missing and invalid fields, all rows stay visible", () => {
  assert.deepEqual(normalize({ input: NaN, output: -10, reasoning: Infinity, cache: { read: 5 } }), {
    input: 0, output: 0, reasoning: 0, cache: { read: 5, write: 0 },
  });
  const empty = summarize([], [price]);
  assert.equal(empty.cacheRate, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.cost, 0);
  assert.equal(usageRows(empty).length, 8);
  assert.equal(usageRows(empty)[5]?.[1], "0.0%");
  assert.ok(usageRows().every(([, value]) => value === "—"));
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

test("roadmap examples, K/M rounding boundaries and dollar display", () => {
  for (const [number, expected] of [
    [0, "0"], [999, "999"], [1000, "1K"], [1200, "1.2K"], [125000, "125K"],
    [999949, "999.9K"], [999950, "1M"], [1_000_000, "1M"], [1_500_000, "1.5M"],
  ] as const) assert.equal(formatTokens(number), expected);
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.00001), "<$0.01");
  assert.equal(formatCost(0.01), "$0.01");
  assert.equal(formatCost(1.234), "$1.23");
});
