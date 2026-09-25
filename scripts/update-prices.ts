import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.js";
import { fromModelsDev, PRICE_SOURCE_URL, renderSnapshot } from "./pricing-source.js";

const target = fileURLToPath(new URL("../src/prices.generated.ts", import.meta.url));
const response = await fetch(PRICE_SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`models.dev price download failed: HTTP ${response.status}`);
const data: unknown = await response.json();
const snapshot = fromModelsDev(data, new Date().toISOString().slice(0, 10));
const before = new Map(GENERATED_PRICE_SNAPSHOT.entries.map(entry => [`${entry.providerID}/${entry.id}`, entry] as const));
const after = new Map(snapshot.entries.map(entry => [`${entry.providerID}/${entry.id}`, entry] as const));
const added = [...after.keys()].filter(key => !before.has(key));
const removed = [...before.keys()].filter(key => !after.has(key));
const changed = [...after].filter(([key, value]) => before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(value))
  .map(([key]) => key);
if (!added.length && !removed.length && !changed.length) snapshot.verified = GENERATED_PRICE_SNAPSHOT.verified;
const text = renderSnapshot(snapshot);
let previous = "";
try { previous = await readFile(target, "utf8"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (text !== previous) await writeFile(target, text);
console.log(`${snapshot.entries.length} first-party prices; ${text === previous ? "unchanged" : "updated"} ${target}`);
for (const [label, values] of [["added", added], ["removed", removed], ["changed", changed]] as const) {
  console.log(`${label}: ${values.length}${values.length ? ` (${values.slice(0, 20).join(", ")}${values.length > 20 ? ", …" : ""})` : ""}`);
}
