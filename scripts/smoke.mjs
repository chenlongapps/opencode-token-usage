import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { OpenCode } from "@opencode/client";
import xterm from "@xterm/headless";
import { checkOpenCodeVersion, resolveOpenCodeBinary, verifiedOpenCodeVersions } from "./smoke-runtime.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const opencode = resolveOpenCodeBinary(process.env);
const work = await mkdtemp(path.join(tmpdir(), "token-usage-smoke-"));
const project = path.join(work, "project");
const installation = path.join(work, "installation");
const provider = path.join(installation, "provider");
for (const directory of [project, installation, provider]) await mkdir(directory);
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(work, "data"), XDG_CONFIG_HOME: path.join(work, "config"),
  XDG_STATE_HOME: path.join(work, "state"), XDG_CACHE_HOME: path.join(work, "cache"),
  TERM: "xterm-256color", COLORTERM: "truecolor",
  // The baseline uses tabs.enabled; current OpenCode still supports this spelling.
  OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ session: { sidebar: "auto" }, tabs: { enabled: false }, animations: false }),
};
delete env.OPENCODE_CONFIG;
delete env.OPENCODE_CONFIG_CONTENT;
const npmEnv = { ...process.env };
if (!npmEnv.npm_config_cache && !npmEnv.NPM_CONFIG_CACHE) npmEnv.npm_config_cache = path.join(work, "npm-cache");
console.log(`Smoke artifacts: ${work}`);
const opencodeVersion = execFileSync(opencode, ["--version"], { env, encoding: "utf8" }).trim();
const host = checkOpenCodeVersion(opencodeVersion);
console.log(`Smoke OpenCode: ${opencodeVersion} (${opencode})`);
if (!host.verified) console.warn(`WARNING: OpenCode ${host.version} has not been verified with the current SDK; running compatibility checks. Verified hosts: ${verifiedOpenCodeVersions.join(", ")}`);
const packageName = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).name;

const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", work], { cwd: repo, encoding: "utf8", env: npmEnv }));
const files = packed[0].files.map(file => file.path);
assert.ok(files.includes("dist/index.js") && files.includes("dist/tui.js") && files.includes("index.js") && files.includes("tui.js"));
assert.ok(files.includes("dist/pricing.js") && files.includes("dist/pricing.d.ts") && files.includes("docs/pricing.md"));
assert.ok(["aliases", "overrides", "prices.generated"].every(name => files.includes(`dist/${name}.js`)));
assert.ok(files.includes("dist/context-rpc.js") && files.includes("dist/context-sources.js"));
assert.ok(files.every(file => !file.startsWith("test/") && !file.startsWith("node_modules/")));
await writeFile(path.join(installation, "package.json"), JSON.stringify({ private: true, type: "module" }));
execFileSync("npm", ["install", path.join(work, packed[0].filename), "--no-audit", "--no-fund", "--prefer-offline"], { cwd: installation, env: npmEnv, stdio: "inherit", timeout: 120_000 });
const plugin = path.join(installation, "node_modules", ...packageName.split("/"));
const { createSource, loadSnapshot, uniqueMessages, viewedMessages } = await import(path.join(plugin, "dist/source.js"));
const { contextUsage, summarize } = await import(path.join(plugin, "dist/usage.js"));
const { ContextSourceRpc } = await import(path.join(plugin, "dist/context-rpc.js"));
const { historicalPerformance } = await import(path.join(plugin, "dist/performance.js"));

let childAgent = "general";
const requests = [];
// Keep live checks observable until the TUI has rendered them, rather than racing a fixed delay.
const streamGates = new Map(["SWITCH_SMOKE", "FIRST_SMOKE", "LONG_TTFT_SMOKE", "REASONING_SMOKE"]
  .map(marker => [marker, { started: false, ...Promise.withResolvers() }]));
