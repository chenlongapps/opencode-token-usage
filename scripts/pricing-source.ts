import { LAB_ALIASES, MODEL_ALIASES, PROVIDER_LABS } from "../src/aliases.js";
import { PRICE_OVERRIDES, adjustCatalogPrice } from "../src/overrides.js";
import type { PriceOverride } from "../src/overrides.js";
import { defaultIdentity, priceKey, sdkModes } from "../src/price-identity.js";
import type { PriceSnapshot, SnapshotPrice } from "../src/price-identity.js";
import type { Price } from "../src/usage.js";

// Provides both the v1 api.json provider rows and the models.json LAB registry.
export const PRICE_SOURCE_URL = "https://models.dev/catalog.json";
export const PREFERRED_PRICE_PROVIDERS = [
  ["openrouter"], ["vercel"], ["amazon-bedrock"], ["llmgateway-providers", "llmgateway"],
] as const;
const preference = new Map<string, number>(PREFERRED_PRICE_PROVIDERS.flatMap(
  (group, index) => group.map(id => [id, index + 1] as const),
));
const otherPriority = PREFERRED_PRICE_PROVIDERS.length + 1;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const rate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const providerLab = (provider: string) => PROVIDER_LABS.get(provider) ?? provider;
// When the owner has multiple eligible APIs, prefer the usual direct catalog
// over an alternative cloud/region. A secondary official rate still beats a relay.
const secondaryOfficial = new Set(["alibaba-cn", "byteplus", "google-vertex", "minimax-cn", "moonshotai-cn", "stepfun", "zhipuai"]);
const canonicalPattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._+:-]*$/i;
const splitIdentity = (key: string) => [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)] as const;

// These SKUs may have text in both modalities but are not chat completions.
const nonChatSKU = /(?:^|[-/])(?:embed(?:ding)?|rerank|tts|speech|realtime|live|image|audio|video|lyria)(?:[-/]|$)/i;
const billingSuffix = /[-:](contributor-free|no-thinking|non-thinking|free|contributor|fast|pro|priority|flex|highspeed|ultrafast|thinking|nitro|floor|extended)$/;
const freeSKU = /(?:^|[-:/])free$/;
const hasModifier = (id: string, modifier: string) => new RegExp(`(?:^|[-:])${modifier}(?:[-:]|$)`).test(id);

// These rows represent plans or quota accounting, not per-token API tariffs.
// IDs are catalog IDs, not matches on a provider's display name.
const excludedPlans = new Set([
  "alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn",
  "cline-pass", "kimi-code-plan-cn", "kimi-code-plan-global", "kuae-cloud-coding-plan",
  "minimax-coding-plan", "minimax-cn-coding-plan", "scnet-token-plan", "stepfun-ai-step-plan", "stepfun-step-plan",
  "tencent-coding-plan", "tencent-token-plan", "umans-ai-coding-plan", "volcengine-coding-plan",
  "xiaomi-token-plan-ams", "xiaomi-token-plan-cn", "xiaomi-token-plan-sgp", "zai-coding-plan", "zhipuai-coding-plan",
]);
const tokenRates = ["input", "output", "reasoning", "cache_read", "cache_write"];
const baseCostFields = new Set([...tokenRates, "tiers", "context_over_200k"]);
const tierCostFields = new Set([...tokenRates, "tier"]);

function price(cost: unknown, tier: boolean): Price | undefined {
  if (!isRecord(cost) || !rate(cost.input) || !rate(cost.output)) return undefined;
  const fields = tier ? tierCostFields : baseCostFields;
  // Includes separate audio rates and any new, uninterpreted billing units.
  if (Object.keys(cost).some(key => !fields.has(key))) return undefined;
  for (const key of tokenRates) if (Object.hasOwn(cost, key) && !rate(cost[key])) return undefined;
  const result: Price = { input: cost.input, output: cost.output };
  if (rate(cost.reasoning)) result.reasoning = cost.reasoning;
  const cache = { ...(rate(cost.cache_read) ? { read: cost.cache_read } : {}),
    ...(rate(cost.cache_write) ? { write: cost.cache_write } : {}) };
  if (Object.keys(cache).length) result.cache = cache;
  if (tier) {
    const threshold = cost.tier;
    if (!isRecord(threshold) || threshold.type !== "context" || typeof threshold.size !== "number"
      || !Number.isSafeInteger(threshold.size) || threshold.size < 0 || Object.keys(threshold).length !== 2) return undefined;
    result.tier = { type: "context", size: threshold.size };
  }
  return result;
}

