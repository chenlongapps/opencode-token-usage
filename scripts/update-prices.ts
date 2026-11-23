import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.js";
import { PRICE_SOURCE_URL, priceSourceCounts, refreshSnapshot, renderSnapshot } from "./pricing-source.js";

const target = fileURLToPath(new URL("../src/prices.generated.ts", import.meta.url));
const response = await fetch(PRICE_SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`models.dev price download failed: HTTP ${response.status}`);
const data: unknown = await response.json();
const { snapshot, added, removed, changed, lookupChanged } = refreshSnapshot(data, GENERATED_PRICE_SNAPSHOT, new Date().toISOString().slice(0, 10));
const text = renderSnapshot(snapshot);
let previous = "";
try { previous = await readFile(target, "utf8"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (text !== previous) await writeFile(target, text);
const { official, preferred, other } = priceSourceCounts(snapshot.entries);
const counts = `${snapshot.entries.length} model/SKU prices (${official} official, ${preferred} priority reference, ${other} other reference)`;
console.log(`${counts}; ${text === previous ? "unchanged" : "updated"} ${target}`);
for (const [label, values] of [["added", added], ["removed", removed], ["changed", changed]] as const) {
  console.log(`${label}: ${values.length}${values.length ? ` (${values.slice(0, 20).join(", ")}${values.length > 20 ? ", …" : ""})` : ""}`);
}
if (lookupChanged) console.log("Snapshot lookup data updated.");
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Model price snapshot\n\n${counts}; ${added.length} added, ${removed.length} removed, ${changed.length} changed. Lookup data ${lookupChanged ? "updated" : "unchanged"}.\n`);
}
