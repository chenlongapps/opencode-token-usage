import { LAB_ALIASES, MODEL_ALIASES, PROVIDER_LABS } from "./aliases.js";
import type { ModelRef, Price } from "./usage.js";

export interface SnapshotPrice {
  lab: string;
  id: string;
  /** Omitted when the provider's ID equals the LAB's ID. */
  sourceProvider?: string;
  /** Unset for an official tariff (including reviewed overrides). */
  reference?: true;
  prices: readonly Price[];
  /** Source URL for a reviewed override. Otherwise the catalog URL applies. */
  source?: string;
  /** Synthetic billing SKUs match known provider IDs only. */
  scoped?: true;
  zeroException?: string;
}

export interface PriceSnapshot {
  verified: string;
  source: string;
  entries: readonly SnapshotPrice[];
  /** LAB/SKU -> exact provider/SKU bindings; the empty key inhibits generic lookup. */
  bindings: Readonly<Record<string, readonly string[]>>;
  /** Paid LAB/SKU -> exact Free provider/SKUs with a verified counterpart. No rate copies. */
  freeReferences: Readonly<Record<string, readonly string[]>>;
  /** LAB IDs and bare IDs that must not fall through to a different LAB. */
  labs: readonly string[];
  ambiguous: readonly string[];
}

export const priceKey = (entry: Pick<SnapshotPrice, "lab" | "id">) => `${entry.lab}/${entry.id}`;
export const sdkModes = new Set(["fast", "flex", "priority", "pro", "ultrafast"]);

/** SDK cost is attached to a model ID, not to its selectable serving modes. */
export function billingMode(model: ModelRef) {
  const mode = model.variant?.toLowerCase();
  if (!mode || !sdkModes.has(mode)) return undefined;
  const id = model.id.toLowerCase();
  return !id.endsWith(`-${mode}`) && !id.endsWith(`:${mode}`) ? mode : undefined;
}

/** Shared by the generator (to omit redundant bindings) and offline lookup.
 * These spellings never establish a price candidate's identity. */
export function defaultIdentity(entries: readonly SnapshotPrice[], labs: readonly string[], ambiguous: readonly string[]) {
  const knownLabs = new Set(labs);
  const blocked = new Set(ambiguous);
  const keys = new Set(entries.filter(entry => !entry.scoped).map(priceKey));
  const bare = new Map<string, string | null>();
  for (const entry of entries) {
    const { id, scoped } = entry;
    if (scoped) continue;
    bare.set(id, blocked.has(id) || bare.has(id) ? null : priceKey(entry));
  }
  const resolve = (key: string) => keys.has(key) ? key
    : Object.hasOwn(MODEL_ALIASES, key) && keys.has(MODEL_ALIASES[key]!) ? MODEL_ALIASES[key] : undefined;

  return (providerID: string, raw: string): string | undefined => {
    const id = providerID === "google-vertex" ? raw.replace(/@default$/, "") : raw;
    const lab = PROVIDER_LABS.get(providerID) ?? providerID;
    const slash = id.indexOf("/");
    if (slash >= 0) {
      const slug = id.slice(0, slash);
      const namespace = LAB_ALIASES.get(slug) ?? slug;
      if (knownLabs.has(lab) && lab !== namespace) return undefined;
      return resolve(`${namespace}/${id.slice(slash + 1)}`);
    }
    if (providerID === "amazon-bedrock") {
      const match = /^(?:(?:us|eu|apac|global)\.)?([a-z0-9-]+)\.(.+)$/.exec(id);
      if (match) return resolve(`${LAB_ALIASES.get(match[1]!) ?? match[1]}/${match[2]}`);
    }
    if (knownLabs.has(lab)) return resolve(`${lab}/${id}`);
    return bare.get(id) ?? undefined;
  };
}

/** Exact identity resolution only. There is no runtime ranking of providers. */
export function snapshotLookup(snapshot: PriceSnapshot) {
  const index = new Map(snapshot.entries.map(entry => [priceKey(entry), entry]));
  const bindings = new Map(Object.entries(snapshot.bindings).flatMap(([key, skus]) => skus.map(sku => [sku, key] as const)));
  const resolve = defaultIdentity(snapshot.entries, snapshot.labs, snapshot.ambiguous);
  return (model: ModelRef): SnapshotPrice | undefined => {
    const provider = model.providerID.toLowerCase();
    const raw = model.id.toLowerCase();
    const sku = `${provider}/${raw}`;
    const mode = billingMode(model);
    if (mode) {
      const key = bindings.get(`${sku}@mode:${mode}`);
      return key ? index.get(key) : undefined;
    }
    const key = bindings.get(sku) ?? resolve(provider, raw);
    return key ? index.get(key) : undefined;
  };
}

/** The reference is separate from the Free SKU's own zero schedule. */
export function snapshotFreeReferenceLookup(snapshot: PriceSnapshot) {
  const index = new Map(snapshot.entries.map(entry => [priceKey(entry), entry]));
  const references = new Map(Object.entries(snapshot.freeReferences).flatMap(([key, skus]) => {
    const rate = index.get(key);
    return rate ? skus.map(sku => [sku, rate] as const) : [];
  }));
  return (model: ModelRef): SnapshotPrice | undefined => billingMode(model) ? undefined
    : references.get(`${model.providerID.toLowerCase()}/${model.id.toLowerCase()}`);
}