function parsePrices(cost: unknown, provider: string): readonly Price[] | undefined {
  if (!isRecord(cost)) return undefined;
  const base = price(cost, false);
  if (!base || (cost.tiers !== undefined && !Array.isArray(cost.tiers))) return undefined;
  // This v1 compatibility projection may use a different threshold; only
  // explicit tiers carry the actual boundary. Do not reconstruct it.
  if (cost.context_over_200k !== undefined && !cost.tiers?.length) return undefined;
  const tiers: Price[] = [];
  for (const value of cost.tiers ?? []) {
    const row = price(value, true);
    if (!row) return undefined;
    tiers.push(adjustCatalogPrice(provider, row));
  }
  tiers.sort((a, b) => a.tier!.size - b.tier!.size);
  if (tiers.some((row, i) => i > 0 && row.tier!.size === tiers[i - 1]!.tier!.size)) return undefined;
  return [adjustCatalogPrice(provider, base), ...tiers];
}

const hasCharge = (prices: readonly Price[]) => prices.some(p =>
  [p.input, p.output, p.reasoning, p.cache?.read, p.cache?.write].some(value => value !== undefined && value > 0));

function isTextChat(row: Record<string, unknown>, id: string) {
  const m = row.modalities;
  return (row.type === undefined || row.type === "chat") && !nonChatSKU.test(id)
    && isRecord(m) && Array.isArray(m.input) && m.input.includes("text")
    && Array.isArray(m.output) && m.output.length === 1 && m.output[0] === "text";
}

interface Quote {
  provider: string;
  sku: string;
  prices: readonly Price[];
  rank: number;
  paid: boolean;
}

