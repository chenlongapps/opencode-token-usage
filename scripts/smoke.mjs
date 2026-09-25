import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { OpenCode } from "@opencode/client";
import xterm from "@xterm/headless";

const repo = fileURLToPath(new URL("..", import.meta.url));
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
  OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ session: { sidebar: "auto" }, animations: false }),
};
delete env.OPENCODE_CONFIG;
delete env.OPENCODE_CONFIG_CONTENT;
const npmEnv = { ...process.env };
if (!npmEnv.npm_config_cache && !npmEnv.NPM_CONFIG_CACHE) npmEnv.npm_config_cache = path.join(work, "npm-cache");
console.log(`Smoke artifacts: ${work}`);
const opencodeVersion = execFileSync("opencode", ["--version"], { env, encoding: "utf8" }).trim();
assert.match(opencodeVersion, /^opencode v2\.0\.(?:9|10|11)\b/, "OpenCode v2.0.9, v2.0.10 or v2.0.11 is required");
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
const mock = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    const lastUser = data.messages.findLastIndex(message => message.role === "user");
    const userText = JSON.stringify(data.messages[lastUser]);
    const switchSmoke = userText.includes("SWITCH_SMOKE");
    const spawnChild = userText.includes("SPAWN_SMOKE_CHILD")
      && !data.messages.slice(lastUser + 1).some(message => message.role === "tool");
    const tool = data.tools?.find(tool => tool.function.name === "subagent");
    const toolCalls = spawnChild && tool ? [{ index: 0, id: "usage-smoke-child", type: "function", function: {
      name: "subagent", arguments: JSON.stringify({ agent: childAgent, description: "Usage smoke child", prompt: "Return CHILD_DONE." }),
    } }] : undefined;
    const content = toolCalls ? undefined : "SMOKE_OK";
    const usage = {
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
      await new Promise(resolve => setTimeout(resolve, 300));
      chunk(toolCalls ? { tool_calls: toolCalls } : { content: content.slice(0, 4) });
      await new Promise(resolve => setTimeout(resolve, switchSmoke ? 2_500 : 700));
      if (content) chunk({ content: content.slice(4) });
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
const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env });
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
const wait = async (check, label, timeout = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await check()) return; } catch { /* Startup and projection may still be pending. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const terminals = [];
const lineNumber = (screen, pattern) => screen.split("\n").findIndex(line => pattern.test(line));
const openTui = (sessionID, size = { cols: 160, rows: 54 }) => {
  const terminal = new xterm.Terminal({ ...size, allowProposedApi: true });
  const process = spawn("python3", [path.join(repo, "scripts/terminal.py"), "opencode", "--server", `http://127.0.0.1:${port}`, "--session", sessionID], {
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
  tui.send("\x1b");
  await wait(() => !/By Model/.test(tui.screen()), "close empty usage dialog");
  console.log("PASS: packed plugin loads; empty sidebar hides zero-value and context rows and shows Steps 0");

  const switchTarget = await client.session.create({ location: { directory: project }, title: "Live Switch Target", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const switchPrompt = client.session.prompt({ sessionID: switchTarget.id, text: "SWITCH_SMOKE" });
  await new Promise(resolve => setTimeout(resolve, 650));
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

  const firstPrompt = client.session.prompt({ sessionID: root.id, text: "Return SMOKE_OK." });
  await wait(() => /TPS\s+~[\d.]+ tok\/s/.test(tui.screen()) && /TTFT\s+[\d.]+s/.test(tui.screen()), "live TPS and TTFT");
  await tui.save("04-streaming");
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
  tui.send("\x1b[F"); // End scrolls to the model breakdown.
  await wait(() => /By Model/.test(tui.screen()) && /usage-test\/small/.test(tui.screen()), "model cost in dialog");
  assert.match(tui.screen(), /Token Usage Smoke · usage-test\/small/, "identity line carries session and model");
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
  narrowTui.send("\x1b[F");
  await wait(() => /usage-test\/small\s+<\$0\.01/.test(narrowTui.screen()), "scroll narrow usage to model cost");
  await narrowTui.save("06-narrow-usage-dialog");
  narrowTui.send("\x1b");
  await wait(() => !/By Model/.test(narrowTui.screen()), "close narrow usage dialog");
  console.log("PASS: narrow terminal scrolls to the model cost and closes the usage dialog");
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
  tui.send("\x1b[F");
  await wait(() => /usage-test\/small\s+<\$0\.01/.test(tui.screen()), "historical costs stay on the recorded model");
  tui.send("\x1b");
  await wait(() => !/By Model/.test(tui.screen()), "close switched usage dialog");
  await tui.save("08-model-switch");
  console.log("PASS: active model switch preserves per-message pricing and refreshes the context window");

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
  await officialTui.save("09-official-price-fallback");
  console.log("PASS: a model with no OpenCode price uses the packaged manufacturer price");
  await writeFile(path.join(work, "result.json"), JSON.stringify({ version: opencodeVersion.replace(/^opencode v/, ""), root: root.id, child: child.id, switchTarget: switchTarget.id, officialTarget: officialTarget.id, total: 5080, cost: tree.cost, officialFallbackCost: officialSummary.cost, performance, switchPerformance, context: { used: 1270, limitBefore: 128000, limitAfter: 32000, percentAfter: "4.0" }, package: packed[0].filename, files }, null, 2));
} finally {
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
}
