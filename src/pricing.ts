import { MODEL_ALIASES, PROVIDER_ALIASES } from "./aliases.js";
import { ORIGINAL_PROVIDERS, PRICE_OVERRIDES } from "./overrides.js";
import { GENERATED_PRICE_SNAPSHOT } from "./prices.generated.js";
import type { ModelRef, Price } from "./usage.js";

export interface OfficialPriceEntry {
  /** Manufacturer, never the provider of a gateway quote. */
  providerID: string;
  id: string;
  /** USD per million tokens, using OpenCode's exclusive context tiers. */
  prices: readonly Price[];
  source: string;
  released?: string;
  /** Limited first-party SKUs, such as Fast processing. */
  providers?: readonly string[];
  reason?: string;
}

const index = new Map<string, OfficialPriceEntry>();
for (const entry of GENERATED_PRICE_SNAPSHOT.entries) {
  const key = `${entry.providerID}/${entry.id}`.toLowerCase();
  if (index.has(key)) throw new Error(`Duplicate manufacturer price: ${key}`);
  index.set(key, { ...entry, source: GENERATED_PRICE_SNAPSHOT.source });
}
for (const entry of PRICE_OVERRIDES) {
  // Reviewed exceptions replace a source row as a whole; never mix rate fields.
  index.set(`${entry.providerID}/${entry.id}`.toLowerCase(), entry);
}
for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
  if (!index.has(target)) throw new Error(`Unknown manufacturer price alias: ${alias} -> ${target}`);
}

/** Checked-in data: updating prices is explicit, not a network request at
 * startup, during a refresh, or during an npm build. */
export const OFFICIAL_PRICE_SNAPSHOT = {
  verified: GENERATED_PRICE_SNAPSHOT.verified,
  source: GENERATED_PRICE_SNAPSHOT.source,
  entries: [...index.values()].sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id)),
};

const byBareID = new Map<string, OfficialPriceEntry[]>();
for (const entry of index.values()) {
  const id = entry.id.toLowerCase();
  const matches = byBareID.get(id) ?? [];
  matches.push(entry);
  byBareID.set(id, matches);
}

const vendor = (id: string): string | undefined => {
  const value = PROVIDER_ALIASES[id] ?? id;
  return value in ORIGINAL_PROVIDERS || PRICE_OVERRIDES.some(entry => entry.providerID === value) ? value : undefined;
};
const alternateSpelling = (id: string) => id.replace(/^claude-opus-(\d+)\.(\d+)(?=$|-)/, "claude-opus-$1-$2");

function available(entry: OfficialPriceEntry | undefined, model: ModelRef): OfficialPriceEntry | undefined {
  return entry && (!entry.providers || entry.providers.some(provider => provider === model.providerID.toLowerCase()))
    ? entry : undefined;
}

function lookup(manufacturer: string, id: string, model: ModelRef): OfficialPriceEntry | undefined {
  const original = `${manufacturer}/${alternateSpelling(id)}`;
  const key = MODEL_ALIASES[original] ?? original;
  return available(index.get(key), model);
}

/** Exact first-party model IDs and known gateway wrappers only. A bare ID may
 * resolve at a gateway only when it is unique across manufacturer catalogs. */
export function officialPrice(model: ModelRef): OfficialPriceEntry | undefined {
  const providerID = model.providerID.toLowerCase();
  const raw = model.id.toLowerCase();
  const id = providerID === "google-vertex" ? raw.replace(/@default$/, "") : raw;
  const candidates = [id];
  if (id.endsWith("-free")) candidates.push(id.slice(0, -5));
  if (id.endsWith(":free")) candidates.push(id.slice(0, -5));

  const direct = vendor(providerID);
  if (direct) {
    for (const candidate of candidates) {
      const match = lookup(direct, candidate, model);
      if (match) return match;
    }
    return undefined;
  }

  for (const candidate of candidates) {
    const slash = candidate.indexOf("/");
    if (slash >= 0) {
      const slug = candidate.slice(0, slash);
      const manufacturer = vendor(slug);
      if (!manufacturer) continue;
      const match = lookup(manufacturer, candidate.slice(slash + 1), model)
        ?? lookup(manufacturer, candidate, model);
      if (match) return match;
      continue;
    }
    if (providerID === "amazon-bedrock") {
      const bedrock = /^(?:(?:us|eu|apac|global)\.)?([a-z0-9-]+)\.(.+)$/.exec(candidate);
      const manufacturer = bedrock && vendor(bedrock[1]!);
      if (manufacturer) {
        const match = lookup(manufacturer, bedrock![2]!, model);
        if (match) return match;
        continue;
      }
    }
    const matches = byBareID.get(alternateSpelling(candidate));
    if (matches?.length === 1) {
      const match = available(matches[0], model);
      if (match) return match;
    }
  }
  return undefined;
}
