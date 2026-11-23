import assert from "node:assert/strict";
import { test } from "node:test";
import { diffSnapshots, fromModelsDev, priceSourceCounts, refreshSnapshot, renderSnapshot } from "../scripts/pricing-source.js";
import type { PriceOverride } from "../src/overrides.js";
import { priceKey, snapshotFreeReferenceLookup, snapshotLookup } from "../src/price-identity.js";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.js";
import { builtInPrice } from "../src/pricing.js";
import { estimate, normalize } from "../src/usage.js";

const date = "2026-11-20";
const novel = "lab/new-text-model";
const modalities = { input: ["text"], output: ["text"] };
const sku = (id: string, cost?: unknown, canonical_model_id?: unknown, extra: Record<string, unknown> = {}) => ({
  id, cost, canonical_model_id, modalities, ...extra,
});
type SKU = ReturnType<typeof sku>;
const catalog = (canonical: string[], rows: Record<string, SKU[]>) => ({
  models: Object.fromEntries(canonical.map(id => [id, { id, modalities }])),
  providers: Object.fromEntries(Object.entries(rows).map(([id, models]) => [
    id, { id, models: Object.fromEntries(models.map(row => [row.id, row])) },
  ])),
});
const matched = (provider: string, cost?: unknown) => sku(`${provider}-served`, cost, novel);
const generate = (data: unknown, overrides: readonly PriceOverride[] = []) => fromModelsDev(data, date, overrides);
const source = (row: { lab: string; sourceProvider?: string }) => row.sourceProvider ?? row.lab;
const money = (input: number, output = input) => ({ input, output });
const zero = money(0);

test("selects one non-zero source per model, with official then the four fixed priorities", () => {
  const official = sku("new-text-model", { ...money(99), cache_read: 7 }); // Exact LAB ID, no canonical field or family.
  const valid = {
    lab: [official],
    openrouter: [matched("openrouter", money(10))],
    vercel: [matched("vercel", money(8))],
    "amazon-bedrock": [matched("bedrock", { ...money(6), cache_write: 4 })],
    "llmgateway-providers": [matched("llmgateway", money(4))],
    "other-expensive": [matched("other-expensive", money(2))],
    "other-cheapest": [matched("other-cheapest", money(1))],
  };
  const preferred = ["lab", "openrouter", "vercel", "amazon-bedrock", "llmgateway-providers", "other-cheapest"] as const;
  for (const winner of preferred) {
    const snapshot = generate(catalog([novel], valid));
    assert.equal(snapshot.entries.length, 1);
    const [row] = snapshot.entries;
    assert.equal(priceKey(row!), novel);
    assert.equal(source(row!), winner);
    assert.equal(row!.reference, winner === "lab" ? undefined : true);
    const rates = valid[winner][0]!.cost as { input: number; output: number };
    assert.equal(row!.prices[0]?.input, rates.input);
    assert.equal(row!.prices[0]?.output, rates.output);
    assert.equal(row!.prices[0]?.cache?.write, winner === "amazon-bedrock" ? 4 : undefined);
    // Invalid official data and higher-priority zero/missing rates cannot preempt non-zero prices.
    valid[winner] = [winner === "lab" ? sku(official.id, money(-1)) : matched(winner, winner === "vercel" ? undefined : zero)];
  }
  assert.equal(source(generate(catalog([novel], { llmgateway: [matched("auto", money(4))],
    cheap: [matched("cheap", money(1))] })).entries[0]!), "llmgateway");
});

test("LAB ownership aliases do not make hosted models official", () => {
  const hy = "tencent/hy4-flash";
  const rows = {
    "tencent-tokenhub": [sku("hy4-flash", money(5), hy), matched("hosted", money(1))],
    openrouter: [sku(hy, money(1), hy), matched("openrouter", money(4))],
  };
  const snapshot = generate(catalog([hy, novel], rows));
  const lookup = snapshotLookup(snapshot);
  assert.equal(source(lookup({ providerID: "openrouter", id: hy })!), "tencent-tokenhub");
  assert.equal(lookup({ providerID: "tencent-tokenhub", id: "hy4-flash" })?.reference, undefined);
  assert.equal(source(lookup({ providerID: "tencent-tokenhub", id: "hosted-served" })!), "openrouter");
  const noOfficial = generate(catalog([hy], { ...rows, "tencent-tokenhub": [] }));
  assert.equal(source(noOfficial.entries[0]!), "openrouter");
});

