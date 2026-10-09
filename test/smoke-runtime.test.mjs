import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { checkOpenCodeVersion, resolveOpenCodeBinary } from "../scripts/smoke-runtime.mjs";

test("smoke accepts historical hosts without claiming all were verified with the current SDK", () => {
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.9"), { version: "2.0.9", verified: false });
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.10"), { version: "2.0.10", verified: false });
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.11\n"), { version: "2.0.11", verified: true });
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.22"), { version: "2.0.22", verified: true });
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.24"), { version: "2.0.24", verified: true });
  assert.deepEqual(checkOpenCodeVersion("opencode v2.0.26"), { version: "2.0.26", verified: true });
});

test("newer OpenCode 2 hosts can run compatibility checks without updating an allowlist", () => {
  for (const version of ["2.0.23", "2.0.25", "2.0.99", "2.1.0", "2.10.0"]) {
    assert.deepEqual(checkOpenCodeVersion(`opencode v${version}`), { version, verified: false });
  }
});

test("smoke rejects hosts below the minimum and other major versions", () => {
  for (const version of ["1.99.99", "2.0.0", "2.0.8", "3.0.0"]) {
    assert.throws(() => checkOpenCodeVersion(`opencode v${version}`), /OpenCode >=2\.0\.9 <3\.0\.0 is required/);
  }
});

test("smoke rejects malformed and prerelease version output", () => {
  for (const output of ["", "2.0.22", "opencode v2.0", "opencode v2.0.22-beta.1", "opencode v2.00.22", "opencode v2.0.22 garbage"]) {
    assert.throws(() => checkOpenCodeVersion(output), /Expected a stable OpenCode version/);
  }
});

test("smoke defaults to PATH and supports a named alternate binary", () => {
  assert.equal(resolveOpenCodeBinary({}), "opencode");
  assert.equal(resolveOpenCodeBinary({ OPENCODE_BIN: "opencode-baseline" }), "opencode-baseline");
  assert.throws(() => resolveOpenCodeBinary({ OPENCODE_BIN: "   " }), /OPENCODE_BIN must name/);
});

test("smoke resolves override paths before switching working directories, including spaces", () => {
  const cwd = path.resolve("fixture repo");
  const binary = path.join(cwd, "baseline cli", "opencode");
  assert.equal(resolveOpenCodeBinary({ OPENCODE_BIN: binary }, cwd), binary);
  assert.equal(resolveOpenCodeBinary({ OPENCODE_BIN: "./baseline cli/opencode" }, cwd), binary);
  assert.equal(resolveOpenCodeBinary({ OPENCODE_BIN: "baseline cli/opencode" }, cwd), binary);
});
