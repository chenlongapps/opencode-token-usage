import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fromModelsDev, renderSnapshot } from "../scripts/pricing-source.ts";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.ts";

test("growing the LAB registry, repricing and adding tiers preserves pricing regressions", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "token-usage-repriced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = fileURLToPath(new URL("../", import.meta.url));
  await cp(path.join(project, "src"), path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "scripts"));
  await cp(path.join(project, "scripts/pricing-source.ts"), path.join(root, "scripts/pricing-source.ts"));
  await mkdir(path.join(root, "test"));
  for (const file of ["pricing.test.ts", "usage.test.ts"]) {
    await cp(path.join(project, "test", file), path.join(root, "test", file));
  }
  await cp(path.join(project, "package.json"), path.join(root, "package.json"));
  await symlink(path.join(project, "node_modules"), path.join(root, "node_modules"), "dir");
  const snapshot = structuredClone(GENERATED_PRICE_SNAPSHOT);
  for (const entry of snapshot.entries) {
    if (entry.source) continue; // Reviewed overrides are not updated from the upstream catalog.
    for (const price of entry.prices) {
      for (const key of ["input", "output", "reasoning"]) {
        if (price[key] !== undefined) price[key] = price[key] * 7 + 0.5;
      }
      for (const key of ["read", "write"]) {
        if (price.cache?.[key] !== undefined) price.cache[key] = price.cache[key] * 7 + 0.5;
      }
    }
  }
  // Upstream can add tiers, not just change scalar rates. Keep this fixture
  // deterministic even when the checked-in qwen-plus entry has no tiers.
  const qwen = snapshot.entries.find(entry => entry.lab === "alibaba" && entry.id === "qwen-plus");
  assert.ok(qwen);
  qwen.prices = [
    { input: 1, output: 2, reasoning: 5 },
    { input: 3, output: 4, reasoning: 12, tier: { type: "context", size: 500_000 } },
    { input: 2, output: 3, reasoning: 8, tier: { type: "context", size: 100_000 } },
  ];
  const ids = ["gemini-4-hydrogen", "gemma-4-26b-a4b-it", "gemma-4-31b-it", "test-only-new-family"];
  const added = fromModelsDev(googleCatalog(ids), "2026-11-13", []).entries;
  assert.deepEqual(added.map(entry => entry.id).sort(), [...ids].sort());
  assert.ok(added.every(entry => entry.lab === "google" && !entry.reference && entry.prices[0].input === 1));
  snapshot.entries = snapshot.entries.filter(entry => !(entry.lab === "google" && ids.includes(entry.id)));
  snapshot.entries.push(...added);
  await writeFile(path.join(root, "src/prices.generated.ts"), renderSnapshot(snapshot));
  // A nested test process must not inherit Node's internal child-runner protocol.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let result;
  try {
    result = execFileSync(process.execPath, [
      "--import", path.join(project, "node_modules/tsx/dist/loader.mjs"), "--test", "--test-reporter=tap", "test/pricing.test.ts", "test/usage.test.ts",
    ], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`Repriced snapshot regression failed:\n${error.stdout}\n${error.stderr}`, { cause: error });
  }
  assert.match(result, /# fail 0/);
});

function googleCatalog(ids) {
  const modalities = { input: ["text"], output: ["text"] };
  const qualified = `google/${ids[0]}`;
  return {
    models: Object.fromEntries(ids.map(id => [`google/${id}`, { id: `google/${id}`, modalities }])),
    providers: {
      google: { id: "google", models: Object.fromEntries(ids.map(id => [id, { id, modalities, cost: { input: 1, output: 2 } }])) },
      openrouter: { id: "openrouter", models: { [qualified]: { id: qualified, modalities, cost: { input: 0.1, output: 0.2 } } } },
    },
  };
}

test("the updater changes only the snapshot and is a no-op on a second identical download", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "token-usage-price-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = fileURLToPath(new URL("../", import.meta.url));
  await cp(path.join(project, "src"), path.join(root, "src"), { recursive: true });
  await cp(path.join(project, "package.json"), path.join(root, "package.json"));
  await mkdir(path.join(root, "scripts"));
  for (const file of ["pricing-source.ts", "update-prices.ts"]) {
    await cp(path.join(project, "scripts", file), path.join(root, "scripts", file));
  }
  const body = JSON.stringify(googleCatalog(["test-only-released"]));
  await writeFile(path.join(root, "fetch.mjs"), `globalThis.fetch = async url => {
    if (url !== "https://models.dev/catalog.json") throw new Error("Unexpected request: " + url);
    return new Response(${JSON.stringify(body)});
  };`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // Do not append simulated output to a real CI job's summary file.
  delete env.GITHUB_STEP_SUMMARY;
  const run = () => execFileSync(process.execPath, [
    "--import", path.join(project, "node_modules/tsx/dist/loader.mjs"), "--import", "./fetch.mjs", "./scripts/update-prices.ts",
  ], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const snapshot = path.join(root, "src/prices.generated.ts");
  const pkg = await readFile(path.join(root, "package.json"), "utf8");
  assert.match(run(), /; updated .*prices\.generated\.ts/);
  const written = await readFile(snapshot, "utf8");
  assert.match(written, /"lab":"google","id":"test-only-released","prices":\[\{"input":1,"output":2\}\]/);
  assert.match(run(), /; unchanged .*prices\.generated\.ts/);
  assert.equal(await readFile(snapshot, "utf8"), written);
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), pkg);
});