test("a secondary official API beats reference quotes but not a valid primary official quote", () => {
  const canonical = "alibaba/new-text-model";
  const rows = {
    alibaba: [sku("new-text-model", money(99), canonical)],
    "alibaba-cn": [sku("new-text-model", money(2), canonical)],
    openrouter: [sku(canonical, money(1), canonical)],
  };
  assert.equal(source(generate(catalog([canonical], rows)).entries[0]!), "alibaba");
  assert.equal(source(generate(catalog([canonical], { ...rows, alibaba: [] })).entries[0]!), "alibaba-cn");
});

test("other providers compare base Input + Output, then rate coverage, then Provider ID", () => {
  const generateCheapest = (rows: [string, unknown][]) => generate(catalog(
    [novel], Object.fromEntries(rows.map(([p, cost]) => [p, [matched(p, cost)]])),
  )).entries[0]!;
  const cheap = generateCheapest([["c", { ...money(1, 7), cache_read: 1 }], ["a", money(8, 0.1)]]);
  assert.equal(source(cheap), "c");
  assert.deepEqual(cheap.prices, [{ input: 1, output: 7, cache: { read: 1 } }]);
  const ties = [
    ["a", money(2, 6)],
    ["z", { ...money(3, 5), cache_write: 1 }],
    ["b", { ...money(4, 4), cache_read: 0 }],
  ] satisfies [string, unknown][];
  assert.equal(source(generateCheapest(ties)), "b");
  assert.deepEqual(generateCheapest(ties).prices, [{ input: 4, output: 4, cache: { read: 0 } }]);
  assert.deepEqual(generateCheapest(ties), generateCheapest([...ties].reverse()));
  assert.equal(source(generateCheapest([["a", { ...money(0.1, 0.2), cache_read: 0 }], ["b", money(0.3, 0)]])), "a");
  // A non-zero rate in an optional category or upper tier is still a paid schedule.
  assert.equal(source(generateCheapest([["a", zero], ["b", { ...zero, cache_read: 1 }]])), "b");
  assert.equal(source(generateCheapest([["a", zero], ["b", { ...zero, tiers: [
    { ...money(1), tier: { type: "context", size: 100 } },
  ] }]])), "b");
});

test("only explicit valid zero schedules participate in the final zero stage", () => {
  const ordered = ["lab", "openrouter", "vercel", "amazon-bedrock", "llmgateway", "other-a", "other-b"];
  for (let i = 0; i < ordered.length; i++) {
    const providers = Object.fromEntries(ordered.slice(i).reverse().map(p => [p, [matched(p, zero)]]));
    providers["broken"] = [
      matched("unreported"), matched("partial-free", { input: 0 }), matched("invalid-zero", { ...zero, reasoning: -1 }),
    ];
    const row = generate(catalog([novel], providers)).entries[0]!;
    assert.equal(source(row), ordered[i]);
    assert.deepEqual(row.prices, [zero]);
    assert.equal(estimate(normalize({ input: 1, output: 1 }), row.prices).defaultPrice, false);
    assert.equal(estimate(normalize({ cache: { write: 1 } }), row.prices).defaultPrice, true);
  }
  assert.throws(() => generate(catalog([novel], { openrouter: [matched("missing"), matched("invalid", money(NaN, 0))] })),
    /Empty models.dev price snapshot/);
});

