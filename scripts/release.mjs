import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const PRICE_RELEASE_FILES = ["package-lock.json", "package.json", "src/prices.generated.ts"];
const registry = "https://registry.npmjs.org";
const commitMessage = tag => `chore: update first-party model prices (${tag})`;
const verificationTimeoutMs = 600_000, verificationIntervalMs = 10_000;

function versionParts(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable npm version, got ${version}`);
  }
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Unsafe npm version: ${version}`);
  return parts;
}

export function nextPatch(version) {
  const [major, minor, patch] = versionParts(version);
  if (!Number.isSafeInteger(patch + 1)) throw new Error(`Unsafe next patch: ${version}`);
  return `${major}.${minor}.${patch + 1}`;
}

export function assertNewer(version, previous) {
  const left = versionParts(version), right = versionParts(previous);
  const index = left.findIndex((value, index) => value !== right[index]);
  if (index < 0 || left[index] < right[index]) throw new Error(`${version} must be newer than npm latest ${previous}`);
}

export function verifyReleaseTag(tag, version, refType) {
  versionParts(version);
  if (refType !== "tag" || tag !== `v${version}`) {
    throw new Error(`Release must run on tag v${version}, got ${refType} ${tag}`);
  }
}

/** Only an explicit registry 404 means absent; outages must never authorize a release. */
export async function registryVersion(name, version, fetcher = fetch, { timeoutMs = 30_000 } = {}) {
  const response = await fetcher(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404 && version !== "latest") return undefined;
  if (!response.ok) throw new Error(`npm registry lookup failed for ${name}@${version}: HTTP ${response.status}`);
  const data = await response.json();
  versionParts(data?.version);
  if (version !== "latest" && data.version !== version) throw new Error(`Unexpected npm version: ${data.version}`);
  return data.version;
}

async function packageInfo(cwd) {
  const pkg = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(cwd, "package-lock.json"), "utf8"));
  versionParts(pkg.version);
  if (!pkg.name || lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error("package.json and package-lock.json must have matching names and versions");
  }
  return pkg;
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
const lines = value => value ? value.split("\n").sort() : [];
const sameFiles = (actual, expected) => JSON.stringify(actual) === JSON.stringify([...expected].sort());

