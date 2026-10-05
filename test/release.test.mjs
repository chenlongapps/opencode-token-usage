import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertNewer, nextPatch, PRICE_RELEASE_FILES, preparePriceRelease, priceReleaseState, publishState, registryVersion, verifyPublished, verifyReleaseTag } from "../scripts/release.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const json = async file => JSON.parse(await readFile(file, "utf8"));
const catalog = (versions = ["0.4.4"], latest = "0.4.4") => async url => {
  const requested = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  return requested === "latest" || versions.includes(requested)
    ? Response.json({ version: requested === "latest" ? latest : requested }) : new Response(null, { status: 404 });
};

async function repo(t) {
  const root = await mkdtemp(path.join(tmpdir(), "token-usage-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "repo"), remote = path.join(root, "remote.git");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Price release test");
  git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "tag.gpgsign", "false");
  git(cwd, "config", "core.hooksPath", path.join(root, "no-hooks"));
  git(cwd, "remote", "add", "origin", remote);
  const pkg = { name: "@test/prices", version: "0.4.4", scripts: { preversion: "node -e \"require('fs').writeFileSync('version-hook', 'unexpected')\"" } };
  await writeFile(path.join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(path.join(cwd, "package-lock.json"), `${JSON.stringify({
    name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { "": { name: pkg.name, version: pkg.version } },
  }, null, 2)}\n`);
  await writeFile(path.join(cwd, "src/prices.generated.ts"), "// prices before\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");
  git(cwd, "push", "origin", "main");
  return { root, cwd, remote };
}

const changePrices = cwd => writeFile(path.join(cwd, "src/prices.generated.ts"), "// prices after\n");

test("patch versions and latest comparisons use stable numeric semver", () => {
  assert.equal(nextPatch("0.4.4"), "0.4.5");
  assert.equal(nextPatch("1.2.99"), "1.2.100");
  for (const version of ["v0.4.4", "0.04.4", "0.4.4-beta.1", "0.4", "0.4.9007199254740991", null]) {
    assert.throws(() => nextPatch(version), /version|patch/);
  }
  assert.doesNotThrow(() => assertNewer("0.4.10", "0.4.9"));
  assert.doesNotThrow(() => assertNewer("1.0.0", "0.99.99"));
  for (const version of ["0.4.4", "0.4.3", "0.3.99"]) assert.throws(() => assertNewer(version, "0.4.4"), /must be newer/);
});

test("publication requires an actual matching tag, not a version-named branch", () => {
  assert.doesNotThrow(() => verifyReleaseTag("v0.4.4", "0.4.4", "tag"));
  assert.throws(() => verifyReleaseTag("v0.4.4", "0.4.4", "branch"), /must run on tag/);
  assert.throws(() => verifyReleaseTag("v0.4.5", "0.4.4", "tag"), /must run on tag/);
});

test("registry lookup distinguishes missing versions from outages and invalid responses", async () => {
  assert.equal(await registryVersion("@test/prices", "0.4.4", catalog()), "0.4.4");
  assert.equal(await registryVersion("@test/prices", "0.4.5", catalog()), undefined);
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(registryVersion("@test/prices", "0.4.5", async () => new Response(null, { status })), /lookup failed/);
  }
  await assert.rejects(registryVersion("@test/prices", "latest", async () => new Response(null, { status: 404 })), /lookup failed/);
  await assert.rejects(registryVersion("@test/prices", "0.4.4", async () => Response.json({ version: "0.4.5" })), /Unexpected npm version/);
  await assert.rejects(registryVersion("@test/prices", "0.4.4", async () => Response.json({})), /stable npm version/);
  await assert.rejects(registryVersion("@test/prices", "0.4.4", async () => { throw new Error("offline"); }), /offline/);
});

test("an already published base version needs no recovery", async t => {
  const { cwd } = await repo(t);
  assert.deepEqual(await priceReleaseState({ cwd, fetcher: catalog() }), { retry: false });
});