test("keeps exact context tiers and reasoning without inventing missing token rates", () => {
  const xai = "xai/new-xai-text";
  const tier = (size: number, rates: object) => ({ tier: { type: "context", size }, ...rates });
  const data = catalog([novel, xai], {
    lab: [sku("new-text-model", {
      ...money(1, 2), cache_read: 0.1, reasoning: 5,
      tiers: [tier(272_000, { ...money(3, 4), cache_read: 0.3 }), tier(100, { ...money(2, 3), cache_read: 0 })],
    })],
    xai: [sku("new-xai-text", { ...money(1), tiers: [tier(200_000, money(4, 5))] })],
  });
  const lookup = snapshotLookup(generate(data));
  const prices = lookup({ providerID: "lab", id: "new-text-model" })!.prices;
  assert.deepEqual(prices, [
    { input: 1, output: 2, reasoning: 5, cache: { read: 0.1 } },
    { input: 2, output: 3, cache: { read: 0 }, tier: { type: "context", size: 100 } },
    { input: 3, output: 4, cache: { read: 0.3 }, tier: { type: "context", size: 272_000 } },
  ]);
  assert.equal(estimate(normalize({ input: 272_000 }), prices).cost, 0.544);
  assert.equal(estimate(normalize({ input: 272_001 }), prices).cost, 0.816003);
  assert.equal(estimate(normalize({ reasoning: 1_000_000 }), prices).cost, 5);
  assert.equal(estimate(normalize({ input: 101, reasoning: 1_000_000 }), prices).cost, 3.000202);
  assert.equal(estimate(normalize({ input: 272_000, cache: { write: 1 } }), prices).defaultPrice, true);
  assert.equal(lookup({ providerID: "xai", id: "new-xai-text" })?.prices[1]?.tier?.size, 199_999);
});

test("invalid or unsupported quotes are skipped individually, not flattened or treated as free", () => {
  for (const cost of [
    { input: 0 }, money(-1), money(Infinity), money("0" as unknown as number),
    { ...zero, cache_read: null }, { ...money(1), output_audio: 1 },
    { ...money(1), unit: "request" }, { ...money(1), context_over_200k: money(2), tiers: [] },
    { ...money(1), tiers: {} },
    { ...money(1), tiers: [{ input: 2, tier: { type: "context", size: 10 } }] },
    { ...money(1), tiers: [{ ...money(2), tier: { type: "output", size: 10 } }] },
    { ...money(1), tiers: [{ ...money(2), tier: { type: "context", size: 10.5 } }] },
    { ...money(1), tiers: [2, 3].map(n => ({ ...money(n), tier: { type: "context", size: 10 } })) },
  ]) {
    const snapshot = generate(catalog([novel], {
      lab: [sku("new-text-model", cost)], vercel: [matched("vercel", money(10))],
    }));
    assert.equal(source(snapshot.entries[0]!), "vercel", JSON.stringify(cost));
  }
  const excluded = generate(catalog([novel], {
    openrouter: [sku("routed", zero, novel, { type: "reranking" })],
    vercel: [sku("routed", money(1), novel, { modalities: { input: ["text"], output: ["text", "audio"] } })],
    "cline-pass": [matched("subscription", money(0.01))], "tencent-token-plan": [matched("plan", zero)],
    vendor: [matched("vendor", money(1))],
  }));
  assert.equal(source(excluded.entries[0]!), "vendor");
});