/** Retry only a tagged, price-only automation commit, never an unpublished manual release. */
export async function priceReleaseState({ cwd = process.cwd(), fetcher = fetch } = {}) {
  const pkg = await packageInfo(cwd);
  if (await registryVersion(pkg.name, pkg.version, fetcher)) return { retry: false };
  const tag = `v${pkg.version}`;
  try {
    git(cwd, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
    git(cwd, "merge-base", "--is-ancestor", tag, "HEAD");
    if (git(cwd, "log", "-1", "--format=%s", tag) !== commitMessage(tag)) throw new Error("Not an automated price commit");
    const files = lines(git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", tag));
    if (!sameFiles(files, PRICE_RELEASE_FILES)) throw new Error("Not a price-only release");
    const tagged = JSON.parse(git(cwd, "show", `${tag}:package.json`));
    if (tagged.name !== pkg.name || tagged.version !== pkg.version) throw new Error("Tag version mismatch");
  } catch (error) {
    throw new Error(`${pkg.name}@${pkg.version} is unpublished. Finish the manual release before another price patch.`, { cause: error });
  }
  return { retry: true, tag };
}

/** Called only after validation. No force push or rebase: a concurrent main update aborts the release. */
export async function preparePriceRelease({ cwd = process.cwd(), fetcher = fetch } = {}) {
  const pkg = await packageInfo(cwd);
  const status = lines(git(cwd, "status", "--porcelain=v1", "--untracked-files=all").split("\n").map(line => line.slice(3)).join("\n"));
  if (!sameFiles(status, ["src/prices.generated.ts"])) throw new Error("Expected only src/prices.generated.ts to be modified");
  const version = nextPatch(pkg.version), tag = `v${version}`;
  if (!await registryVersion(pkg.name, pkg.version, fetcher)) throw new Error(`Current version ${pkg.version} is unpublished`);
  if (await registryVersion(pkg.name, version, fetcher)) throw new Error(`${pkg.name}@${version} is already published`);
  assertNewer(version, await registryVersion(pkg.name, "latest", fetcher));
  if (git(cwd, "tag", "--list", tag)) throw new Error(`Tag ${tag} already exists`);

  execFileSync("npm", ["version", "patch", "--no-git-tag-version", "--ignore-scripts"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const updated = await packageInfo(cwd);
  if (updated.version !== version) throw new Error(`Unexpected patch version: ${updated.version}`);
  git(cwd, "add", "--", ...PRICE_RELEASE_FILES);
  if (!sameFiles(lines(git(cwd, "diff", "--cached", "--name-only")), PRICE_RELEASE_FILES)) {
    throw new Error("Unexpected release files; refusing to commit");
  }
  git(cwd, "diff", "--cached", "--check");
  git(cwd, "commit", "-m", commitMessage(tag));
  git(cwd, "tag", "-a", tag, "-m", tag);
  git(cwd, "push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${tag}`);
  return { tag };
}

export async function publishState({ cwd = process.cwd(), fetcher = fetch } = {}) {
  const pkg = await packageInfo(cwd);
  const published = !!await registryVersion(pkg.name, pkg.version, fetcher);
  if (!published) assertNewer(pkg.version, await registryVersion(pkg.name, "latest", fetcher));
  return { published };
}

function verifyDuration(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`${name} must be an integer between 1 and 2147483647 milliseconds`);
  }
}

/** npm can accept a publication minutes before its version and latest become visible. */
export async function verifyPublished({
  cwd = process.cwd(), fetcher = fetch, expectLatest = true,
  timeoutMs = verificationTimeoutMs, intervalMs = verificationIntervalMs,
  wait = setTimeout, now = () => performance.now(), log = console.log,
} = {}) {
  verifyDuration(timeoutMs, "timeoutMs");
  verifyDuration(intervalMs, "intervalMs");
  const pkg = await packageInfo(cwd);
  const started = now(), remaining = () => timeoutMs - (now() - started);
  const lookup = version => {
    const budget = remaining();
    if (budget <= 0) throw new Error(`Verification deadline reached before looking up ${pkg.name}@${version}`);
    return registryVersion(pkg.name, version, fetcher, { timeoutMs: Math.ceil(Math.min(30_000, budget)) });
  };
  log(`Waiting up to ${timeoutMs / 1000}s for ${pkg.name}@${pkg.version} on npm${expectLatest ? " and latest" : " (already published)"}; polling every ${intervalMs / 1000}s.`);
  let error;
  for (let attempt = 1; remaining() > 0; attempt++) {
    try {
      if (!await lookup(pkg.version)) throw new Error(`${pkg.name}@${pkg.version} is not visible on npm yet`);
      if (expectLatest) {
        const latest = await lookup("latest");
        if (latest !== pkg.version) {
          throw new Error(`npm latest does not point to ${pkg.version} yet (currently ${latest}; target version is visible)`);
        }
      }
      if (remaining() <= 0) throw new Error("Verification deadline reached during the registry lookup");
      return;
    } catch (cause) {
      error = cause;
      log(`[npm verification ${attempt}; ${Math.round((now() - started) / 1000)}/${timeoutMs / 1000}s] ${cause.message}`);
    }
    const delay = Math.min(intervalMs, remaining());
    if (delay > 0) await wait(delay);
  }
  throw new Error(
    `npm registry verification timed out after ${timeoutMs / 1000}s for ${pkg.name}@${pkg.version}${expectLatest ? " and latest" : ""}. ` +
    `Last observation: ${error?.message ?? "verification deadline reached"}. ` +
    "A publication may have been accepted and still be processing; this timeout does not prove npm publish failed. " +
    "Check the registry and rerun the same tag without bumping the version.",
    { cause: error },
  );
}

async function output(values) {
  const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join("");
  process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, text);
}

async function main() {
  switch (process.argv[2]) {
    case "price-state": await output(await priceReleaseState()); break;
    case "prepare-price": await output(await preparePriceRelease()); break;
    case "verify-tag": {
      const pkg = await packageInfo(process.cwd());
      verifyReleaseTag(process.env.GITHUB_REF_NAME, pkg.version, process.env.GITHUB_REF_TYPE);
      break;
    }
    case "publish-state": await output(await publishState()); break;
    case "verify-published": {
      try {
        await verifyPublished({
          expectLatest: process.env.EXPECT_LATEST !== "false",
          timeoutMs: Number(process.env.NPM_VERIFY_TIMEOUT_MS ?? verificationTimeoutMs),
          intervalMs: Number(process.env.NPM_VERIFY_INTERVAL_MS ?? verificationIntervalMs),
        });
      } catch (error) {
        if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `npm registry verification failed: ${error.message}\n`);
        throw error;
      }
      const pkg = await packageInfo(process.cwd());
      const message = `Verified ${pkg.name}@${pkg.version} on npm${process.env.EXPECT_LATEST !== "false" ? " (latest)" : " (already published)"}.`;
      console.log(message);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
      break;
    }
    default: throw new Error("Expected price-state, prepare-price, verify-tag, publish-state, or verify-published");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