const compactionSummary = `## Objective
- Return SMOKE_OK.
## Requirements
- (none)
## Decisions
- Use the local smoke provider.
## Work State
### Completed
- Returned SMOKE_OK.
### Active
- (none)
### Blocked
- (none)
## Next Move
1. Await the next smoke prompt.
## Relevant Files
- (none)
## Important Context
- This is an isolated smoke session.
`;
const mock = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    const lastUser = data.messages.findLastIndex(message => message.role === "user");
    const userText = JSON.stringify(data.messages[lastUser]);
    const gate = [...streamGates].find(([marker]) => userText.includes(marker))?.[1];
    const longTtftSmoke = userText.includes("LONG_TTFT_SMOKE");
    const reasoningSmoke = userText.includes("REASONING_SMOKE");
    const compactionSmoke = (userText.includes("## Objective") && userText.includes("## Work State"))
      || userText.includes("required summary template");
    const spawnChild = userText.includes("SPAWN_SMOKE_CHILD")
      && !data.messages.slice(lastUser + 1).some(message => message.role === "tool");
    const tool = data.tools?.find(tool => tool.function.name === "subagent");
    const toolCalls = spawnChild && tool ? [{ index: 0, id: "usage-smoke-child", type: "function", function: {
      name: "subagent", arguments: JSON.stringify({ agent: childAgent, description: "Usage smoke child", prompt: "Return CHILD_DONE." }),
    } }] : undefined;
    const content = compactionSmoke ? compactionSummary : toolCalls ? undefined : gate ? "SMOKE_OK ".repeat(4).trim() : "SMOKE_OK";
    const usage = reasoningSmoke ? {
      prompt_tokens: 1200, completion_tokens: 270, total_tokens: 1470,
      prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 200 },
    } : {
      prompt_tokens: 1200, completion_tokens: 70, total_tokens: 1270,
      prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 20 },
    };
    if (data.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finish_reason = null, reportedUsage) => response.write(`data: ${JSON.stringify({
        id: "chatcmpl-smoke", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: data.model,
        choices: [{ index: 0, delta, finish_reason }], ...(reportedUsage ? { usage: reportedUsage } : {}),
      })}\n\n`);
      chunk({ role: "assistant" });
      await new Promise(resolve => setTimeout(resolve, longTtftSmoke ? 2_000 : reasoningSmoke ? 1_500 : 300));
      const fragmentSize = compactionSmoke ? content.length : gate ? 8 : 4;
      chunk(toolCalls ? { tool_calls: toolCalls } : { content: content.slice(0, fragmentSize) });
      if (content) {
        // Multiple spaced deltas survive host batching and fit inside the live TPS window.
        for (let offset = fragmentSize; offset < content.length; offset += fragmentSize) {
          await new Promise(resolve => setTimeout(resolve, gate ? 300 : 700));
          chunk({ content: content.slice(offset, offset + fragmentSize) });
        }
      }
      if (gate) { gate.started = true; await gate.promise; }
      await new Promise(resolve => setTimeout(resolve, 100));
      chunk({}, toolCalls ? "tool_calls" : "stop", usage);
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chatcmpl-smoke", object: "chat.completion", created: 1, model: data.model,
        choices: [{ index: 0, message: { role: "assistant", content: "Smoke session" }, finish_reason: "stop" }], usage }));
    }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
const mockPort = mock.address().port;
await copyFile(path.join(repo, "test/fixtures/provider.mjs"), path.join(provider, "index.mjs"));
await writeFile(path.join(provider, "package.json"), JSON.stringify({ name: "usage-smoke-provider", type: "module", exports: { ".": "./index.mjs" } }));
await writeFile(path.join(project, "opencode.json"), JSON.stringify({
  model: "usage-test/small",
  plugins: [plugin, { package: provider, options: { baseURL: `http://127.0.0.1:${mockPort}/v1` } }],
}));

const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env });
let serverLog = "";
server.stdout.on("data", data => { serverLog += data; });
server.stderr.on("data", data => { serverLog += data; });
const client = OpenCode.make({
  baseUrl: `http://127.0.0.1:${port}`,
  fetch: (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}`);
    return fetch(url, { ...init, headers });
  },
});
const source = createSource(client);
const streamEvents = [];
const eventController = new AbortController();
let eventCapture;
const wait = async (check, label, timeout = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await check()) return; } catch { /* Startup and projection may still be pending. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const scrollToEnd = (tui, check, label) => wait(() => {
  if (check(tui.screen())) return true;
  // Expanded rows and optional RPC data can change the scroll extent after a frame.
  tui.send("\x1b[F");
  return false;
}, label);
const terminals = [];
const lineNumber = (screen, pattern) => screen.split("\n").findIndex(line => pattern.test(line));
const openTui = (sessionID, size = { cols: 160, rows: 54 }) => {
  const terminal = new xterm.Terminal({ ...size, allowProposedApi: true });
  const process = spawn("python3", [path.join(repo, "scripts/terminal.py"), opencode, "--server", `http://127.0.0.1:${port}`, "--session", sessionID], {
    cwd: project, env: { ...env, USAGE_SMOKE_COLS: String(size.cols), USAGE_SMOKE_ROWS: String(size.rows) },
  });
  let raw = "";
  process.stdout.on("data", data => { raw += data; terminal.write(data.toString()); });
  process.stderr.on("data", data => { raw += data; });
  terminal.onData(data => { if (!process.stdin.destroyed) process.stdin.write(data); });
  const screen = () => Array.from({ length: terminal.rows }, (_, line) => terminal.buffer.active.getLine(line)?.translateToString(true) ?? "").join("\n");
  const save = async name => {
    await writeFile(path.join(work, `${name}.txt`), screen());
    await writeFile(path.join(work, `${name}.ansi`), raw);
  };
  const send = data => process.stdin.write(data);
  const click = text => {
    const lines = Array.from({ length: terminal.rows }, (_, line) => terminal.buffer.active.getLine(line)?.translateToString(true) ?? "");
    const row = lines.findIndex(line => line.includes(text));
    if (row < 0) throw new Error(`Could not find text to click: ${text}`);
    const column = lines[row].indexOf(text) + 2;
    process.stdin.write(`\x1b[<0;${column};${row + 1}M`);
    process.stdin.write(`\x1b[<0;${column};${row + 1}m`);
  };
  const entry = { process, screen, save, send, click, terminal };
  terminals.push(entry);
  return entry;
};