test("missing, malformed, ambiguous, or conflicting canonical IDs never lend a price", () => {
  const old = "lab/new-text-model-v1", latest = "lab/new-text-model-v2", other = "other/new-text-model";
  const snapshot = generate(catalog([novel, old, latest, other, "case/FOO", "case/foo"], {
    lab: [sku("new-text-model", money(12)), sku("new-text-model-v1", money(7))],
    vercel: [sku(latest, money(3))], // Fully qualified exact identity in the LAB registry.
    openrouter: [
      sku("new-text-model", money(0.01)), // Unqualified third-party ID, no link.
      sku("new-text-model-v1", money(0.01), "not/a-model"),
      sku(old, money(0.01), latest), // Both identities exist, and they disagree.
      sku("Mixed", money(0.01), latest), sku("mixed", money(0.01), novel), // SDK keys collide.
      sku("my-latest", undefined, latest),
      sku("case-test", money(0.01), "case/FOO"),
    ],
  }));
  assert.deepEqual(snapshot.entries.map(priceKey), [novel, old, latest]);
  const lookup = snapshotLookup(snapshot);
  assert.equal(source(lookup({ providerID: "openrouter", id: "my-latest" })!), "vercel");
  assert.equal(lookup({ providerID: "vercel", id: latest })?.prices[0]?.input, 3);
  assert.equal(lookup({ providerID: "lab", id: "new-text-model-v1" })?.prices[0]?.input, 7);
  for (const id of ["new-text-model", "new-text-model-v1", old, "mixed", "case-test", "new-text-model-v3"]) {
    assert.equal(lookup({ providerID: "openrouter", id }), undefined, id);
  }
  assert.equal(lookup({ providerID: "custom", id: "new-text-model" }), undefined); // Also names an unpriced LAB model.
  assert.equal(lookup({ providerID: "custom", id: novel })?.prices[0]?.input, 12);
});

test("Fast, Pro and Free serving SKUs and explicit modes cannot change the base quote", () => {
  const data = catalog([novel], {
    lab: [sku("new-text-model", money(9), novel, { experimental: { modes: {
      fast: { cost: money(12) }, pro: { cost: money(24) }, flex: {}, irrelevant: { cost: money(1) },
    } } })],
    openrouter: [
      sku(`${novel}:free`, zero, novel), sku(`${novel}-pro`, money(7), novel),
      sku(`${novel}-fast`, money(4), novel), sku("mislabelled-free", money(0.5), novel),
    ],
    opencode: [sku("new-text-model-free", zero, novel), sku("new-text-model-fast", undefined, novel)],
  });
  const snapshot = generate(data);
  assert.deepEqual(snapshot.entries.map(priceKey), [novel, `${novel}:fast`, `${novel}:free`, `${novel}:pro`]);
  const lookup = snapshotLookup(snapshot);
  assert.equal(lookup({ providerID: "opencode", id: "new-text-model-free" })?.prices[0]?.input, 0);
  assert.equal(lookup({ providerID: "lab", id: "new-text-model", variant: "pro" })?.prices[0]?.input, 24);
  assert.equal(lookup({ providerID: "lab", id: "new-text-model-fast" })?.prices[0]?.input, 12);
  assert.equal(lookup({ providerID: "openrouter", id: `${novel}-fast` })?.prices[0]?.input, 12);
  assert.equal(lookup({ providerID: "lab", id: "new-text-model" })?.prices[0]?.input, 9);
  assert.equal(lookup({ providerID: "lab", id: "new-text-model", variant: "flex" }), undefined);
  for (const id of [`${novel}:free`, `${novel}-fast`, `${novel}-pro`, `${novel}-v2`]) {
    assert.equal(lookup({ providerID: "custom", id }), undefined);
  }
  assert.equal(lookup({ providerID: "openrouter", id: "mislabelled-free" }), undefined);
});

test("a mode with an unreported long-context schedule is not extrapolated", () => {
  const data = catalog([novel], { lab: [sku("new-text-model", {
    ...money(2), tiers: [{ ...money(4), tier: { type: "context", size: 100 } }],
  }, novel, { experimental: { modes: { fast: { cost: money(5) } } } })] });
  assert.deepEqual(generate(data).entries.map(priceKey), [novel]);
  assert.equal(snapshotLookup(generate(data))({ providerID: "lab", id: "new-text-model", variant: "fast" }), undefined);
});

