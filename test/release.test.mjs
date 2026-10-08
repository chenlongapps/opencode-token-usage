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

function pollingClock() {
  const clock = { elapsed: 0, delays: [], messages: [] };
  return Object.assign(clock, {
    now: () => clock.elapsed,
    wait: async delay => { clock.delays.push(delay); clock.elapsed += delay; },
    log: message => clock.messages.push(message),
  });
}

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

test("publication verification waits beyond the old two-minute window for registry visibility", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock();
  let requests = 0;
  const fetcher = async url => {
    requests++;
    return clock.elapsed < 180_000 ? new Response(null, { status: 404 }) : catalog()(url);
  };
  await verifyPublished({ cwd, fetcher, ...clock });
  assert.equal(clock.elapsed, 180_000);
  assert.deepEqual(clock.delays, Array(18).fill(10_000));
  assert.equal(requests, 20); // Nineteen version lookups, then latest.
  assert.match(clock.messages[0], /Waiting up to 600s/);
  assert.ok(clock.messages.some(message => /not visible on npm yet/.test(message)));
});

test("publication verification separately waits for latest and reports its current version", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock();
  const fetcher = url => catalog(["0.4.4"], clock.elapsed < 240_000 ? "0.4.3" : "0.4.4")(url);
  await verifyPublished({ cwd, fetcher, ...clock });
  assert.equal(clock.elapsed, 240_000);
  assert.deepEqual(clock.delays, Array(24).fill(10_000));
  assert.ok(clock.messages.some(message => /currently 0.4.3; target version is visible/.test(message)));
  assert.ok(clock.messages.some(message => /230\/600s/.test(message)));
});

test("already published verification does not query or modify a newer latest", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock();
  const fetcher = url => {
    assert.notEqual(decodeURIComponent(new URL(url).pathname.split("/").at(-1)), "latest");
    return catalog(["0.4.4"], "0.5.0")(url);
  };
  await verifyPublished({ cwd, fetcher, expectLatest: false, ...clock });
  assert.equal(clock.elapsed, 0);
  assert.deepEqual(clock.delays, []);
});

test("publication verification recovers from transient registry errors without calling them missing", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock();
  const failures = [
    new Response(null, { status: 503 }),
    new Response(null, { status: 429 }),
    new Error("offline"),
    Response.json({}),
    Response.json({ version: "0.4.5" }),
  ];
  const fetcher = url => {
    const failure = failures.shift();
    if (failure instanceof Error) throw failure;
    return failure ?? catalog()(url);
  };
  await verifyPublished({ cwd, fetcher, ...clock });
  assert.equal(clock.elapsed, 50_000);
  for (const reason of [/HTTP 503/, /HTTP 429/, /offline/, /stable npm version/, /Unexpected npm version/]) {
    assert.ok(clock.messages.some(message => reason.test(message)));
  }
  assert.ok(clock.messages.every(message => !/not visible/.test(message)));
});

test("verification timeout preserves the last observation and never turns registry faults into success", async t => {
  const { cwd } = await repo(t);
  const failures = [
    [catalog([]), /not visible/],
    [catalog(["0.4.4"], "0.4.3"), /latest does not point.*currently 0.4.3/],
    ...[401, 403, 429, 500, 503].map(status => [async () => new Response(null, { status }), new RegExp(`HTTP ${status}`)]),
    [async () => { throw new Error("offline"); }, /offline/],
    [async () => Response.json({}), /stable npm version/],
    [async () => Response.json({ version: "0.4.5" }), /Unexpected npm version/],
    [async () => new Response("not JSON"), /JSON/],
  ];
  for (const [fetcher, reason] of failures) {
    const clock = pollingClock();
    await assert.rejects(verifyPublished({ cwd, fetcher, timeoutMs: 25_000, ...clock }), error => {
      assert.match(error.message, /npm registry verification timed out after 25s/);
      assert.match(error.message, /does not prove npm publish failed/);
      assert.match(error.message, /rerun the same tag without bumping the version/);
      assert.match(error.message, reason);
      assert.match(error.cause.message, reason);
      return true;
    });
    assert.equal(clock.elapsed, 25_000);
    assert.deepEqual(clock.delays, [10_000, 10_000, 5_000]);
    assert.equal(clock.messages.length, 4); // Initial budget and three failed polls.
  }
});

test("version lookups, latest lookups and sleeps share a single total deadline", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock(), timeouts = [], versions = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  const fetcher = async url => {
    versions.push(decodeURIComponent(new URL(url).pathname.split("/").at(-1)));
    clock.elapsed += [12_000, 5_000, 8_000][versions.length - 1];
    return versions.length === 1 ? new Response(null, { status: 404 }) : catalog(["0.4.4"], "0.4.3")(url);
  };
  await assert.rejects(verifyPublished({ cwd, fetcher, timeoutMs: 35_000, ...clock }), /verification timed out.*latest does not point/);
  assert.deepEqual(versions, ["0.4.4", "0.4.4", "latest"]);
  assert.deepEqual(timeouts, [30_000, 13_000, 8_000]);
  assert.deepEqual(clock.delays, [10_000]);
  assert.equal(clock.elapsed, 35_000);
});

