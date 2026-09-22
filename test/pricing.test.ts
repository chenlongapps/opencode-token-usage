import assert from "node:assert/strict";
import { test } from "node:test";
import { OFFICIAL_PRICE_SNAPSHOT, officialPrice } from "../src/pricing.js";
import { estimate, normalize } from "../src/usage.js";

test("official snapshot contains only verified recent releases and unique identifiers", () => {
  const aliases = new Set<string>();
  assert.equal(OFFICIAL_PRICE_SNAPSHOT.entries.length, 74);
  for (const entry of OFFICIAL_PRICE_SNAPSHOT.entries) {
    assert.ok(entry.released >= OFFICIAL_PRICE_SNAPSHOT.newModelCutoff);
    assert.ok(entry.released <= OFFICIAL_PRICE_SNAPSHOT.verified);
    assert.match(entry.source, /^https:\/\//);
    assert.ok(entry.prices.length > 0);
    for (const id of [entry.id, ...(entry.aliases ?? [])]) {
      assert.ok(!aliases.has(id), `duplicate official model ID: ${id}`);
      aliases.add(id);
    }
  }
});

test("official price matching supports exact manufacturer IDs and known gateway wrappers", () => {
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-6-sol" })?.id, "gpt-6-sol");
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-6-luna" })?.id, "gpt-6-luna");
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-5.6-luna" })?.id, "gpt-5.6-luna");
  assert.equal(officialPrice({ providerID: "amazon-bedrock", id: "us.anthropic.claude-opus-5" })?.id, "claude-opus-5");
  assert.equal(officialPrice({ providerID: "google-vertex", id: "claude-fable-5@default" })?.id, "claude-fable-5");
  assert.equal(officialPrice({ providerID: "openrouter", id: "mistralai/mistral-medium-3-5" })?.id, "mistral-medium-3-5-26-04");
  // Gateway slugs that differ from the manufacturer ID only by separators or an
  // official alias resolve to the same entry.
  assert.equal(officialPrice({ providerID: "openrouter", id: "anthropic/claude-opus-4.7" })?.id, "claude-opus-4-7");
  assert.equal(officialPrice({ providerID: "openrouter", id: "anthropic/claude-opus-4.8" })?.id, "claude-opus-4-8");
  assert.equal(officialPrice({ providerID: "openrouter", id: "anthropic/claude-opus-5.5" })?.id, "claude-opus-5-5");
  assert.equal(officialPrice({ providerID: "amazon-bedrock", id: "anthropic.claude-opus-5-5" })?.id, "claude-opus-5-5");
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-chat-latest" })?.id, "chat-latest");
  assert.equal(officialPrice({ providerID: "openrouter", id: "qwen/qwen3.8-max-0902" })?.id, "qwen3.8-max");
});

test("official price matching covers every major vendor in the OpenCode catalog", () => {
  assert.equal(officialPrice({ providerID: "openrouter", id: "z-ai/glm-5.3-flashx" })?.id, "glm-5.3-flashx");
  assert.equal(officialPrice({ providerID: "openrouter", id: "z-ai/glm-5.1" })?.id, "glm-5.1");
  assert.equal(officialPrice({ providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash" })?.id, "deepseek-v4.1-flash");
  assert.equal(officialPrice({ providerID: "openrouter", id: "deepseek/deepseek-v4-flash-0731" })?.id, "deepseek-v4.1-flash");
  assert.equal(officialPrice({ providerID: "openrouter", id: "deepseek/deepseek-v4-flash-vision-exp" })?.id, "deepseek-v4.1-flash");
  assert.equal(officialPrice({ providerID: "openrouter", id: "deepseek/deepseek-v4-pro-0813" })?.id, "deepseek-v4-pro-0813");
  assert.equal(officialPrice({ providerID: "openrouter", id: "moonshotai/kimi-k3" })?.id, "kimi-k3");
  assert.equal(officialPrice({ providerID: "openrouter", id: "moonshotai/kimi-k2.6" })?.id, "kimi-k2.6");
  assert.equal(officialPrice({ providerID: "openrouter", id: "qwen/qwen3.8-max" })?.id, "qwen3.8-max");
  assert.equal(officialPrice({ providerID: "openrouter", id: "qwen/qwen3.6-35b-a3b" })?.id, "qwen3.6-35b-a3b");
  assert.equal(officialPrice({ providerID: "openrouter", id: "xiaomi/mimo-v2.6-pro-ultraspeed" })?.id, "mimo-v2.6-pro-ultraspeed");
  assert.equal(officialPrice({ providerID: "openrouter", id: "minimax/minimax-m3" })?.id, "minimax-m3");
  assert.equal(officialPrice({ providerID: "openrouter", id: "tencent/hy3" })?.id, "hy3");
  assert.equal(officialPrice({ providerID: "openrouter", id: "tencent/hy4-preview" })?.id, "hy4-preview");
  assert.equal(officialPrice({ providerID: "openrouter", id: "stepfun/step-5-preview" })?.id, "step-5-preview");
  assert.equal(officialPrice({ providerID: "openrouter", id: "stepfun/step-3.7-flash" })?.id, "step-3.7-flash");
  assert.equal(officialPrice({ providerID: "openrouter", id: "meta/muse-spark-1.3" })?.id, "muse-spark-1.3");
  assert.equal(officialPrice({ providerID: "openrouter", id: "inception/mercury-2.5-preview" })?.id, "mercury-2.5");
  assert.equal(officialPrice({ providerID: "openrouter", id: "upstage/solar-pro4" })?.id, "solar-pro4");
  assert.equal(officialPrice({ providerID: "openrouter", id: "arcee-ai/trinity-large-thinking" })?.id, "trinity-large-thinking");
  assert.equal(officialPrice({ providerID: "openrouter", id: "bytedance-seed/seed-2-1-turbo" })?.id, "dola-seed-2-1-turbo");
  assert.equal(officialPrice({ providerID: "openrouter", id: "sakana/fugu-ultra-v2" })?.id, "fugu-ultra-v2.0");
  assert.equal(officialPrice({ providerID: "openrouter", id: "sakana/fugu-max" })?.id, "fugu-max-v1.0");
  assert.equal(officialPrice({ providerID: "openrouter", id: "aion-labs/aion-3.0" })?.id, "aion-3.0");
  assert.equal(officialPrice({ providerID: "openrouter", id: "aion-labs/aion-3.0-mini" })?.id, "aion-3.0-mini");
  assert.equal(officialPrice({ providerID: "openrouter", id: "meituan/longcat-2.0" })?.id, "longcat-2.0");
});

test("official price matching never guesses similarly named variants", () => {
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-6-sol-pro" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-6-luna-fast" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "openai/gpt-5.6-luna-pro" }), undefined);
  assert.equal(officialPrice({ providerID: "custom", id: "prefix-gpt-5.6-luna" }), undefined);
  assert.equal(officialPrice({ providerID: "custom", id: "unknown" }), undefined);
  // Documented exclusions: out-of-window, fast-tier, unverified, and
  // similarly named models without a confirmable official standard price.
  assert.equal(officialPrice({ providerID: "openrouter", id: "x-ai/grok-4.20" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "anthropic/claude-opus-5-fast" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "z-ai/glm-5v-turbo" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "tencent/hy3-preview" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "cohere/north-mini-code" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "google/gemma-4-31b-it" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "kwaipilot/kat-coder-pro-v2.5" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "inclusionai/ling-3.0-flash" }), undefined);
  assert.equal(officialPrice({ providerID: "openrouter", id: "bytedance-seed/seed-2.0-code" }), undefined);
});

test("official long-context boundaries match manufacturer thresholds", () => {
  for (const id of ["gpt-5.5", "gpt-5.5-pro", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
    "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
    const openai = officialPrice({ providerID: "openai", id })!;
    assert.equal(openai.prices[1]?.tier?.size, 272_000, id);
  }
  const xai = officialPrice({ providerID: "xai", id: "grok-4.7" })!;
  assert.equal(xai.prices[1]?.tier?.size, 199_999);
  // "256K<Token≤1M" starts the higher tier at 256,001 incoming tokens, and
  // MiniMax bills "> 512k input tokens" from 512,001.
  const qwen = officialPrice({ providerID: "openrouter", id: "qwen/qwen3.7-plus" })!;
  const minimax = officialPrice({ providerID: "openrouter", id: "minimax/minimax-m3" })!;
  assert.equal(qwen.prices[1]?.tier?.size, 256_000);
  assert.equal(minimax.prices[1]?.tier?.size, 512_000);
  const qwenFlash = officialPrice({ providerID: "openrouter", id: "qwen/qwen3.7-flash" })!;
  assert.deepEqual(qwenFlash.prices.map(price => price.tier?.size), [undefined, 32_000, 256_000]);
  const fugu = officialPrice({ providerID: "openrouter", id: "sakana/fugu-ultra-v2" })!;
  assert.equal(fugu.prices[1]?.tier?.size, 271_999);
});

test("GPT-6 Sol and Luna use official standard rates above 272K input tokens", () => {
  const cases = [
    { id: "gpt-6-sol", short: { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
      long: { tier: { type: "context" as const, size: 272_000 }, input: 4, output: 15, cache: { read: 0.4, write: 5 } } },
    { id: "gpt-6-luna", short: { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
      long: { tier: { type: "context" as const, size: 272_000 }, input: 0.2, output: 0.75, cache: { read: 0.02, write: 0.25 } } },
  ];
  for (const { id, short, long } of cases) {
    const entry = officialPrice({ providerID: "openai", id })!;
    assert.equal(entry.released, "2026-09-22");
    assert.deepEqual(entry.prices, [short, long]);
    assert.equal(estimate(normalize({ input: 272_000 }), entry.prices).cost, 272_000 * short.input / 1_000_000);
    assert.equal(estimate(normalize({ input: 272_001 }), entry.prices).cost, 272_001 * long.input / 1_000_000);
  }
});

test("DeepSeek V4 uses the official peak rates as a conservative upper bound", () => {
  const flash = officialPrice({ providerID: "deepseek", id: "deepseek-v4-flash" })!;
  const pro = officialPrice({ providerID: "deepseek", id: "deepseek-v4-pro" })!;
  assert.deepEqual(flash.prices, [{ input: 0.3, output: 1.2, cache: { read: 0.006 } }]);
  assert.deepEqual(pro.prices, [{ input: 1.32, output: 3.96, cache: { read: 0.044 } }]);
});

test("Step 5 Preview uses official token rates and the documented blended price", () => {
  const entry = officialPrice({ providerID: "stepfun", id: "step-5-preview" })!;
  assert.deepEqual(entry.prices, [{ input: 1, output: 2.7, cache: { read: 0.05, write: 1 } }]);
  const price = entry.prices[0]!;
  const blended = (7 * price.cache!.read! + 2 * price.input! + price.output!) / 10;
  assert.ok(Math.abs(blended - 0.505) < Number.EPSILON);
});

test("Claude Opus 5.5 uses the official standard rates with the 5% cache-read multiplier", () => {
  const entry = officialPrice({ providerID: "anthropic", id: "claude-opus-5-5" })!;
  assert.equal(entry.released, "2026-09-22");
  assert.deepEqual(entry.prices, [{ input: 4, output: 20, cache: { read: 0.2, write: 5 } }]);
  // The official page prices cache hits at 0.05x the base input price for
  // Claude Opus 5.5 instead of the standard 0.1x multiplier.
  assert.ok(Math.abs(entry.prices[0]!.cache!.read! - 0.05 * entry.prices[0]!.input!) < Number.EPSILON);
});

test("new manufacturer entries use recorded manufacturer rates", () => {
  assert.deepEqual(officialPrice({ providerID: "meta", id: "muse-spark-1.3" })?.prices, [
    { input: 1.25, output: 4.25, cache: { read: 0.15 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "inception", id: "mercury-2.5" })?.prices, [
    { input: 0.04, output: 0.15, cache: { read: 0.004 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "upstage", id: "solar-pro4" })?.prices, [
    { input: 0.3, output: 1.2, cache: { read: 0.06 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "arcee-ai", id: "trinity-large-thinking" })?.prices, [
    { input: 0.25, output: 0.8, cache: { read: 0.06 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "bytedance-seed", id: "dola-seed-2-1-turbo" })?.prices, [
    { input: 0.5, output: 2.5, cache: { read: 0.1 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "sakana", id: "fugu-max-v1.0" })?.prices, [
    { input: 2, output: 6, cache: { read: 0.25 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "aion-labs", id: "aion-3.0" })?.prices, [
    { input: 3, output: 6, cache: { read: 0.75 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "aion-labs", id: "aion-3.0-mini" })?.prices, [
    { input: 0.7, output: 1.4, cache: { read: 0.18 } },
  ]);
  assert.deepEqual(officialPrice({ providerID: "meituan", id: "longcat-2.0" })?.prices, [
    { input: 0.3, output: 1.2, cache: { read: 0.006 } },
  ]);
});