test("Free references require an exact catalog link and preserve the corresponding paid mode", () => {
  const free = "new-text-model-free";
  const snapshot = generate(catalog([novel], {
    lab: [
      sku("new-text-model", money(3)),
      sku("new-text-model-contributor", money(1), novel),
    ],
    opencode: [
      sku(free, zero, novel), sku("new-text-model-contributor-free", zero, novel),
      sku("new-text-model-fast-free", zero, novel), // No priced Fast counterpart.
      sku("new-text-model:free", zero), // No canonical link.
      sku("unknown-free", zero, "unknown/model"), sku("bad-free", money(1), novel),
      sku("unreported-free", undefined, novel),
    ],
  }));
  const reference = snapshotFreeReferenceLookup(snapshot);
  const lookup = snapshotLookup(snapshot);
  assert.equal(lookup({ providerID: "opencode", id: free })?.prices[0]?.input, 0);
  assert.deepEqual(snapshot.freeReferences, {
    [novel]: [`opencode/${free}`, "opencode/unreported-free"],
    [`${novel}:contributor`]: ["opencode/new-text-model-contributor-free"],
  });
  assert.equal(reference({ providerID: "opencode", id: free })?.prices[0]?.input, 3);
  assert.equal(reference({ providerID: "opencode", id: "new-text-model-contributor-free" })?.prices[0]?.input, 1);
  assert.equal(reference({ providerID: "unrelated", id: free }), undefined);
  assert.equal(reference({ providerID: "opencode", id: free, variant: "fast" }), undefined);
  for (const id of ["new-text-model:free", "new-text-model-fast-free", "unknown-free", "bad-free"]) {
    assert.equal(reference({ providerID: "opencode", id }), undefined, id);
  }
  const allZero = generate(catalog([novel], {
    lab: [sku("new-text-model", zero)], opencode: [sku(free, zero, novel)],
  }));
  assert.deepEqual(allZero.freeReferences, {});
});

test("reviewed overrides replace the entire selected schedule during generation", () => {
  const data = catalog([novel], {
    openrouter: [sku(novel, { ...money(1), cache_read: 5, tiers: [
      { ...money(2), tier: { type: "context", size: 500 } },
    ] })],
  });
  const override = { providerID: "lab", id: "new-text-model", source: "https://example.test/pricing", reason: "Published correction",
    prices: [money(6)] };
  const snapshot = generate(data, [override]);
  assert.deepEqual(snapshot.entries, [{ lab: "lab", id: "new-text-model", source: override.source, prices: [money(6)] }]);
  assert.deepEqual(priceSourceCounts(snapshot.entries), { official: 1, preferred: 0, other: 0 });
  assert.throws(() => generate(data, [override, override]), /duplicate price override/);
  assert.equal(snapshotLookup(snapshot)({ providerID: "openrouter", id: novel }), snapshot.entries[0]);
  const version = "lab/new-text-model-v2";
  const drift = generate(catalog([novel, version], {
    lab: [sku("new-text-model", money(9), version)],
    openrouter: [sku(novel, money(3), novel)],
  }), [override]);
  assert.equal(snapshotLookup(drift)({ providerID: "lab", id: "new-text-model" })?.prices[0]?.input, 9);
  assert.equal(snapshotLookup(drift)({ providerID: "openrouter", id: novel })?.prices[0]?.input, 6);
});

test("refresh ignores dates, unrelated metadata, losing quotes and upstream record / tier order", () => {
  const canonical = [novel, "lab/new-text-model-v1"];
  const tiers = [100, 200].map(size => ({ ...money(size), tier: { type: "context", size } }));
  const official = sku("new-text-model", { ...money(1), tiers });
  const version = sku("new-text-model-v1", money(4));
  const data = catalog(canonical, { lab: [official, version], openrouter: [matched("routed", money(2))] });
  const before = generate(data);
  const newer = catalog([...canonical].reverse(), {
    openrouter: [matched("routed", money(0.01))],
    lab: [version, sku(official.id, { ...money(1), tiers: [...tiers].reverse() }, undefined, {
      name: "Renamed upstream", release_date: "2099-01-01", description: "Not part of the price snapshot",
    })],
  });
  const update = refreshSnapshot(newer, before, "2026-11-23", []);
  assert.deepEqual(diffSnapshots(before, update.snapshot), { added: [], removed: [], changed: [] });
  assert.equal(update.lookupChanged, false);
  assert.equal(renderSnapshot(update.snapshot), renderSnapshot(before));

  const repriced = generate(catalog(canonical, { vercel: [sku(novel, zero)] }));
  assert.deepEqual(diffSnapshots(before, repriced), { added: [], removed: [canonical[1]], changed: [novel] });
  const aliasOnly = refreshSnapshot(catalog(canonical, {
    lab: [official, version], openrouter: [sku("new-alias", undefined, novel)],
  }), before, "2026-11-23", []);
  assert.deepEqual(aliasOnly.changed, []);
  assert.equal(aliasOnly.lookupChanged, true);
});

