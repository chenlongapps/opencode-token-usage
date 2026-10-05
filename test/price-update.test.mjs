import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderSnapshot } from "../scripts/pricing-source.ts";
import { GENERATED_PRICE_SNAPSHOT } from "../src/prices.generated.ts";

test("repricing every generated model does not invalidate algorithm or usage regression tests", async t => {
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
  for (const entry of snapshot.entries) for (const price of entry.prices) {
    for (const key of ["input", "output", "reasoning"]) {
      if (price[key] !== undefined) price[key] = price[key] * 7 + 0.5;
    }
    for (const key of ["read", "write"]) {
      if (price.cache?.[key] !== undefined) price.cache[key] = price.cache[key] * 7 + 0.5;
    }
  }
  await writeFile(path.join(root, "src/prices.generated.ts"), renderSnapshot(snapshot));
  // A nested test process must not inherit Node's internal child-runner protocol.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let result;
  try {
    result = execFileSync(process.execPath, [
      path.join(project, "node_modules/tsx/dist/cli.mjs"), "--test", "--test-reporter=tap", "test/pricing.test.ts", "test/usage.test.ts",
    ], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`Repriced snapshot regression failed:\n${error.stdout}\n${error.stderr}`, { cause: error });
  }
  assert.match(result, /# fail 0/);
});
