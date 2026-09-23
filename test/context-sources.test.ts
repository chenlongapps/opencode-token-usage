import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { breakdownRows, estimateContextSources, parseContextSources, sourceLabels } from "../src/context-sources.js";

test("last request estimates six distinct input sources without treating them as provider usage", () => {
  const request = {
    model: { providerID: "test", id: "small" },
    system: [{ type: "text", text: "Base system prompt.\n\nSkills provide specialized instructions.\n<available_skills>skill description</available_skills>\n<mcp_instructions>server guidance</mcp_instructions>" },
      { type: "text", text: "The Code Mode tool catalog below is partial.\n## Available tools\n- tools.files.read\n- tools.github.search" }],
    tools: {
      read: { description: "Read files", input: { type: "object", properties: {} } },
      github_search: { description: "Search issues", input: { type: "object", properties: {} } },
    },
    messages: [
      { role: "user", content: [{ type: "text", text: "Question <skill_content id=\"guide\">Skill instructions</skill_content>" }] },
      { role: "tool", content: [{ type: "tool-result", name: "read", id: "tool-1", result: { type: "text", value: "File contents" } }] },
      { role: "user", content: [{ type: "media", mediaType: "image/png", data: "encoded" }] },
    ],
  } as unknown as Pick<SessionContext, "system" | "messages" | "tools" | "model">;
  const sources = estimateContextSources(request, ["github"], 1234);
  assert.equal(sources.model, "test/small");
  assert.equal(sources.capturedAt, 1234);
  for (const [, tokens] of Object.entries(sources.tokens)) assert.ok(tokens > 0);
  const compact = breakdownRows(sources, false);
  assert.equal(compact.length, 5, "compact mode merges the two tool families");
  assert.equal(compact.find(row => row.label === "Tools")?.tokens, sources.tokens["System Tools"] + sources.tokens["MCP Tools"]);
  assert.ok(Math.abs(compact.reduce((sum, row) => sum + row.percent, 0) - 100) < 1e-10);
  assert.deepEqual(compact.map(row => row.label), [...compact].sort((a, b) => b.tokens - a.tokens).map(row => row.label),
    "rows are ordered by size so the biggest consumer leads");
  assert.deepEqual([...breakdownRows(sources, true).map(row => row.label)].sort(), [...sourceLabels].sort(),
    "detailed mode keeps the six stored labels apart");
  assert.deepEqual(parseContextSources(JSON.parse(JSON.stringify(sources))), sources);
  assert.equal(parseContextSources({ ...sources, tokens: { ...sources.tokens, Skills: Infinity } }), undefined);
  assert.equal(parseContextSources({ ...sources, tokens: { ...sources.tokens, Other: -1 } }), undefined);
});

test("a request without identifiable skills or MCP tools keeps those estimates at zero", () => {
  const request = {
    model: { providerID: "test", id: "small" }, system: [{ type: "text", text: "Base instructions" }],
    tools: {}, messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  } as unknown as Pick<SessionContext, "system" | "messages" | "tools" | "model">;
  const sources = estimateContextSources(request, []);
  assert.equal(sources.tokens.Skills, 0);
  assert.equal(sources.tokens["MCP Tools"], 0);
  assert.ok(sources.tokens.Messages > 0);
  assert.ok(sources.tokens["System Prompt"] > 0);
});

test("tool catalog stops at the next instruction source and keeps MCP namespaces separate", () => {
  const request = {
    model: { providerID: "test", id: "small" },
    system: [{ type: "text", text: [
      "Base instructions",
      "The Code Mode tool catalog below is partial.\n\n## Available tools\n- files (1 tool)\n  - tools.files.read()\n- github (1 tool)\n  - tools.github.search()",
      "Instructions from: AGENTS.md\nProject rules must stay in the system prompt.",
      "Skills provide specialized instructions and workflows.\n<available_skills><skill>example</skill></available_skills>",
      "<mcp_instructions><server name=\"github\">guidance</server></mcp_instructions>",
    ].join("\n\n") }],
    tools: {}, messages: [],
  } as unknown as Pick<SessionContext, "system" | "messages" | "tools" | "model">;
  const sources = estimateContextSources(request, ["github"]);
  assert.ok(sources.tokens["System Tools"] > 0);
  assert.ok(sources.tokens["MCP Tools"] > 0);
  assert.ok(sources.tokens.Skills > 0);
  assert.ok(sources.tokens["System Prompt"] > 0, "project rules are not a tool definition");
});

test("tool-result files do not count inline media URIs as text tokens", () => {
  const request = {
    model: { providerID: "test", id: "small" }, system: [], tools: {},
    messages: [{ role: "tool", content: [{ type: "tool-result", id: "call", name: "image", result: {
      type: "content", value: [{ type: "file", mime: "image/png", uri: `data:image/png;base64,${"A".repeat(20_000)}` }],
    } }] }],
  } as unknown as Pick<SessionContext, "system" | "messages" | "tools" | "model">;
  assert.ok(estimateContextSources(request).tokens.Messages < 100);
});

test("breakdown rows hide empty categories in compact mode and keep them in detailed mode", () => {
  const sources = {
    capturedAt: 1, model: "test/model",
    tokens: { Messages: 40, "System Tools": 0, "System Prompt": 3, Skills: 2, "MCP Tools": 0, Other: 1 },
  };
  assert.deepEqual(breakdownRows(sources, false).map(row => [row.label, row.tokens]), [
    ["Messages", 40], ["System Prompt", 3], ["Skills", 2], ["Other", 1],
  ]);
  const detailed = breakdownRows(sources, true);
  assert.equal(detailed.length, 6);
  assert.equal(detailed.filter(row => row.tokens === 0).length, 2, "detailed mode keeps zeroes visible");
});