test("checked-in snapshot has one price schedule per model/SKU and no candidate quotes", () => {
  const snapshot = GENERATED_PRICE_SNAPSHOT;
  assert.equal(snapshot.source, "https://models.dev/catalog.json");
  assert.match(snapshot.verified, /^20\d{2}-\d\d-\d\d$/);
  assert.ok(snapshot.entries.length > 200);
  const keys = new Set<string>();
  for (const entry of snapshot.entries) {
    const key = priceKey(entry);
    assert.ok(!keys.has(key), key);
    keys.add(key);
    assert.ok(entry.prices.length, key);
    assert.ok(Object.keys(entry).every(name =>
      ["lab", "id", "sourceProvider", "reference", "prices", "source", "scoped", "zeroException"].includes(name)), key);
    const tiers = new Set<number>();
    for (const [i, rate] of entry.prices.entries()) {
      if (i === 0) assert.equal(rate.tier, undefined, key);
      else {
        assert.ok(rate.tier && !tiers.has(rate.tier.size), key);
        tiers.add(rate.tier.size);
      }
      if (entry.source && rate.tier && rate.input === undefined && rate.output === undefined) continue; // Reviewed unknown tier.
      assert.ok(Number.isFinite(rate.input) && rate.input! >= 0, key);
      assert.ok(Number.isFinite(rate.output) && rate.output! >= 0, key);
    }
  }
  const aliases = new Set<string>();
  for (const [key, bindings] of Object.entries(snapshot.bindings)) {
    assert.ok(key === "" || keys.has(key), key);
    for (const binding of bindings) {
      assert.ok(!aliases.has(binding), binding);
      aliases.add(binding);
    }
  }
  for (const entries of Object.values(priceSourceCounts(snapshot.entries))) assert.ok(entries > 0);
  assert.equal(renderSnapshot(snapshot).includes("candidates"), false);
});

test("offline lookup retains reviewed compatibility aliases without merging published versions", () => {
  for (const [providerID, id, expected] of [
    ["openai", "gpt-6-sol", "openai/gpt-6-sol"],
    ["amazon-bedrock", "us.anthropic.claude-opus-5", "anthropic/claude-opus-5"],
    ["google-vertex", "claude-fable-5@default", "anthropic/claude-fable-5"],
    ["openrouter", "anthropic/claude-opus-4.7", "anthropic/claude-opus-4-7"],
    ["openrouter", "openai/gpt-chat-latest", "openai/chat-latest"],
    ["openrouter", "sakana/fugu-ultra-v2", "sakana/fugu-ultra-v2"],
    ["openrouter", "tencent/hy3", "tencent/hy3"],
    ["openrouter", "deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-flash-0731"],
  ]) {
    const entry = builtInPrice({ providerID: providerID!, id: id! });
    assert.equal(entry && priceKey(entry), expected, `${providerID}/${id}`);
  }
  const fast = builtInPrice({ providerID: "openai", id: "gpt-5.5-fast" })!;
  assert.equal(estimate(normalize({ input: 272_000 }), fast.prices).defaultPrice, false);
  assert.equal(estimate(normalize({ input: 272_001 }), fast.prices).defaultPrice, true);
  assert.equal(builtInPrice({ providerID: "custom", id: "openai/gpt-5.5-fast" }), undefined);
  for (const id of ["openai/gpt-6-sol-unknown-test-mode", "openai/gpt-6-sol-unknown-test-mode-free", "foo/gpt-6-sol"]) {
    assert.equal(builtInPrice({ providerID: "custom", id }), undefined, id);
  }
});
