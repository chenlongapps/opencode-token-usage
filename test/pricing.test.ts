import assert from "node:assert/strict";
import { test } from "node:test";
import { fromModelsDev, renderSnapshot } from "../scripts/pricing-source.js";
import { ORIGINAL_PROVIDERS, PRICE_OVERRIDES } from "../src/overrides.js";
import { OFFICIAL_PRICE_SNAPSHOT, officialPrice } from "../src/pricing.js";
import type { OfficialPriceEntry } from "../src/pricing.js";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.js";
import { estimate, normalize } from "../src/usage.js";

const find = (providerID: string, id: string) => officialPrice({ providerID, id });

test("checked-in snapshot is first-party, reviewed exceptions stay separate, and identifiers are unique", () => {
  assert.equal(OFFICIAL_PRICE_SNAPSHOT.source, "https://models.dev/api.json");
  assert.match(OFFICIAL_PRICE_SNAPSHOT.verified, /^20\d{2}-\d\d-\d\d$/);
  assert.ok(GENERATED_PRICE_SNAPSHOT.entries.length > 200);
  const seen = new Set<string>();
  for (const raw of GENERATED_PRICE_SNAPSHOT.entries) {
    const entry: OfficialPriceEntry = { ...raw, source: GENERATED_PRICE_SNAPSHOT.source };
    const key = `${entry.providerID}/${entry.id}`;
    assert.ok(!seen.has(key), key);
    seen.add(key);
    assert.ok(ORIGINAL_PROVIDERS[entry.providerID]?.test(entry.id), key);
    assert.ok(entry.prices.length > 0, key);
    for (const rate of entry.prices) {
      if (!("input" in rate) && !("output" in rate)) {
        assert.ok(rate.tier && entry.providers?.includes(entry.providerID), key);
      } else {
        assert.ok(Number.isFinite(rate.input) && rate.input! >= 0, key);
        assert.ok(Number.isFinite(rate.output) && rate.output! >= 0, key);
      }
    }
  }
  for (const entry of PRICE_OVERRIDES) {
    assert.match(entry.source, /^https:\/\//);
    assert.ok(entry.reason.length > 0);
    assert.ok(entry.prices.length > 0);
  }
  assert.ok(OFFICIAL_PRICE_SNAPSHOT.entries.length >= GENERATED_PRICE_SNAPSHOT.entries.length);
});

test("manufacturer IDs, exact gateway wrappers, version aliases, and free suffixes resolve", () => {
  for (const [provider, id, expected] of [
    ["openai", "gpt-6-sol", "gpt-6-sol"],
    ["openrouter", "openai/gpt-6-sol", "gpt-6-sol"],
    ["amazon-bedrock", "us.anthropic.claude-opus-5", "claude-opus-5"],
    ["google-vertex", "claude-fable-5@default", "claude-fable-5"],
    ["openrouter", "anthropic/claude-opus-4.7", "claude-opus-4-7"],
    ["openrouter", "openai/gpt-chat-latest", "chat-latest"],
    ["openrouter", "mistralai/mistral-medium-3-5", "mistral-medium-2604"],
    ["openrouter", "z-ai/glm-5.3-flashx", "glm-5.3-flashx"],
    ["openrouter", "qwen/qwen3.8-max-0902", "qwen3.8-max"],
    ["openrouter", "moonshotai/kimi-k3", "kimi-k3"],
    ["openrouter", "meta/muse-spark-1.3:free", "muse-spark-1.3"],
    ["opencode", "muse-spark-1.3-contributor-free", "muse-spark-1.3-contributor"],
    ["openrouter", "deepseek/deepseek-v4-flash-0731", "deepseek-v4.1-flash"],
    ["openrouter", "xiaomi/mimo-v2.6-flash-free", "mimo-v2.6-flash"],
    ["openrouter", "sakana/fugu-ultra-v2", "fugu-ultra-v2.0"],
    ["openrouter", "arcee-ai/trinity-large-thinking", "trinity-large-thinking"],
    ["openrouter", "aion-labs/aion-3.0", "aion-3.0"],
    ["openrouter", "meituan/longcat-2.0", "longcat-2.0"],
    ["openrouter", "tencent/hy3", "hy3"],
    ["openrouter", "bytedance-seed/seed-2-1-turbo", "dola-seed-2-1-turbo"],
  ]) assert.equal(find(provider!, id!)?.id, expected, `${provider}/${id}`);
});

test("unrelated makers, unknown wrappers and similarly named modes never borrow a rate", () => {
  for (const [provider, id] of [
    ["openrouter", "openai/gpt-6-sol-pro"],
    ["openrouter", "openai/gpt-6-luna-fast"],
    ["openrouter", "anthropic/claude-opus-5-fast"],
    ["openrouter", "openai/gpt-6-sol-pro-free"],
    ["openrouter", "xiaomi/mimo-v2.6-flash-free-preview"],
    ["openrouter", "foo/gpt-6-sol"],
    ["custom", "prefix-gpt-6-sol"],
    ["alibaba", "kimi-k3"], // Alibaba hosts Kimi, but is not its manufacturer.
    ["mistral", "zai-glm-5-3"], // Mistral hosts Z.ai's models.
    ["opencode", "ling-3.0-flash-fin-free"],
    ["opencode", "nemotron-3-ultra-free"],
    ["openrouter", "google/gemma-4-31b-it"],
  ]) assert.equal(find(provider!, id!), undefined, `${provider}/${id}`);
});

test("tier boundaries, Fast restrictions, and first-party override rates remain precise", () => {
  const sol = find("openai", "gpt-6-sol")!;
  assert.deepEqual(sol.prices, [
    { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
    { tier: { type: "context", size: 272_000 }, input: 4, output: 15, cache: { read: 0.4, write: 5 } },
  ]);
  assert.equal(estimate(normalize({ input: 272_000 }), sol.prices).cost, 0.544);
  assert.equal(estimate(normalize({ input: 272_001 }), sol.prices).cost, 1.088004);
  const fast = find("openai", "gpt-5.5-fast")!;
  assert.equal(find("openrouter", "openai/gpt-5.5-fast"), undefined);
  assert.equal(estimate(normalize({ input: 272_000 }), fast.prices).defaultPrice, false);
  assert.equal(estimate(normalize({ input: 272_001 }), fast.prices).defaultPrice, true);
  assert.equal(find("anthropic", "claude-opus-5-5-fast")?.prices[0]?.input, 8);
  assert.equal(find("openrouter", "anthropic/claude-opus-5-5-fast"), undefined);

  const grok = find("xai", "grok-4.7")!;
  assert.equal(grok.prices[1]?.tier?.size, 199_999);
  assert.equal(estimate(normalize({ input: 200_000 }), grok.prices).cost, 0.8);
  const fugu = find("openrouter", "sakana/fugu-ultra-v2")!;
  assert.equal(fugu.prices[1]?.tier?.size, 271_999);
  assert.equal(find("deepseek", "deepseek-v4-flash")?.prices[0]?.input, 0.3);
  assert.equal(find("deepseek", "deepseek-v4-pro")?.prices[0]?.input, 1.32);
  assert.equal(find("stepfun-ai", "step-5-preview")?.prices[0]?.cache?.write, 1);
  assert.equal(find("zai", "glm-5.3")?.prices[0]?.cache?.write, undefined);
  assert.equal(find("alibaba", "qwen3.8-27b")?.prices[0]?.cache?.read, 0.1);
  assert.equal(find("alibaba", "qwen3.5-plus-2026-04-20")?.prices[1]?.tier?.size, 256_000);
  assert.equal(find("alibaba", "qwen3.7-plus")?.prices[0]?.cache?.write, undefined);
  assert.equal(find("opencode", "muse-spark-1.3-contributor-free")?.prices[0]?.input, 0.1);
});

function fixture() {
  const catalog: Record<string, { models: Record<string, unknown> }> = Object.fromEntries(
    Object.keys(ORIGINAL_PROVIDERS).map(id => [id, { models: {} }]),
  );
  const model = (id: string, cost: unknown, extra: Record<string, unknown> = {}) => ({
    id, modalities: { input: ["text"], output: ["text"] }, cost, release_date: "2026-09-20", ...extra,
  });
  catalog.openai!.models["gpt-example"] = model("gpt-example", {
    input: 1, output: 2, cache_read: 0.1,
    tiers: [{ input: 3, output: 4, cache_read: 0.3, tier: { type: "context", size: 272_000 } }],
  }, { experimental: { modes: { fast: { cost: { input: 2, output: 4, cache_read: 0.2 } } } } });
  catalog.alibaba!.models["kimi-k3"] = model("kimi-k3", { input: 999, output: 999 });
  catalog.alibaba!.models["qwen-reasoner"] = model("qwen-reasoner", { input: 1, output: 2, reasoning: 5 });
  catalog.xai!.models["grok-example"] = model("grok-example", {
    input: 1, output: 2, tiers: [{ input: 4, output: 5, tier: { type: "context", size: 200_000 } }],
  });
  catalog.zai!.models["glm-example"] = model("glm-example", { input: 1, output: 2, cache_write: 0 });
  catalog.google!.models["gemini-realtime"] = model("gemini-realtime", { input: 1, output: 2 });
  catalog.google!.models["gemini-audio"] = model("gemini-audio", { input: 1, output: 2 },
    { modalities: { input: ["audio"], output: ["text"] } });
  catalog.google!.models["gemini-voice"] = model("gemini-voice", { input: 1, output: 2, output_audio: 8 });
  catalog.openai!.models["gpt-incomplete"] = model("gpt-incomplete", { input: 1 });
  catalog.openai!.models["gpt-free"] = model("gpt-free", { input: 0, output: 0 });
  catalog.openrouter = { models: { "openai/gpt-gateway": model("openai/gpt-gateway", { input: 9, output: 9 }) } };
  return catalog;
}

test("pure importer selects manufacturer text models, modes, reasoning and representable tiers", () => {
  const snapshot = fromModelsDev(fixture(), "2026-09-25");
  assert.deepEqual(snapshot.entries.map(entry => `${entry.providerID}/${entry.id}`), [
    "alibaba/qwen-reasoner", "openai/gpt-example", "openai/gpt-example-fast", "openai/gpt-free",
    "xai/grok-example", "zai/glm-example",
  ]);
  assert.equal(snapshot.entries[0]?.prices[0]?.reasoning, 5);
  assert.equal(snapshot.entries[1]?.prices[1]?.tier?.size, 272_000);
  assert.deepEqual(snapshot.entries[2]?.providers, ["openai"]);
  assert.equal(snapshot.entries[2]?.prices[1]?.tier?.size, 272_000);
  assert.equal(estimate(normalize({ input: 272_001 }), snapshot.entries[2]!.prices).defaultPrice, true);
  assert.equal(snapshot.entries[3]?.prices[0]?.input, 0);
  assert.equal(snapshot.entries[4]?.prices[1]?.tier?.size, 199_999);
  assert.equal(snapshot.entries[5]?.prices[0]?.cache?.write, undefined);
  assert.equal(renderSnapshot(snapshot), renderSnapshot(fromModelsDev(fixture(), "2026-09-25")));
  assert.throws(() => fromModelsDev({ ...fixture(), openai: undefined }, "2026-09-25"), /Missing manufacturer/);
  const unknownTier = fixture();
  unknownTier.openai!.models["gpt-invalid"] = {
    id: "gpt-invalid", modalities: { input: ["text"], output: ["text"] },
    cost: { input: 1, output: 2, tiers: [{ input: 3, output: 4, tier: { type: "output", size: 10 } }] },
  };
  assert.throws(() => fromModelsDev(unknownTier, "2026-09-25"), /Invalid openai\/gpt-invalid/);
});