test("verification never starts a latest lookup after the total deadline", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock(), versions = [];
  const fetcher = async url => {
    versions.push(decodeURIComponent(new URL(url).pathname.split("/").at(-1)));
    clock.elapsed += 10_000;
    return catalog()(url);
  };
  await assert.rejects(verifyPublished({ cwd, fetcher, timeoutMs: 10_000, ...clock }), /deadline reached before looking up @test\/prices@latest/i);
  assert.deepEqual(versions, ["0.4.4"]);
  assert.deepEqual(clock.delays, []);
});

test("a lookup completing after the deadline cannot produce a verification success", async t => {
  const { cwd } = await repo(t);
  const clock = pollingClock();
  const fetcher = async url => {
    clock.elapsed += 10_001;
    return catalog()(url);
  };
  await assert.rejects(verifyPublished({ cwd, fetcher, expectLatest: false, timeoutMs: 10_000, ...clock }), /deadline reached during the registry lookup/i);
  assert.deepEqual(clock.delays, []);
});

test("a stalled registry request is aborted within the remaining verification budget", { timeout: 2_000 }, async t => {
  const { cwd } = await repo(t);
  let signal;
  // AbortSignal.timeout uses an unref'ed timer; keep the mocked request alive until it aborts.
  const keepAlive = setTimeout(() => {}, 2_000);
  t.after(() => clearTimeout(keepAlive));
  const fetcher = (_, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(verifyPublished({ cwd, fetcher, timeoutMs: 30, log: () => {} }), error => {
    assert.match(error.message, /verification timed out/);
    assert.equal(error.cause.name, "TimeoutError");
    return true;
  });
  assert.equal(signal.aborted, true);
});

test("verification rejects invalid duration configuration before contacting npm", async () => {
  const fetcher = () => assert.fail("Invalid configuration must never query npm");
  for (const field of ["timeoutMs", "intervalMs"]) {
    for (const value of [0, -1, 0.5, NaN, Infinity, 2_147_483_648, "10000", null]) {
      await assert.rejects(verifyPublished({ fetcher, [field]: value }), new RegExp(`${field} must be an integer`));
    }
  }
});

test("the verification CLI validates settings and summarizes visibility timeouts and successes", async t => {
  const { root, cwd } = await repo(t);
  const script = path.resolve("scripts/release.mjs"), summary = path.join(root, "summary.md");
  for (const field of ["NPM_VERIFY_TIMEOUT_MS", "NPM_VERIFY_INTERVAL_MS"]) {
    assert.throws(() => execFileSync(process.execPath, [script, "verify-published"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NPM_VERIFY_TIMEOUT_MS: "600000", NPM_VERIFY_INTERVAL_MS: "10000", [field]: "invalid", GITHUB_STEP_SUMMARY: summary },
    }), error => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /must be an integer/);
      return true;
    });
  }
  const text = await readFile(summary, "utf8");
  assert.match(text, /npm registry verification failed: timeoutMs must be an integer/);
  assert.match(text, /npm registry verification failed: intervalMs must be an integer/);
  assert.doesNotMatch(text, /Verified/);

  // Preload a local mock so CLI coverage never contacts or writes to the real npm registry.
  const mock = path.join(root, "registry.mjs"), args = ["--import", mock, script, "verify-published"];
  const env = { ...process.env, EXPECT_LATEST: "true", NPM_VERIFY_TIMEOUT_MS: "25", NPM_VERIFY_INTERVAL_MS: "10", GITHUB_STEP_SUMMARY: summary };
  await writeFile(mock, "globalThis.fetch = async () => new Response(null, { status: 404 });\n");
  assert.throws(() => execFileSync(process.execPath, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stdout, /Waiting up to 0.025s/);
    assert.match(error.stderr, /verification timed out.*not visible/);
    return true;
  });
  const failureSummary = await readFile(summary, "utf8");
  assert.match(failureSummary, /verification timed out after 0.025s/);
  assert.match(failureSummary, /rerun the same tag without bumping the version/);
  assert.doesNotMatch(failureSummary, /Verified/);

  await writeFile(mock, 'globalThis.fetch = async () => Response.json({ version: "0.4.4" });\n');
  const stdout = execFileSync(process.execPath, args, {
    cwd, env: { ...env, NPM_VERIFY_TIMEOUT_MS: "1000" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(stdout, /Waiting up to 1s/);
  assert.match(stdout, /Verified @test\/prices@0.4.4 on npm \(latest\)/);
  assert.match(await readFile(summary, "utf8"), /Verified @test\/prices@0.4.4 on npm \(latest\)/);
});
