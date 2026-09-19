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
assert.match(opencodeVersion, /^opencode v2\.0\.(?:9|10)\b/, "OpenCode v2.0.9 or v2.0.10 is required");

const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", work], { cwd: repo, encoding: "utf8", env: npmEnv }));
const files = packed[0].files.map(file => file.path);
assert.ok(files.includes("dist/index.js") && files.includes("dist/tui.js") && files.includes("index.js") && files.includes("tui.js"));
assert.ok(files.every(file => !file.startsWith("test/") && !file.startsWith("node_modules/")));
await writeFile(path.join(installation, "package.json"), JSON.stringify({ private: true, type: "module" }));
execFileSync("npm", ["install", path.join(work, packed[0].filename), "--no-audit", "--no-fund", "--prefer-offline"], { cwd: installation, env: npmEnv, stdio: "inherit", timeout: 120_000 });
const plugin = path.join(installation, "node_modules/opencode-token-usage");
const { createSource, loadSnapshot, uniqueMessages, viewedMessages } = await import(path.join(plugin, "dist/source.js"));
const { contextUsage, summarize } = await import(path.join(plugin, "dist/usage.js"));

let childAgent = "general";
const requests = [];
const mock = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    const lastUser = data.messages.findLastIndex(message => message.role === "user");
    const spawnChild = JSON.stringify(data.messages[lastUser]).includes("SPAWN_SMOKE_CHILD")
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
      chunk({ role: "assistant", ...(toolCalls ? { tool_calls: toolCalls } : { content }) });
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
const openTui = sessionID => {
  const terminal = new xterm.Terminal({ cols: 160, rows: 54, allowProposedApi: true });
  const process = spawn("python3", [path.join(repo, "scripts/terminal.py"), "opencode", "--server", `http://127.0.0.1:${port}`, "--session", sessionID], { cwd: project, env });
  let raw = "";
  process.stdout.on("data", data => { raw += data; terminal.write(data.toString()); });
  process.stderr.on("data", data => { raw += data; });
  terminal.onData(data => { if (!process.stdin.destroyed) process.stdin.write(data); });
  const screen = () => Array.from({ length: terminal.rows }, (_, line) => terminal.buffer.active.getLine(line)?.translateToString(true) ?? "").join("\n");
  const save = async name => {
    await writeFile(path.join(work, `${name}.txt`), screen());
    await writeFile(path.join(work, `${name}.ansi`), raw);
  };
  const entry = { process, screen, save, terminal };
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
  const agents = await client.agent.list({ location: { directory: project } });
  childAgent = agents.data.find(agent => agent.mode !== "primary")?.id;
  assert.ok(childAgent, "a built-in subagent is available");
  const root = await client.session.create({ location: { directory: project }, title: "Token Usage Smoke", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const tui = openTui(root.id);
  await wait(() => /Token Usage/.test(tui.screen()) && /Cache Rate\s+0\.0%/.test(tui.screen()), "empty sidebar");
  assert.doesNotMatch(tui.screen(), /Cache Write/);
  assert.doesNotMatch(tui.screen(), /\bCost\b/);
  assert.doesNotMatch(tui.screen(), /\/ 128,000/, "empty session shows no context rows");
  await tui.save("01-empty");
  console.log("PASS: packed plugin loads; empty sidebar hides zero-value and context rows");
  await client.session.prompt({ sessionID: root.id, text: "Return SMOKE_OK." });
  await wait(async () => (await client.message.list({ sessionID: root.id })).data.some(m => m.type === "assistant" && m.tokens), "first usage");
  let snapshot = await loadSnapshot(source, root.id, new AbortController().signal);
  assert.equal(summarize(uniqueMessages(snapshot), snapshot.model.prices).total, 1270);
  const context = contextUsage(viewedMessages(snapshot), snapshot.model.context);
  assert.equal(context?.used, 1270);
  assert.equal(snapshot.model.context, 128000);
  assert.equal(context?.percent.toFixed(1), "1.0");
  await wait(() => /Cache Read\s+1,000/.test(tui.screen()) && /Input\s+100/.test(tui.screen()), "sidebar refresh after completion");
  await wait(() => /Context\s+1,270 \/ 128,000 \(1\.0%\)/.test(tui.screen()), "context row after completion");
  assert.ok(lineNumber(tui.screen(), /Context\s+1,270 \/ 128,000 \(1\.0%\)/) < lineNumber(tui.screen(), /\bInput\s+100\b/), "context row leads the panel");
  await tui.save("02-message");
  console.log("PASS: real message completion updates five token categories and context usage");
  await client.session.wait({ sessionID: root.id });
  await client.session.prompt({ sessionID: root.id, text: "SPAWN_SMOKE_CHILD" });
  await wait(async () => (await client.session.list({ parentID: root.id })).data.length > 0, "real subagent creation");
  const child = (await client.session.list({ parentID: root.id })).data[0];
  await client.session.wait({ sessionID: root.id });
  await wait(() => /Input\s+400/.test(tui.screen()) && /Cache Read\s+4,000/.test(tui.screen()), "child usage in root sidebar");
  await tui.save("03-subagent");
  const childTui = openTui(child.id);
  await wait(() => /Input\s+400/.test(childTui.screen()) && /Cache Read\s+4,000/.test(childTui.screen()), "same tree in child sidebar");
  assert.match(childTui.screen(), /Context\s+1,270 \/ 128,000 \(1\.0%\)/);
  await childTui.save("04-child-view");
  snapshot = await loadSnapshot(source, child.id, new AbortController().signal);
  assert.equal(snapshot.rootID, root.id);
  assert.equal(snapshot.viewedID, child.id);
  assert.equal(summarize(uniqueMessages(snapshot), snapshot.model.prices).total, 5080);
  assert.equal(contextUsage(viewedMessages(snapshot), snapshot.model.context)?.used, 1270);
  console.log("PASS: real subagent usage is counted from parent and child views; context stays session-local");
  await client.session.switchModel({ sessionID: root.id, model: { providerID: "usage-test", id: "large" } });
  await wait(async () => (await loadSnapshot(source, root.id, new AbortController().signal)).model.label === "usage-test/large", "active model switch");
  await wait(() => /Context\s+1,270 \/ 32,000 \(4\.0%\)/.test(tui.screen()), "context window follows model switch");
  await tui.save("05-model-switch");
  console.log("PASS: active model switch refreshes price selection and context window");
  await writeFile(path.join(work, "result.json"), JSON.stringify({ version: opencodeVersion.replace(/^opencode v/, ""), root: root.id, child: child.id, total: 5080, context: { used: 1270, limitBefore: 128000, limitAfter: 32000, percentAfter: "4.0" }, package: packed[0].filename, files }, null, 2));
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
