import assert from "node:assert/strict";
import path from "node:path";

// Hosts verified with the current SDK, not an allowlist for running smoke.
export const verifiedOpenCodeVersions = ["2.0.11", "2.0.22"];

export function checkOpenCodeVersion(output) {
  const match = /^opencode v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/.exec(output.trim());
  assert.ok(match, `Expected a stable OpenCode version (opencode vX.Y.Z); found ${JSON.stringify(output)}`);
  const [, version, major, minor, patch] = match;
  assert.ok(major === "2" && (Number(minor) > 0 || Number(patch) >= 9),
    `OpenCode >=2.0.9 <3.0.0 is required; found ${version}`);
  return { version, verified: verifiedOpenCodeVersions.includes(version) };
}

export function resolveOpenCodeBinary(env, cwd = process.cwd()) {
  if (env.OPENCODE_BIN === undefined) return "opencode";
  const binary = env.OPENCODE_BIN.trim();
  assert.ok(binary, "OPENCODE_BIN must name an OpenCode executable");
  // Resolve relative paths before the server and TUI change to the isolated project.
  return binary.includes("/") || binary.includes(path.sep) ? path.resolve(cwd, binary) : binary;
}