test("price release atomically pushes only the snapshot, synchronized patch and annotated tag", async t => {
  const { cwd, remote } = await repo(t);
  await changePrices(cwd);
  assert.deepEqual(await preparePriceRelease({ cwd, fetcher: catalog() }), { tag: "v0.4.5" });
  const pkg = await json(path.join(cwd, "package.json"));
  const lock = await json(path.join(cwd, "package-lock.json"));
  assert.equal(pkg.version, "0.4.5");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.ok(pkg.scripts.preversion);
  assert.equal(git(cwd, "status", "--porcelain"), ""); // The version hook was not executed.
  assert.deepEqual(git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n"), PRICE_RELEASE_FILES);
  assert.equal(git(cwd, "cat-file", "-t", "v0.4.5"), "tag");
  assert.equal(git(remote, "rev-parse", "main"), git(cwd, "rev-parse", "HEAD"));
  assert.equal(git(remote, "rev-parse", "v0.4.5^{commit}"), git(cwd, "rev-parse", "HEAD"));
});

test("unexpected files or unchanged prices cannot cause a version bump", async t => {
  const { cwd } = await repo(t);
  await assert.rejects(preparePriceRelease({ cwd, fetcher: catalog() }), /Expected only/);
  await changePrices(cwd);
  await writeFile(path.join(cwd, "unexpected"), "not a price\n");
  await assert.rejects(preparePriceRelease({ cwd, fetcher: catalog() }), /Expected only/);
  assert.equal((await json(path.join(cwd, "package.json"))).version, "0.4.4");
});

test("occupied versions, unpublished bases, existing tags and latest downgrades abort before bumping", async t => {
  for (const [fetcher, expected] of [
    [catalog(["0.4.4", "0.4.5"], "0.4.5"), /already published/],
    [catalog([], "0.4.3"), /Current version.*unpublished/],
    [catalog(["0.4.4"], "0.5.0"), /must be newer/],
  ]) {
    const { cwd } = await repo(t);
    await changePrices(cwd);
    await assert.rejects(preparePriceRelease({ cwd, fetcher }), expected);
    assert.equal((await json(path.join(cwd, "package.json"))).version, "0.4.4");
  }
  const { cwd } = await repo(t);
  await changePrices(cwd);
  git(cwd, "tag", "v0.4.5");
  await assert.rejects(preparePriceRelease({ cwd, fetcher: catalog() }), /Tag.*already exists/);
  assert.equal((await json(path.join(cwd, "package.json"))).version, "0.4.4");
});

test("an unfinished automation release retries its original tag without another patch", async t => {
  const { cwd } = await repo(t);
  await changePrices(cwd);
  await preparePriceRelease({ cwd, fetcher: catalog() });
  await writeFile(path.join(cwd, "README.md"), "later documentation\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-m", "later unrelated commit");
  assert.deepEqual(await priceReleaseState({ cwd, fetcher: catalog() }), { retry: true, tag: "v0.4.5" });
  assert.equal((await json(path.join(cwd, "package.json"))).version, "0.4.5");
  assert.deepEqual(await priceReleaseState({ cwd, fetcher: catalog(["0.4.4", "0.4.5"], "0.4.5") }), { retry: false });
});

test("an unpublished manual or non-price tag is never automatically published by the price job", async t => {
  const { cwd } = await repo(t);
  await assert.rejects(priceReleaseState({ cwd, fetcher: catalog([]) }), /Finish the manual release/);
  git(cwd, "tag", "v0.4.4");
  await assert.rejects(priceReleaseState({ cwd, fetcher: catalog([]) }), /Finish the manual release/);

  const other = await repo(t);
  await changePrices(other.cwd);
  await writeFile(path.join(other.cwd, "README.md"), "not price-only\n");
  git(other.cwd, "add", ".");
  git(other.cwd, "commit", "-m", "chore: update first-party model prices (v0.4.4)");
  git(other.cwd, "tag", "v0.4.4");
  await assert.rejects(priceReleaseState({ cwd: other.cwd, fetcher: catalog([]) }), /Finish the manual release/);
});

test("a concurrent main push cannot leave an orphan release tag on the remote", async t => {
  const { root, cwd, remote } = await repo(t);
  const other = path.join(root, "other");
  git(root, "clone", "--branch", "main", remote, other);
  git(other, "config", "user.name", "Concurrent test");
  git(other, "config", "user.email", "other@example.invalid");
  git(other, "config", "commit.gpgsign", "false");
  git(other, "config", "core.hooksPath", path.join(root, "no-hooks"));
  await writeFile(path.join(other, "README.md"), "concurrent edit\n");
  git(other, "add", ".");
  git(other, "commit", "-m", "concurrent edit");
  git(other, "push", "origin", "main");
  const concurrent = git(remote, "rev-parse", "main");
  await changePrices(cwd);
  await assert.rejects(preparePriceRelease({ cwd, fetcher: catalog() }), /atomic|rejected|fetch first/);
  assert.equal(git(remote, "rev-parse", "main"), concurrent);
  assert.equal(git(remote, "tag", "--list", "v0.4.5"), "");
});

test("publication is idempotent and cannot move latest backwards", async t => {
  const { cwd } = await repo(t);
  assert.deepEqual(await publishState({ cwd, fetcher: catalog(["0.4.4"], "0.5.0") }), { published: true });
  assert.deepEqual(await publishState({ cwd, fetcher: catalog([], "0.4.3") }), { published: false });
  await assert.rejects(publishState({ cwd, fetcher: catalog([], "0.5.0") }), /must be newer/);
});

test("mismatched lockfile versions stop both price and publishing jobs", async t => {
  const { cwd } = await repo(t);
  const lock = await json(path.join(cwd, "package-lock.json"));
  lock.packages[""].version = "0.4.3";
  await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify(lock));
  await assert.rejects(priceReleaseState({ cwd, fetcher: catalog() }), /matching names and versions/);
  await assert.rejects(publishState({ cwd, fetcher: catalog() }), /matching names and versions/);
});

test("publication verification waits for registry visibility and checks latest", async t => {
  const { cwd } = await repo(t);
  let waits = 0;
  const fetcher = async url => waits === 0 ? new Response(null, { status: 404 }) : catalog()(url);
  await verifyPublished({ cwd, fetcher, wait: async () => { waits++; } });
  assert.equal(waits, 1);
  await assert.rejects(verifyPublished({ cwd, fetcher: catalog(["0.4.4"], "0.4.3"), attempts: 2, wait: async () => {} }), /latest does not point/);
  await assert.rejects(verifyPublished({ cwd, fetcher: catalog([]), attempts: 1 }), /not visible/);
  await assert.rejects(verifyPublished({ cwd, fetcher: async () => new Response(null, { status: 503 }), attempts: 1 }), /lookup failed/);
  await verifyPublished({ cwd, fetcher: catalog(["0.4.4"], "0.5.0"), expectLatest: false });
});
