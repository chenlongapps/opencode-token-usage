import { snapshotFreeReferenceLookup, snapshotLookup } from "./price-identity.js";
import { GENERATED_PRICE_SNAPSHOT } from "./prices.generated.js";

/** Checked-in data only. Lookup resolves an identity, not a price source. */
export const builtInPrice = snapshotLookup(GENERATED_PRICE_SNAPSHOT);
export const freeReferencePrice = snapshotFreeReferenceLookup(GENERATED_PRICE_SNAPSHOT);
