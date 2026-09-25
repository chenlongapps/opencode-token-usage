import { ORIGINAL_PROVIDERS, adjustOriginalPrice } from "../src/overrides.js";
import type { Price } from "../src/usage.js";

export const PRICE_SOURCE_URL = "https://models.dev/api.json";

export interface GeneratedPrice {
  providerID: string;
  id: string;
  prices: readonly Price[];
  released?: string;
  providers?: readonly string[];
}

export interface GeneratedSnapshot {
  verified: string;
  source: string;
  entries: GeneratedPrice[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const rate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;

// These can report text input/output in a model catalog, but their billing is
// not a general text completion and cannot be inferred from the five counters.
const nonChatSKU = /(?:^|[-/])(?:embed(?:ding)?|rerank|tts|speech|realtime|live|image|audio|video|lyria)(?:[-/]|$)/i;

function price(cost: unknown, tier: boolean): Price | undefined {
  if (!record(cost)) return undefined;
  if (!rate(cost.input) || !rate(cost.output)) return undefined;
  const result: Price = { input: cost.input, output: cost.output };
  if (rate(cost.reasoning) && cost.reasoning !== cost.output) result.reasoning = cost.reasoning;
  const cache: { read?: number; write?: number } = {};
  if (rate(cost.cache_read)) cache.read = cost.cache_read;
  if (rate(cost.cache_write)) cache.write = cost.cache_write;
  if (Object.keys(cache).length) result.cache = cache;
  if (tier) {
    const threshold = cost.tier;
    if (!record(threshold) || threshold.type !== "context" || !Number.isSafeInteger(threshold.size) || (threshold.size as number) < 0) {
      throw new Error("Unsupported models.dev price tier");
    }
    result.tier = { type: "context", size: threshold.size as number };
  }
  return result;
}

function prices(cost: unknown, providerID: string): Price[] | undefined {
  const base = price(cost, false);
  if (!base) return undefined;
  if (!record(cost)) return undefined;
  if (cost.tiers !== undefined && !Array.isArray(cost.tiers)) throw new Error("Invalid models.dev price tiers");
  // The old context_over_200k compatibility field does not carry an exact
  // boundary; use tiers only, never fabricate a 200K threshold.
  if (cost.context_over_200k && !cost.tiers) throw new Error("Unknown models.dev long-context boundary");
  const result = [adjustOriginalPrice(providerID, base)];
  for (const value of (cost.tiers as unknown[] | undefined) ?? []) {
    const row = price(value, true);
    if (!row) throw new Error("Incomplete models.dev price tier");
    result.push(adjustOriginalPrice(providerID, row));
  }
  return result;
}

/** Pure conversion for both the network updater and deterministic fixture tests. */
export function fromModelsDev(input: unknown, verified: string): GeneratedSnapshot {
  if (!record(input) || !/^\d{4}-\d{2}-\d{2}$/.test(verified)) throw new Error("Invalid models.dev snapshot");
  const entries: GeneratedPrice[] = [];
  for (const [providerID, manufacturerModel] of Object.entries(ORIGINAL_PROVIDERS)) {
    const provider = input[providerID];
    if (!record(provider) || !record(provider.models)) throw new Error(`Missing manufacturer catalog: ${providerID}`);
    for (const [key, value] of Object.entries(provider.models)) {
      if (!record(value) || !string(value.id) || value.id !== key || !manufacturerModel.test(key)) continue;
      if (nonChatSKU.test(key)) continue;
      const modalities = value.modalities;
      if (!record(modalities) || !Array.isArray(modalities.input) || !modalities.input.includes("text")
        || !Array.isArray(modalities.output) || !modalities.output.includes("text")) continue;
      // Distinct audio-output prices cannot be estimated from the text token counters.
      const cost = value.cost;
      if (record(cost) && rate(cost.output_audio) && cost.output_audio !== cost.output) continue;
      let standard: Price[] | undefined;
      try { standard = prices(cost, providerID); }
      catch (error) { throw new Error(`Invalid ${providerID}/${key}: ${String(error)}`); }
      if (!standard) continue;
      const released = string(value.release_date) && /^\d{4}-\d{2}-\d{2}$/.test(value.release_date)
        ? { released: value.release_date } : {};
      entries.push({ providerID, id: key.toLowerCase(), prices: standard, ...released });
      if (providerID !== "openai" && providerID !== "anthropic") continue;
      const experimental = value.experimental;
      const modes = record(experimental) && experimental.modes;
      const fast = record(modes) && modes.fast;
      const fastPrices = record(fast) && prices(fast.cost, providerID);
      if (fastPrices) {
        // Mode.cost can omit tiers that exist on the base SKU. A known higher
        // tier without a published Fast rate is unpriceable, not base-rate Fast.
        if (fastPrices.length === 1) fastPrices.push(...standard.slice(1).map(value => {
          if (!value.tier) throw new Error(`Missing base tier: ${providerID}/${key}`);
          return { tier: value.tier };
        }));
        entries.push({ providerID, id: `${key.toLowerCase()}-fast`, providers: [providerID], prices: fastPrices, ...released });
      }
    }
  }
  entries.sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.providerID}/${entry.id}`;
    if (seen.has(key)) throw new Error(`Duplicate manufacturer model: ${key}`);
    seen.add(key);
  }
  if (!entries.length) throw new Error("Empty manufacturer price snapshot");
  return { verified, source: PRICE_SOURCE_URL, entries };
}

export function renderSnapshot(snapshot: GeneratedSnapshot): string {
  return `// Generated by npm run prices:update from ${PRICE_SOURCE_URL}. Do not edit.\n`
    + `import type { OfficialPriceEntry } from "./pricing.js";\n\n`
    + `export const GENERATED_PRICE_SNAPSHOT = {\n`
    + `  verified: ${JSON.stringify(snapshot.verified)},\n`
    + `  source: ${JSON.stringify(snapshot.source)},\n`
    + `  entries: [\n${snapshot.entries.map(entry => `    ${JSON.stringify(entry)},`).join("\n")}\n  ],\n`
    + `} as const satisfies { verified: string; source: string; entries: readonly Omit<OfficialPriceEntry, "source">[] };\n`;
}