try {
  await wait(() => {
    const password = serverLog.match(/server password (\S+)/)?.[1];
    if (!password) return false;
    env.OPENCODE_PASSWORD = password;
    return true;
  }, "server credentials");
  await wait(() => client.server.info(), "server startup");
  eventCapture = (async () => {
    for await (const event of client.event.subscribe({ signal: eventController.signal })) {
      if (/^session\.(?:step\.|text\.delta|reasoning\.delta|tool\.input\.delta)/.test(event.type)) streamEvents.push(event);
    }
  })().catch(error => {
    if (!eventController.signal.aborted) streamEvents.push({ error: String(error) });
  });
  await writeFile(path.join(work, "config.json"), JSON.stringify(await client.config.get({ location: { directory: project } }), null, 2));
  await wait(async () => {
    const inventory = await client.plugin.list({ location: { directory: project } });
    await writeFile(path.join(work, "plugins.json"), JSON.stringify(inventory, null, 2));
    return inventory.data.some(info => info.id === "opencode-token-usage" && info.state.status === "active");
  }, "packed server plugin activation");
  const models = await client.model.list({ location: { directory: project } });
  assert.ok(models.data.some(model => model.providerID === "usage-test"));
  assert.deepEqual(models.data.find(model => model.providerID === "usage-test" && model.id === "gpt-5.6-luna")?.cost, []);
  const agents = await client.agent.list({ location: { directory: project } });
  childAgent = agents.data.find(agent => agent.mode !== "primary")?.id;
  assert.ok(childAgent, "a built-in subagent is available");
  const root = await client.session.create({ location: { directory: project }, title: "Token Usage Smoke", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const tui = openTui(root.id);
  await wait(() => /Token Usage/.test(tui.screen()) && /Cache Rate\s+0\.0%/.test(tui.screen()), "empty sidebar");
  assert.match(tui.screen(), /Steps\s+0\b/, "empty session shows zero steps");
  assert.doesNotMatch(tui.screen(), /Cache Write/);
  assert.doesNotMatch(tui.screen(), /Est\. Cost\b/);
  assert.doesNotMatch(tui.screen(), /\/ 128,000/, "empty session shows no context rows");
  assert.doesNotMatch(tui.screen(), /\b(?:TPS|TTFT)\b/, "empty session hides unavailable performance rows");
  await tui.save("01-empty");
  tui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  tui.send("\r");
  await wait(() => /By Model/.test(tui.screen()) && /No model usage yet/.test(tui.screen()), "empty /usage dialog");
  assert.doesNotMatch(tui.screen(), /Used \/ Limit/, "empty context does not show a fabricated zero");
  assert.match(tui.screen(), /Request usage unavailable/);
  assert.doesNotMatch(tui.screen().split("\n").find(line => line.includes("Last Request")) ?? "", /\d+:\d+/,
    "an empty request has no timestamp");
  tui.send("\x1b");
  await wait(() => !/By Model/.test(tui.screen()), "close empty usage dialog");
  console.log("PASS: packed plugin loads; empty sidebar hides zero-value and context rows and shows Steps 0");

  const switchTarget = await client.session.create({ location: { directory: project }, title: "Live Switch Target", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const switchPrompt = client.session.prompt({ sessionID: switchTarget.id, text: "SWITCH_SMOKE" });
  await wait(() => streamGates.get("SWITCH_SMOKE").started, "switch target begins streaming");
  await writeFile(path.join(work, "switch-stream-messages.json"), JSON.stringify(await client.message.list({ sessionID: switchTarget.id }), null, 2));
  tui.send("\x18");
  await new Promise(resolve => setTimeout(resolve, 50));
  tui.send("l");
  await wait(() => /Sessions for project/.test(tui.screen()) && /Live Switch Target/.test(tui.screen()), "session switch dialog");
  tui.send("Live Switch Target");
  await new Promise(resolve => setTimeout(resolve, 100));
  tui.send("\r");
  await wait(() => !/Sessions for project/.test(tui.screen()) && /TPS\s+~[\d.]+ tok\/s/.test(tui.screen())
    && /TTFT\s+[\d.]+s/.test(tui.screen()), "live performance restored after session switch");
  await tui.save("02-switched-streaming");
  streamGates.get("SWITCH_SMOKE").resolve();
  await switchPrompt;
  await wait(async () => (await client.message.list({ sessionID: switchTarget.id })).data.some(m => m.type === "assistant" && m.tokens), "switched session usage");
  const switchSnapshot = await loadSnapshot(source, switchTarget.id, new AbortController().signal);
  const switchPerformance = historicalPerformance(uniqueMessages(switchSnapshot));
  assert.ok(switchPerformance.tps && switchPerformance.tps > 0);
  await wait(() => new RegExp(`TPS\\s+${switchPerformance.tps.toFixed(1).replace(".", "\\.")} tok/s`).test(tui.screen()), "switched stream exact TPS");
  assert.doesNotMatch(tui.screen(), /TPS\s+~/, "switched stream converges to exact TPS");
  await tui.save("03-switched-complete");
  console.log("PASS: switching to an in-flight session restores live TPS/TTFT and converges to exact TPS");

  tui.send("\x18");
  await new Promise(resolve => setTimeout(resolve, 50));
  tui.send("l");
  await wait(() => /Sessions for project/.test(tui.screen()) && /Token Usage Smoke/.test(tui.screen()), "return session dialog");
  tui.send("\x1b[B");
  await new Promise(resolve => setTimeout(resolve, 100));
  tui.send("\r");
  await wait(() => !/Sessions for project/.test(tui.screen()) && /Token Usage/.test(tui.screen())
    && /Cache Rate\s+0\.0%/.test(tui.screen()) && !/\bTPS\b/.test(tui.screen()), "return to empty root session");

  const firstPrompt = client.session.prompt({ sessionID: root.id, text: "FIRST_SMOKE Return SMOKE_OK." });
  await wait(() => /TPS\s+~[\d.]+ tok\/s/.test(tui.screen()) && /TTFT\s+[\d.]+s/.test(tui.screen()), "live TPS and TTFT");
  await tui.save("04-streaming");
  streamGates.get("FIRST_SMOKE").resolve();
  await firstPrompt;
  await wait(async () => (await client.message.list({ sessionID: root.id })).data.some(m => m.type === "assistant" && m.tokens), "first usage");
  let snapshot = await loadSnapshot(source, root.id, new AbortController().signal);
  const firstSummary = summarize(uniqueMessages(snapshot), snapshot.model.catalog);
  assert.equal(firstSummary.total, 1270);
  assert.equal(firstSummary.cost, 0.00126);
  assert.equal(firstSummary.costStatus, "complete");
  const context = contextUsage(viewedMessages(snapshot), snapshot.model.context);
  assert.equal(context?.used, 1270);
  assert.equal(snapshot.model.context, 128000);
  assert.equal(context?.percent.toFixed(1), "1.0");
  const captured = await client.rpc(ContextSourceRpc).latest({ sessionID: root.id }, { location: { directory: project } });
  assert.ok(captured.estimate?.tokens.Messages > 0, "server hook records estimated message content");
  assert.ok(captured.estimate?.tokens["System Prompt"] > 0, "server hook records estimated system content");
  assert.ok(captured.estimate?.tokens["System Tools"] > 0, "server hook records estimated tool definitions");
  const performance = historicalPerformance(uniqueMessages(snapshot));
  assert.ok(performance.tps && performance.tps > 0);
  await wait(() => /Cache Read\s+1,000/.test(tui.screen()) && /Input\s+100/.test(tui.screen()), "sidebar refresh after completion");
  await wait(() => /Context\s+1,270 \/ 128,000 \(1\.0%\)/.test(tui.screen()), "context row after completion");
  const stepsAfterFirst = firstSummary.steps;
  assert.equal(stepsAfterFirst, 1);
  await wait(() => new RegExp(`Steps\\s+${stepsAfterFirst}\\b`).test(tui.screen()), "steps row after completion");
  assert.ok(lineNumber(tui.screen(), /Context\s+1,270 \/ 128,000 \(1\.0%\)/) < lineNumber(tui.screen(), /\bSteps\s+1\b/),
    "steps row follows the context row");
  assert.ok(lineNumber(tui.screen(), /\bSteps\s+1\b/) < lineNumber(tui.screen(), /\bInput\s+100\b/), "steps row precedes input");
  await wait(() => new RegExp(`TPS\\s+${performance.tps.toFixed(1).replace(".", "\\.")} tok/s`).test(tui.screen()), "exact TPS after completion");
  assert.doesNotMatch(tui.screen(), /TPS\s+~/, "completed TPS replaces the live estimate");
  assert.match(tui.screen(), /TTFT\s+[\d.]+s/);
  assert.ok(lineNumber(tui.screen(), /Context\s+1,270 \/ 128,000 \(1\.0%\)/) < lineNumber(tui.screen(), /\bInput\s+100\b/), "context row leads the panel");
  assert.equal(lineNumber(tui.screen(), /\bTPS\s+/), lineNumber(tui.screen(), /Est\. Cost\s+/) + 2, "one blank line separates usage and performance");
  assert.ok(lineNumber(tui.screen(), /\bTPS\s+/) < lineNumber(tui.screen(), /\bTTFT\s+/));
  assert.ok(lineNumber(tui.screen(), /Est\. Cost\s+/) < lineNumber(tui.screen(), /\bTPS\s+/));
  await tui.save("05-message");
  console.log("PASS: live estimates converge to exact TPS; TTFT and token/context rows update");
  await client.session.wait({ sessionID: root.id });
  const messagesBeforeUsage = (await client.message.list({ sessionID: root.id })).data.length;
  tui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  tui.send("\r");
  await wait(() => /Context Breakdown/.test(tui.screen()) && /Used \/ Limit\s+1\.3K \/ 128\.0K \(1\.0%\)/.test(tui.screen()), "root /usage dialog");
  const reported = viewedMessages(snapshot).findLast(message => message.type === "assistant" && message.tokens);
  assert.ok(reported.time.streamed, "host records the reported request's stream end");
  const requestTime = new Date(reported.time.streamed).toLocaleTimeString();
  const sourceTime = new Date(captured.estimate.capturedAt).toLocaleTimeString();
  assert.notEqual(requestTime, sourceTime, "the streamed smoke request has distinct measured and capture times");
  await wait(() => tui.screen().split("\n").some(line => line.includes("Context Breakdown") && line.includes(sourceTime)),
    "source capture time belongs to Context Breakdown");
  assert.ok(tui.screen().split("\n").some(line => line.includes("Last Request") && line.includes(requestTime)),
    "Last Request uses the reported assistant's time, not the estimate's capture time");
  assert.match(tui.screen(), /Tools?\s+█*░*\s?[\d.]+K? \(?\d+\.\d%\)?/, "breakdown ranks sources with bars");
  assert.match(tui.screen(), /Cache Read\s+1\.0K/, "last request lists the current call");
  assert.match(tui.screen(), /Session\b/, "dialog shows the session summary");
  tui.send("d");
  await wait(() => /Calls/.test(tui.screen()) && /Cache Read\s+1,000 \(78\.7%\)/.test(tui.screen()), "detailed mode keeps exact numbers");
  tui.click("d details");
  await wait(() => /1 step · 1 call · 1\.3K tokens · 83\.3% cached/.test(tui.screen())
    && /Used \/ Limit\s+1\.3K \/ 128\.0K \(1\.0%\)/.test(tui.screen()), "clicking d details switches to compact mode");
  tui.click("d details");
  await wait(() => /Calls/.test(tui.screen()) && /Cache Read\s+1,000 \(78\.7%\)/.test(tui.screen()), "clicking d details switches back to detailed mode");
  tui.send("d");
  await wait(() => /1 step · 1 call · 1\.3K tokens · 83\.3% cached/.test(tui.screen()), "d switches back to compact mode");
  assert.match(tui.screen(), /Tools\s+[█░]+\s+[\d.]+K?\s+\d+\.\d%/, "compact mode merges the tool families into Tools");
  await scrollToEnd(tui, screen => /By Model/.test(screen) && /usage-test\/small/.test(screen), "model cost in dialog");
  assert.match(tui.screen(), /Token Usage Smoke · usage-test\/small/, "identity line carries session and model");
  tui.send("d");
  await wait(() => /Rates used for Est\. Cost/.test(tui.screen()), "model rate details rendered");
  await scrollToEnd(tui, screen => /OpenCode · all incoming sizes · 1 call/.test(screen)
    && /Input\s+\$2\.00/.test(screen) && /Cache Write\s+\$3\.00/.test(screen), "applied model rates in detailed mode");
  tui.send("d");
  await scrollToEnd(tui, screen => /By Model/.test(screen) && !/OpenCode · all incoming sizes/.test(screen), "compact mode hides model rates");
  await tui.save("06-usage-dialog-root");
  tui.send("\x1b");
  await wait(() => !/By Model/.test(tui.screen()) && /Context\s+1,270 \/ 128,000/.test(tui.screen()), "close usage dialog");
  assert.equal((await client.message.list({ sessionID: root.id })).data.length, messagesBeforeUsage, "/usage does not prompt the model");
  console.log("PASS: /usage opens a native scrollable dialog with context window, request, sources, session and model costs without a prompt");
  const narrowTui = openTui(root.id, { cols: 100, rows: 28 });
  await wait(() => /SMOKE_OK/.test(narrowTui.screen()), "narrow TUI session");
  narrowTui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  narrowTui.send("\r");
  await wait(() => /Used \/ Limit/.test(narrowTui.screen()), "narrow usage dialog");
  await scrollToEnd(narrowTui, screen => /usage-test\/small\s+<\$0\.01/.test(screen), "scroll narrow usage to model cost");
  narrowTui.send("d");
  await wait(() => /Calls\s+1\b/.test(narrowTui.screen()), "narrow detailed mode rendered");
  await scrollToEnd(narrowTui, screen => /OpenCode · all incoming sizes · 1 call/.test(screen)
    && /Cache Write\s+\$3\.00/.test(screen), "narrow detailed model rates");
  await narrowTui.save("06-narrow-usage-dialog");
  narrowTui.send("\x1b");
  await wait(() => !/By Model/.test(narrowTui.screen()), "close narrow usage dialog");
  const slimTui = openTui(root.id, { cols: 48, rows: 28 });
  await wait(() => /SMOKE_OK/.test(slimTui.screen()), "slim TUI session");
  slimTui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  slimTui.send("\r");
  await wait(() => /Context Window/.test(slimTui.screen()), "slim usage dialog");
  slimTui.send("d");
  await wait(() => /Input\s+100\b/.test(slimTui.screen()), "slim detailed mode rendered");
  await scrollToEnd(slimTui, screen => /OpenCode/.test(screen) && /Cache Write\s+\$3\.00/.test(screen), "slim single-column model rates");
  const slimScreen = slimTui.screen();
  assert.ok(lineNumber(slimScreen, /Input\s+\$2\.00/) >= 0 && lineNumber(slimScreen, /Output\s+\$8\.00/) >= 0);
  assert.notEqual(lineNumber(slimScreen, /Input\s+\$2\.00/), lineNumber(slimScreen, /Output\s+\$8\.00/), "slim terminal stacks rates");
  await slimTui.save("06-slim-usage-dialog");
  slimTui.send("\x1b");
  await wait(() => !/By Model/.test(slimTui.screen()), "close slim usage dialog");
  console.log("PASS: narrow and slim terminals scroll to model rates, with single-column rates when needed");
  await client.session.prompt({ sessionID: root.id, text: "SPAWN_SMOKE_CHILD" });
  await wait(async () => (await client.session.list({ parentID: root.id })).data.length > 0, "real subagent creation");
  const child = (await client.session.list({ parentID: root.id })).data[0];
  await client.session.wait({ sessionID: root.id });
  await wait(() => /Input\s+400/.test(tui.screen()) && /Cache Read\s+4,000/.test(tui.screen()), "child usage in root sidebar");
  await tui.save("06-subagent");
  const childTui = openTui(child.id);
  await wait(() => /Token Usage · Context 1,270 \/ 128,000 \(1\.0%\) · Total 5,080 · Cost <\$0\.01 · TPS ~?[\d.]+ tok\/s/.test(childTui.screen()), "subagent usage summary");
  const childSummary = childTui.screen().split("\n").find(line => line.includes("Token Usage ·")) ?? "";
  assert.doesNotMatch(childSummary, /ctrl\+x/i, "subagent summary does not advertise a shortcut");
  assert.doesNotMatch(childTui.screen(), /Input\s+400/, "subagent metrics do not take up composer space while closed");
  await childTui.save("07-child-view");
  const childMessagesBeforeUsage = (await client.message.list({ sessionID: child.id })).data.length;
  childTui.click("Token Usage ·");
  await wait(() => /Input\s+400/.test(childTui.screen()) && /Cache Read\s+4,000/.test(childTui.screen()), "subagent usage dialog");
  assert.match(childTui.screen(), /Context\s+1,270 \/ 128,000 \(1\.0%\)/);
  assert.match(childTui.screen(), /Steps\s+4\b/);
  assert.match(childTui.screen(), /Total\s+5,080\b/);
  const childDialogScreen = childTui.screen();
  await childTui.save("07-child-usage-dialog");
  childTui.send("\x1b");
  await wait(() => /Token Usage · Context/.test(childTui.screen()) && !/Input\s+400/.test(childTui.screen()), "close subagent usage dialog");
  childTui.click("Token Usage ·");
  await wait(() => /Input\s+400/.test(childTui.screen()), "reopen subagent usage dialog with a fresh snapshot");
  childTui.send("\x1b");
  await wait(() => !/Input\s+400/.test(childTui.screen()), "close reopened subagent usage dialog");
  assert.equal((await client.message.list({ sessionID: child.id })).data.length, childMessagesBeforeUsage, "subagent usage does not prompt the model");
  snapshot = await loadSnapshot(source, child.id, new AbortController().signal);
  assert.equal(snapshot.rootID, root.id);
  assert.equal(snapshot.viewedID, child.id);
  const tree = summarize(uniqueMessages(snapshot), snapshot.model.catalog);
  assert.equal(tree.total, 5080);
  assert.equal(tree.steps, 4, "three root assistants plus one subagent assistant");
  assert.equal(tree.cost, 0.00504);
  assert.equal(tree.costStatus, "complete");
  assert.equal(contextUsage(viewedMessages(snapshot), snapshot.model.context)?.used, 1270);
  assert.match(childDialogScreen, new RegExp(`Steps\\s+${tree.steps}\\b`), "tree-wide steps in child dialog");
  assert.equal(summarize(viewedMessages(snapshot), snapshot.model.catalog).steps, 1, "viewed session counts only its own step");
  console.log("PASS: real subagent usage is counted from parent and child views; context stays session-local; steps accumulate tree-wide");
  await client.session.switchModel({ sessionID: root.id, model: { providerID: "usage-test", id: "large" } });
  await wait(async () => (await loadSnapshot(source, root.id, new AbortController().signal)).model.label === "usage-test/large", "active model switch");
  await wait(() => /Context\s+1,270 \/ 32,000 \(4\.0%\)/.test(tui.screen()), "context window follows model switch");
  const switchedSnapshot = await loadSnapshot(source, root.id, new AbortController().signal);
  const switchedSummary = summarize(uniqueMessages(switchedSnapshot), switchedSnapshot.model.catalog);
  assert.equal(switchedSummary.cost, tree.cost, "model switching does not reprice recorded history");
  tui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  tui.send("\r");
  await wait(() => /Used \/ Limit\s+1\.3K \/ 32\.0K \(4\.0%\)/.test(tui.screen()), "usage after model switch");
  assert.match(tui.screen(), /Token Usage Smoke · usage-test\/large/);
  await scrollToEnd(tui, screen => /usage-test\/small\s+<\$0\.01/.test(screen), "historical costs stay on the recorded model");
  tui.send("\x1b");
  await wait(() => !/By Model/.test(tui.screen()), "close switched usage dialog");
  await tui.save("08-model-switch");
  console.log("PASS: active model switch preserves per-message pricing and refreshes the context window");

  await client.session.switchModel({ sessionID: root.id, model: { providerID: "usage-test", id: "unknown-context" } });
  await wait(() => !/Context\s+1,270 \/ 32,000/.test(tui.screen()), "unknown context limit hides sidebar context");
  tui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  tui.send("\r");
  await wait(() => /Token Usage Smoke · usage-test\/unknown-context/.test(tui.screen())
    && /Context usage unavailable/.test(tui.screen()) && /Cache Read\s+1\.0K/.test(tui.screen()),
  "last request is available without a valid model context limit");
  assert.doesNotMatch(tui.screen(), /Used \/ Limit|Request usage unavailable/);
  assert.match(tui.screen(), /Cache Rate\s+83\.3%/);
  tui.send("d");
  await wait(() => /Cache Read\s+1,000 \(78\.7%\)/.test(tui.screen()), "request percentages do not depend on the model limit");
  await tui.save("08-unknown-context-limit");
  tui.send("\x1b");
  await wait(() => !/Context Window/.test(tui.screen()), "close unknown context usage dialog");
  await client.session.switchModel({ sessionID: root.id, model: { providerID: "usage-test", id: "large" } });
  await wait(() => /Context\s+1,270 \/ 32,000/.test(tui.screen()), "context returns with a valid limit");
  console.log("PASS: unknown context limit preserves last-request tokens, percentages and cache rate");

  const officialTarget = await client.session.create({ location: { directory: project }, title: "Official Price Fallback", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  await client.session.switchModel({ sessionID: officialTarget.id, model: { providerID: "usage-test", id: "gpt-5.6-luna" } });
  await client.session.prompt({ sessionID: officialTarget.id, text: "Return SMOKE_OK." });
  await client.session.wait({ sessionID: officialTarget.id });
  await wait(async () => (await client.message.list({ sessionID: officialTarget.id })).data.some(m => m.type === "assistant" && m.tokens), "official fallback usage");
  const officialSnapshot = await loadSnapshot(source, officialTarget.id, new AbortController().signal);
  const officialSummary = summarize(uniqueMessages(officialSnapshot), officialSnapshot.model.catalog);
  assert.ok(Math.abs(officialSummary.cost - 0.000149) < 1e-12);
  assert.equal(officialSummary.costStatus, "complete");
  const officialTui = openTui(officialTarget.id);
  await wait(() => /Est\. Cost\s+<\$0\.01/.test(officialTui.screen()), "official fallback cost in sidebar");
  officialTui.send("/usage");
  await new Promise(resolve => setTimeout(resolve, 250));
  officialTui.send("\r");
  await wait(() => /By Model/.test(officialTui.screen()), "official fallback usage dialog");
  officialTui.send("d");
  await wait(() => /Calls/.test(officialTui.screen()), "official fallback detailed mode");
  await scrollToEnd(officialTui, screen => /Built-in snapshot · ≤272,000 incoming · 1 call/.test(screen)
    && /Input\s+\$0\.20/.test(screen), "fallback rate source in detailed mode");
  officialTui.send("\x1b");
  await officialTui.save("09-official-price-fallback");
  console.log("PASS: a model with no OpenCode price uses the packaged manufacturer price");
  const longTtftTarget = await client.session.create({ location: { directory: project }, title: "Long TTFT Smoke", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const longTtftTui = openTui(longTtftTarget.id);
  await wait(() => /Token Usage/.test(longTtftTui.screen()), "long TTFT sidebar");
  const longTtftPrompt = client.session.prompt({ sessionID: longTtftTarget.id, text: "LONG_TTFT_SMOKE Return SMOKE_OK." });
  await wait(() => /TPS\s+~([\d.]+) tok\/s/.test(longTtftTui.screen()), "live TPS after long TTFT");
  const longTtftLive = Number(longTtftTui.screen().match(/TPS\s+~([\d.]+) tok\/s/)?.[1]);
  assert.ok(longTtftLive > 5, `long TTFT must not pin live TPS near zero, got ${longTtftLive}`);
  streamGates.get("LONG_TTFT_SMOKE").resolve();
  await longTtftPrompt;
  await wait(async () => (await client.message.list({ sessionID: longTtftTarget.id })).data.some(m => m.type === "assistant" && m.tokens), "long TTFT usage");
  await wait(() => /TPS\s+[\d.]+ tok\/s/.test(longTtftTui.screen()) && !/TPS\s+~/.test(longTtftTui.screen()), "long TTFT converges to exact TPS");
  await longTtftTui.save("10-long-ttft");
  console.log("PASS: a 2s TTFT followed by fast output shows responsive live TPS and converges to exact TPS");
  const reasoningTarget = await client.session.create({ location: { directory: project }, title: "Reasoning Smoke", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const reasoningTui = openTui(reasoningTarget.id);
  await wait(() => /Token Usage/.test(reasoningTui.screen()), "reasoning sidebar");
  const reasoningPrompt = client.session.prompt({ sessionID: reasoningTarget.id, text: "REASONING_SMOKE Return SMOKE_OK." });
  await wait(() => /TPS\s+~([\d.]+) tok\/s/.test(reasoningTui.screen()), "reasoning-style live TPS");
  const reasoningLive = Number(reasoningTui.screen().match(/TPS\s+~([\d.]+) tok\/s/)?.[1]);
  assert.ok(reasoningLive > 5, `reasoning-style live TPS reflects visible speed, got ${reasoningLive}`);
  streamGates.get("REASONING_SMOKE").resolve();
  await reasoningPrompt;
  await wait(async () => (await client.message.list({ sessionID: reasoningTarget.id })).data.some(m => m.type === "assistant" && m.tokens?.reasoning === 200), "reasoning usage");
  await wait(() => /TPS\s+[\d.]+ tok\/s/.test(reasoningTui.screen()) && !/TPS\s+~/.test(reasoningTui.screen()), "reasoning converges to provider TPS");
  await reasoningTui.save("11-reasoning");
  console.log("PASS: reasoning-style streams show visible-speed live TPS, then switch to provider-reported TPS");
  const cleanupTarget = await client.session.create({ location: { directory: project }, title: "Context Cleanup Smoke" });
  await client.session.prompt({ sessionID: cleanupTarget.id, text: "Return SMOKE_OK." });
  await client.session.wait({ sessionID: cleanupTarget.id });
  await wait(async () => (await client.rpc(ContextSourceRpc).latest({ sessionID: cleanupTarget.id },
    { location: { directory: project } })).estimate !== null, "context stored before deletion");
  await client.session.remove({ sessionID: cleanupTarget.id });
  await wait(async () => (await client.rpc(ContextSourceRpc).latest({ sessionID: cleanupTarget.id },
    { location: { directory: project } })).estimate === null, "deleted session context removed");
  console.log("PASS: session deletion removes its persisted context estimate");

  // Version upgrades must recheck the host's fork-copy and compaction projection semantics.
  const semanticsTarget = await client.session.create({ location: { directory: project }, title: "Host Semantics Smoke", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  await client.session.prompt({ sessionID: semanticsTarget.id, text: "Return SMOKE_OK." });
  await client.session.wait({ sessionID: semanticsTarget.id });
  const beforeCompaction = await loadSnapshot(source, semanticsTarget.id, new AbortController().signal);
  const originalAssistant = viewedMessages(beforeCompaction).find(message => message.type === "assistant" && message.tokens);
  assert.ok(originalAssistant, "host semantics source has reported usage");
  const fork = await client.session.fork({ sessionID: semanticsTarget.id });
  let forkSnapshot = await loadSnapshot(source, fork.id, new AbortController().signal);
  assert.equal(forkSnapshot.rootID, fork.id, "a fork is a separate root, not a subagent");
  assert.equal(forkSnapshot.sessions.get(fork.id).fork?.sessionID, semanticsTarget.id);
  const inherited = viewedMessages(forkSnapshot).filter(message => message.type === "assistant");
  assert.equal(inherited.length, 1, "fork projects the source assistant");
  assert.match(inherited[0].id, /_\d+$/, "inherited copy IDs retain the source-sequence suffix");
  assert.equal(summarize(uniqueMessages(forkSnapshot), forkSnapshot.model.catalog).total, 0, "inherited usage stays with its original source");
  assert.equal(summarize(uniqueMessages(forkSnapshot)).steps, 0);
  assert.equal(contextUsage(viewedMessages(forkSnapshot), forkSnapshot.model.context)?.used, 1270, "inherited usage still counts toward the viewed context");
  await client.session.prompt({ sessionID: fork.id, text: "Return SMOKE_OK in the fork." });
  await client.session.wait({ sessionID: fork.id });
  forkSnapshot = await loadSnapshot(source, fork.id, new AbortController().signal);
  const forkSummary = summarize(uniqueMessages(forkSnapshot), forkSnapshot.model.catalog);
  assert.equal(forkSummary.total, 1270, "only the fork's own call is charged");
  assert.equal(forkSummary.steps, 1);
  assert.equal(forkSummary.cost, 0.00126);
  console.log("PASS: real forks retain copy IDs, independent roots, inherited context and source-only billing");

  await client.session.compact({ sessionID: semanticsTarget.id });
  await client.session.wait({ sessionID: semanticsTarget.id });
  const compacted = await loadSnapshot(source, semanticsTarget.id, new AbortController().signal);
  const compactedMessages = viewedMessages(compacted);
  await writeFile(path.join(work, "compaction-messages.json"), JSON.stringify(compactedMessages, null, 2));
  const compactionIndex = compactedMessages.findIndex(message => message.type === "compaction");
  const compaction = compactedMessages[compactionIndex];
  assert.equal(compaction?.status, "completed", "host compaction projects the completed status");
  assert.ok(compactionIndex > compactedMessages.findIndex(message => message.id === originalAssistant.id), "ascending history retains the assistant before compaction");
  assert.equal(contextUsage(compactedMessages, compacted.model.context), undefined, "completed compaction clears the previous assistant context");
  await client.session.prompt({ sessionID: semanticsTarget.id, text: "Return SMOKE_OK after compaction." });
  await client.session.wait({ sessionID: semanticsTarget.id });
  const afterCompaction = await loadSnapshot(source, semanticsTarget.id, new AbortController().signal);
  const afterMessages = viewedMessages(afterCompaction);
  assert.ok(afterMessages.findIndex(message => message.type === "compaction") < afterMessages.findLastIndex(message => message.type === "assistant"), "new assistant follows compaction in ascending history");
  assert.equal(contextUsage(afterMessages, afterCompaction.model.context)?.used, 1270);
  assert.equal(summarize(uniqueMessages(afterCompaction)).steps, 2, "compaction is not an assistant step");
  console.log("PASS: real completed compaction resets viewed context and preserves ascending full history");

  await writeFile(path.join(work, "result.json"), JSON.stringify({ version: host.version, binary: opencode, root: root.id, child: child.id, switchTarget: switchTarget.id, officialTarget: officialTarget.id, total: 5080, cost: tree.cost, officialFallbackCost: officialSummary.cost, performance, switchPerformance, context: { used: 1270, limitBefore: 128000, limitAfter: 32000, percentAfter: "4.0" }, hostSemantics: { session: semanticsTarget.id, fork: fork.id, inheritedCopies: inherited.length, forkTotal: forkSummary.total, compactionStatus: compaction.status }, package: packed[0].filename, files }, null, 2));
} finally {
  for (const gate of streamGates.values()) gate.resolve();
  eventController.abort();
  await eventCapture;
  for (const [index, terminal] of terminals.entries()) {
    await terminal.save(`final-${index}`);
    terminal.process.kill("SIGTERM");
    terminal.terminal.dispose();
  }
  server.kill("SIGTERM");
  mock.closeAllConnections();
  await new Promise(resolve => mock.close(resolve));
  await writeFile(path.join(work, "server.log"), serverLog.replace(/server password \S+/g, "server password [redacted]"));
  await writeFile(path.join(work, "requests.json"), JSON.stringify(requests, null, 2));
  await writeFile(path.join(work, "stream-events.json"), JSON.stringify(streamEvents, null, 2));
}