/** Use decimal arithmetic around a floating-point tie (e.g. 0.1 + 0.2 vs 0.3). */
function compareBase(a: Price, b: Price) {
  const left = a.input! + a.output!, right = b.input! + b.output!;
  if (Math.abs(left - right) > Number.EPSILON * Math.max(left, right)) return left < right ? -1 : 1;
  const scaled = [a.input!, a.output!, b.input!, b.output!].map(value => {
    const [decimal, exponent = "0"] = value.toString().split("e");
    const [integer, fraction = ""] = decimal!.split(".");
    return { units: BigInt(integer! + fraction), power: Number(exponent) - fraction.length };
  });
  const minimum = Math.min(...scaled.map(rate => rate.power));
  const units = (i: number) => scaled[i]!.units * 10n ** BigInt(scaled[i]!.power - minimum);
  const difference = units(0) + units(1) - units(2) - units(3);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function select(quotes: Quote[], key: string) {
  const [lab, id] = splitIdentity(key);
  // Coverage across all tiers; Reasoning already has a well-defined Output
  // fallback. Separate Reasoning is only a secondary completeness signal.
  const coverage = (quote: Quote) => Math.min(...quote.prices.map(p => +Object.hasOwn(p.cache ?? {}, "read")
    + +Object.hasOwn(p.cache ?? {}, "write")));
  const reasoning = (quote: Quote) => +quote.prices.some(p => p.reasoning !== undefined);
  const affinity = ({ sku }: Quote) => sku === id || sku === key ? 0
    : sku === `${lab}.${id}` || sku === `global.${lab}.${id}` ? 1 : 2;
  return quotes.sort((a, b) => {
    const order = +b.paid - +a.paid || a.rank - b.rank;
    if (order) return order;
    const byProvider = lexical(a.provider, b.provider);
    if (!a.paid) return byProvider || affinity(a) - affinity(b) || lexical(a.sku, b.sku);
    if (a.rank === otherPriority) {
      return compareBase(a.prices[0]!, b.prices[0]!)
        || coverage(b) - coverage(a) || reasoning(b) - reasoning(a) || byProvider || lexical(a.sku, b.sku);
    }
    if (a.rank === 0) {
      const scopeOrder = +secondaryOfficial.has(a.provider) - +secondaryOfficial.has(b.provider);
      if (scopeOrder) return scopeOrder;
    }
    // Provider priority is fixed. For several SKUs at the same priority,
    // prefer an exact canonical route to a regional/pinned/renamed route.
    return affinity(a) - affinity(b) || coverage(b) - coverage(a) || byProvider || lexical(a.sku, b.sku);
  })[0]!;
}

/** Validate LAB identity independently from price availability. */
export function fromModelsDev(input: unknown, verified: string, overrides: readonly PriceOverride[] = PRICE_OVERRIDES): PriceSnapshot {
  if (!isRecord(input) || !isRecord(input.models) || !isRecord(input.providers) || !/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
    throw new Error("Invalid models.dev catalog");
  }
  const registry = new Map<string, Record<string, unknown> | null>();
  for (const [key, model] of Object.entries(input.models)) {
    if (!canonicalPattern.test(key) || !isRecord(model) || model.id !== key) continue;
    const lower = key.toLowerCase();
    registry.set(lower, registry.has(lower) ? null : model);
  }
  if (!registry.size) throw new Error("Empty models.dev LAB registry");

  const scoped = new Set<string>();
  const groups = new Map<string, Quote[]>();
  const observed = new Map<string, Map<string, string | null>>();
  const freeLinks = new Map<string, string>();
  const addQuote = (key: string, provider: string, sku: string, prices: readonly Price[] | undefined) => {
    if (!prices || excludedPlans.has(provider)) return;
    const paid = hasCharge(prices);
    if (paid && (freeSKU.test(sku) || freeSKU.test(splitIdentity(key)[1]))) return;
    if (!paid && provider === "tencent-tokenhub" && (sku === "hy3" || sku === "hy3-preview")) return;
    const rank = splitIdentity(key)[0] === providerLab(provider) ? 0 : preference.get(provider) ?? otherPriority;
    const quote = { provider, sku, prices, rank, paid };
    const group = groups.get(key);
    if (group) group.push(quote);
    else groups.set(key, [quote]);
  };

  // A serving SKU can share weights with the base without sharing its tariff.
  // Preserve exact canonical IDs; use a separate scoped key for billing modes
  // that the upstream LAB has not registered as a model in their own right.
  const billingIdentity = (base: string, modifier: string) => {
    const registered = `${base}-${modifier}`;
    if (registry.get(registered)) return registered;
    const key = `${base}:${modifier}`;
    if (registry.has(key)) return undefined;
    scoped.add(key);
    return key;
  };

  for (const [provider, value] of Object.entries(input.providers)) {
    if (!isRecord(value) || value.id !== provider || !/^[a-z0-9][a-z0-9-]*$/.test(provider) || !isRecord(value.models)) continue;
    const local = new Map<string, string | null>();
    observed.set(provider, local);
    const skuCounts = new Map<string, number>();
    for (const name of Object.keys(value.models)) {
      const sku = name.toLowerCase();
      skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    }
    const bindMode = (sku: string, key: string) => {
      // Actual endpoint IDs win over synthetic ID spellings.
      if (!skuCounts.has(sku)) local.set(sku, local.has(sku) && local.get(sku) !== key ? null : key);
    };
    for (const [name, row] of Object.entries(value.models)) {
      const sku = name.toLowerCase();
      local.set(sku, null);
      if (skuCounts.get(sku) !== 1 || !isRecord(row) || row.id !== name || !isTextChat(row, sku)) continue;
      const exact = sku.includes("/") ? sku : `${providerLab(provider)}/${sku}`;
      const declared = row.canonical_model_id;
      const base = declared === undefined ? exact : typeof declared === "string" ? declared.toLowerCase() : undefined;
      if (!base) continue;
      const model = registry.get(base);
      if (!model) {
        // Compatibility aliases for lookup only: a manually recognized
        // spelling, without a LAB registry link, contributes no quote.
        if (declared === undefined && !registry.has(base)) {
          const [slug, id] = splitIdentity(exact);
          const normalized = `${LAB_ALIASES.get(slug) ?? slug}/${id}`;
          if (!registry.has(normalized) && Object.hasOwn(MODEL_ALIASES, normalized)) {
            local.set(sku, MODEL_ALIASES[normalized]!);
          }
        }
        continue;
      }
      if (!isTextChat(model, splitIdentity(base)[1])) continue;
      const isFree = freeSKU.test(sku);
      const suffix = billingSuffix.exec(sku)?.[1] ?? (freeSKU.test(sku) ? "free" : undefined);
      const baseID = splitIdentity(base)[1];
      // Keep a paid serving modifier (e.g. Contributor or Fast) separate
      // when the Free SKU shares the ordinary model's declared identity.
      const stripped = isFree ? sku.replace(/[-:]free$/, "") : "";
      const parentMode = isFree ? billingSuffix.exec(stripped)?.[1] : undefined;
      const extraMode = parentMode && !parentMode.endsWith("free") && !hasModifier(baseID, parentMode) ? parentMode : undefined;
      const knownModifier = suffix?.endsWith("free") ? freeSKU.test(baseID)
        : suffix && hasModifier(baseID, suffix);
      const modifier = suffix && !knownModifier ? extraMode ? `${extraMode}-free` : suffix : undefined;
      const key = modifier ? billingIdentity(base, modifier) : base;
      // If the exact namespaced SKU is a different registered model, do not
      // silently override that conflicting identity with a provider's link.
      if (!key || (sku.includes("/") && registry.has(sku) && sku !== key)) continue;
      if (isFree || freeSKU.test(baseID)) scoped.add(key);
      const standard = parsePrices(row.cost, provider);
      // A SKU labeled Free with explicit paid rates contradicts its apparent
      // billing mode. Keep its identity blocked instead of borrowing a zero.
      if (isFree && standard && hasCharge(standard)) continue;
      local.set(sku, key);
      addQuote(key, provider, sku, standard);
      // The explicit LAB link provides identity; the ID suffix only tells us
      // that this endpoint is Free, never which underlying model it serves.
      if (isFree && typeof declared === "string" && !freeSKU.test(baseID) && (row.cost === undefined || standard)) {
        const paid = extraMode ? billingIdentity(base, extraMode) : base;
        if (paid && paid !== key) freeLinks.set(`${provider}/${sku}`, paid);
      }

      const modes = isRecord(row.experimental) && row.experimental.modes;
      if (modifier || isFree || !isRecord(modes)) continue;
      for (const [mode, spec] of Object.entries(modes)) {
        if (!sdkModes.has(mode) || !isRecord(spec)) continue;
        const modeKey = billingIdentity(base, mode);
        if (!modeKey) continue;
        bindMode(`${sku}-${mode}`, modeKey);
        bindMode(`${sku}@mode:${mode}`, modeKey);
        const prices = parsePrices(spec.cost, provider);
        // The flattened mode price can omit the higher context schedule.
        // Never extend that base mode rate across a known missing tier.
        const baseTierSizes = standard?.slice(1).map(p => p.tier!.size) ?? [];
        if (!standard && isRecord(row.cost) && (row.cost.tiers !== undefined || row.cost.context_over_200k !== undefined)) continue;
        if (prices && baseTierSizes.every(size => prices.some(p => p.tier?.size === size))
          && !skuCounts.has(`${sku}-${mode}`)) addQuote(modeKey, provider, `${sku}-${mode}`, prices);
      }
    }
  }
  if (!groups.size) throw new Error("Empty models.dev price snapshot");

  const entries = new Map<string, SnapshotPrice>();
  for (const [key, quotes] of groups) {
    const quote = select(quotes, key);
    const [lab, id] = splitIdentity(key);
    entries.set(key, { lab, id, ...(quote.provider === lab ? {} : { sourceProvider: quote.provider }),
      ...(quote.rank === 0 ? {} : { reference: true }), prices: quote.prices, ...(scoped.has(key) ? { scoped: true } : {}) });
  }
  const applied = new Set<string>();
  for (const override of overrides) {
    const { providerID, source, prices, zeroException } = override;
    const local = observed.get(providerID) ?? new Map<string, string | null>();
    const sku = override.id.toLowerCase();
    const key = override.canonicalID?.toLowerCase() ?? `${providerLab(providerID)}/${sku}`;
    if (!canonicalPattern.test(key) || applied.has(key) || !source.startsWith("https://") || !override.reason.trim()
      || !rate(prices[0]?.input) || !rate(prices[0]?.output)) throw new Error(`Invalid or duplicate price override: ${key}`);
    applied.add(key);
    const [lab, id] = splitIdentity(key);
    entries.set(key, { lab, id, ...(providerID === lab ? {} : { sourceProvider: providerID }),
      ...(providerLab(providerID) === lab ? {} : { reference: true }), prices, source,
      ...(override.scoped || scoped.has(key) ? { scoped: true } : {}), ...(zeroException ? { zeroException } : {}) });
    // A floating provider alias can point at a different release tomorrow.
    // The reviewed tariff stays on its original identity in that case.
    if (!local.get(sku) || local.get(sku) === key) {
      local.set(sku, key);
      if (override.scoped && sku.endsWith("-fast")) local.set(`${sku.slice(0, -5)}@mode:fast`, key);
    }
    observed.set(providerID, local);
  }

  const allKeys = [...new Set([...registry.keys(), ...entries.keys()])];
  const labs = [...new Set(allKeys.map(key => splitIdentity(key)[0]))].sort(lexical);
  const ids = new Set<string>(), duplicates = new Set<string>();
  for (const key of allKeys) {
    const id = splitIdentity(key)[1];
    if (ids.has(id) || registry.get(key) === null) duplicates.add(id);
    ids.add(id);
  }
  const final = [...entries.values()].sort((a, b) => lexical(priceKey(a), priceKey(b)));
  const ambiguous = [...duplicates].filter(id => final.some(entry => entry.id === id && !entry.scoped)).sort(lexical);
  const resolve = defaultIdentity(final, labs, ambiguous);
  const byTarget = new Map<string, string[]>();
  for (const [provider, local] of observed) for (const [sku, key] of local) {
    const target = key && entries.has(key) ? key : "";
    if ((resolve(provider, sku) ?? "") === target) continue;
    const full = `${provider}/${sku}`;
    const skus = byTarget.get(target);
    if (skus) skus.push(full);
    else byTarget.set(target, [full]);
  }
  const ordered = (map: ReadonlyMap<string, string[]>) => Object.fromEntries([...map].sort(([a], [b]) => lexical(a, b))
    .map(([key, skus]) => [key, skus.sort(lexical)] as const));
  const freeByTarget = new Map<string, string[]>();
  for (const [sku, key] of freeLinks) {
    const prices = entries.get(key)?.prices;
    if (!prices || !hasCharge(prices)) continue;
    const skus = freeByTarget.get(key);
    if (skus) skus.push(sku);
    else freeByTarget.set(key, [sku]);
  }
  return { verified, source: PRICE_SOURCE_URL, entries: final, bindings: ordered(byTarget),
    freeReferences: ordered(freeByTarget), labs, ambiguous };
}

/** Compare shipped prices and their exact lookup data, not check dates or unrelated metadata. */
export function diffSnapshots(before: Pick<PriceSnapshot, "entries">, after: Pick<PriceSnapshot, "entries">) {
  const oldEntries = new Map(before.entries.map(entry => [priceKey(entry), entry] as const));
  const newEntries = new Map(after.entries.map(entry => [priceKey(entry), entry] as const));
  const added = [...newEntries.keys()].filter(key => !oldEntries.has(key)).sort(lexical);
  const removed = [...oldEntries.keys()].filter(key => !newEntries.has(key)).sort(lexical);
  const changed = [...newEntries].filter(([key, value]) => oldEntries.has(key) && JSON.stringify(oldEntries.get(key)) !== JSON.stringify(value))
    .map(([key]) => key).sort(lexical);
  return { added, removed, changed };
}

export function refreshSnapshot(input: unknown, previous: PriceSnapshot, verified: string, overrides?: readonly PriceOverride[]) {
  const snapshot = fromModelsDev(input, verified, overrides);
  const changes = diffSnapshots(previous, snapshot);
  const lookupChanged = (["source", "bindings", "freeReferences", "labs", "ambiguous"] as const)
    .some(key => JSON.stringify(previous[key]) !== JSON.stringify(snapshot[key]));
  if (!lookupChanged && !changes.added.length && !changes.removed.length && !changes.changed.length) snapshot.verified = previous.verified;
  return { snapshot, ...changes, lookupChanged };
}

export function renderSnapshot(snapshot: PriceSnapshot): string {
  const renderBindings = (values: PriceSnapshot["bindings"]) => Object.entries(values)
    .map(([key, skus]) => `    ${JSON.stringify(key)}: ${JSON.stringify(skus)},\n`).join("");
  return `// Generated by npm run prices:update from ${PRICE_SOURCE_URL}. Do not edit.\n`
    + `import type { PriceSnapshot } from "./price-identity.js";\n\n`
    + `export const GENERATED_PRICE_SNAPSHOT: PriceSnapshot = {\n`
    + `  verified: ${JSON.stringify(snapshot.verified)},\n`
    + `  source: ${JSON.stringify(snapshot.source)},\n`
    + `  entries: [\n${snapshot.entries.map(entry => `    ${JSON.stringify(entry)},`).join("\n")}\n  ],\n`
    + `  bindings: {\n${renderBindings(snapshot.bindings)}  },\n`
    + `  freeReferences: {\n${renderBindings(snapshot.freeReferences)}  },\n`
    + `  labs: ${JSON.stringify(snapshot.labs)},\n  ambiguous: ${JSON.stringify(snapshot.ambiguous)},\n};\n`;
}

export function priceSourceCounts(entries: readonly SnapshotPrice[]) {
  const official = entries.filter(entry => !entry.reference).length;
  const preferred = entries.filter(entry => entry.reference && preference.has(entry.sourceProvider ?? entry.lab)).length;
  return { official, preferred, other: entries.length - official - preferred };
}
