import type { SessionContext } from "@opencode/plugin/promise/session";

export const sourceLabels = ["Messages", "System Tools", "System Prompt", "Skills", "MCP Tools", "Other"] as const;
export type SourceLabel = typeof sourceLabels[number];

/** A best-effort inventory of the last assembled request, never provider-reported usage. */
export interface ContextSources {
  capturedAt: number;
  model: string;
  tokens: Record<SourceLabel, number>;
}

const estimate = (text: string) => text ? Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4)) : 0;

/** Remove a recognisable instruction block while retaining the rest for another category. */
function extract(text: string, pattern: RegExp): { rest: string; found: string } {
  let found = "";
  const rest = text.replace(pattern, match => { found += match; return ""; });
  return { rest, found };
}

function isMcpTool(name: string, servers: readonly string[]) {
  return servers.some(server => name.startsWith(`${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_`));
}

function classifySystem(text: string, tokens: Record<SourceLabel, number>, mcpServers: readonly string[]) {
  // Instruction sources are joined with blank lines by OpenCode; the Code Mode
  // catalog precedes project instructions, skills and MCP guidance in that list.
  let section = extract(text, /(?:# Code Mode|The Code Mode tool catalog(?: below)? is (?:partial|complete)\.|The Code Mode tool catalog has changed\.)[\s\S]*?(?=\n\n(?:Instructions from:|Skills provide specialized instructions|New skills are available|<mcp_instructions>|New MCP server instructions)|$)/g);
  let namespace = "";
  const codeMode = { "System Tools": [] as string[], "MCP Tools": [] as string[] };
  for (const line of section.found.split("\n")) {
    const heading = /^- ([a-zA-Z0-9_-]+) \(\d+ tools?/.exec(line);
    if (heading) namespace = heading[1]!;
    const mcp = mcpServers.some(server => {
      const name = server.replace(/[^a-zA-Z0-9_-]/g, "_");
      return namespace === name || line.includes(`tools.${name}`);
    });
    codeMode[mcp ? "MCP Tools" : "System Tools"].push(line);
  }
  tokens["System Tools"] += estimate(codeMode["System Tools"].join("\n"));
  tokens["MCP Tools"] += estimate(codeMode["MCP Tools"].join("\n"));
  text = section.rest;
  section = extract(text, /Skills provide specialized instructions[\s\S]*?(?:<\/available_skills>|No skills are currently available\.)/g);
  tokens.Skills += estimate(section.found);
  text = section.rest;
  section = extract(text, /<mcp_instructions>[\s\S]*?<\/mcp_instructions>/g);
  tokens["MCP Tools"] += estimate(section.found);
  tokens["System Prompt"] += estimate(section.rest);
}

export function estimateContextSources(
  request: Pick<SessionContext, "system" | "messages" | "tools" | "model">,
  mcpServers: readonly string[] = [],
  capturedAt = Date.now(),
): ContextSources {
  const tokens = Object.fromEntries(sourceLabels.map(label => [label, 0])) as Record<SourceLabel, number>;
  for (const part of request.system) classifySystem(part.text, tokens, mcpServers);
  for (const [name, tool] of Object.entries(request.tools)) {
    const size = estimate(`${name} ${tool.description} ${JSON.stringify(tool.input)}`);
    tokens[isMcpTool(name, mcpServers) ? "MCP Tools" : "System Tools"] += size;
  }
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "text") {
        if (message.role === "system") {
          classifySystem(part.text, tokens, mcpServers);
          continue;
        }
        const section = extract(part.text, /<skill_content\b[\s\S]*?<\/skill_content>/g);
        tokens.Skills += estimate(section.found);
        tokens.Messages += estimate(section.rest);
        continue;
      }
      if (part.type === "media") {
        // Media payload sizes do not translate to provider token counts.
        tokens.Other += estimate(part.filename ?? part.mediaType);
        continue;
      }
      if (part.type === "tool-call") {
        tokens.Messages += estimate(`${part.name} ${JSON.stringify(part.input)}`);
        continue;
      }
      if (part.type === "tool-result") {
        const result = part.result;
        const content = result.type === "content"
          ? result.value.map(item => item.type === "file" ? `${item.name ?? ""} ${item.mime}` : item.text).join(" ")
          : JSON.stringify(result.value);
        tokens.Messages += estimate(`${part.name} ${content}`);
        continue;
      }
      tokens.Other += estimate(JSON.stringify(part));
    }
  }
  return { capturedAt, model: `${request.model.providerID}/${request.model.id}`, tokens };
}

export function parseContextSources(value: unknown): ContextSources | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<ContextSources>;
  if (typeof input.capturedAt !== "number" || !Number.isFinite(input.capturedAt) || typeof input.model !== "string") return undefined;
  if (!input.tokens || typeof input.tokens !== "object") return undefined;
  if (!sourceLabels.every(label => typeof input.tokens?.[label] === "number" && Number.isFinite(input.tokens[label]) && input.tokens[label] >= 0)) return undefined;
  return input as ContextSources;
}

export interface BreakdownRow {
  label: string;
  tokens: number;
  percent: number;
}

/**
 * Presentation rows for the estimated sources, largest first. Compact mode merges the
 * two tool families into one `Tools` row and hides empty rows; detailed mode keeps the
 * six stored labels apart, including zeroes.
 */
export function breakdownRows(sources: ContextSources, detailed: boolean): readonly BreakdownRow[] {
  const t = sources.tokens;
  const entries: readonly (readonly [string, number])[] = detailed
    ? sourceLabels.map(label => [label, t[label]] as const)
    : [["Messages", t.Messages], ["Tools", t["System Tools"] + t["MCP Tools"]],
      ["System Prompt", t["System Prompt"]], ["Skills", t.Skills], ["Other", t.Other]] as const;
  const sum = sourceLabels.reduce((total, label) => total + t[label], 0);
  return entries
    .filter(([, tokens]) => detailed || tokens > 0)
    .map(([label, tokens]) => ({ label, tokens, percent: sum ? tokens / sum * 100 : 0 }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}
