/** Reviewed ownership when the API's Provider ID differs from its LAB ID.
 * These do not grant ownership of any other LAB's models hosted there. */
export const PROVIDER_LABS: ReadonlyMap<string, string> = new Map([
  ["alibaba-cn", "alibaba"],
  ["amazon-bedrock", "amazon"], // AWS develops Nova and serves it through Bedrock.
  ["arcee", "arcee-ai"],
  ["byteplus", "bytedance-seed"], // International ModelArk.
  ["google-vertex", "google"], // Vertex also relays unrelated LABs.
  ["longcat", "meituan"],
  ["minimax-cn", "minimax"],
  ["moonshotai-cn", "moonshotai"],
  ["stepfun-ai", "stepfun"],
  ["tencent-tokenhub", "tencent"],
  ["volcengine", "bytedance-seed"],
  ["zai", "zhipuai"],
]);

/** Exact namespacing aliases for caller-supplied model IDs, not ownership. */
export const LAB_ALIASES: ReadonlyMap<string, string> = new Map([
  ...PROVIDER_LABS,
  ["mistralai", "mistral"],
  ["qwen", "alibaba"],
  ["x-ai", "xai"],
  ["z-ai", "zhipuai"],
]);

/** Reviewed compatibility spellings, only when no real SKU takes precedence.
 * Dated/versioned SKUs with separate upstream identities are not aliases. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "alibaba/qwen3.5-plus-20260420": "alibaba/qwen3.5-plus-2026-04-20",
  "alibaba/qwen3.8-max-0902": "alibaba/qwen3.8-max",
  "anthropic/claude-opus-4.7": "anthropic/claude-opus-4-7",
  "mistral/mistral-medium-3-5": "mistral/mistral-medium-2604",
  "mistral/mistral-medium-3-5-26-04": "mistral/mistral-medium-2604",
  "openai/gpt-chat-latest": "openai/chat-latest",
  "sakana/fugu-max-v1.0": "sakana/fugu-max",
  "sakana/fugu-ultra-v2.0": "sakana/fugu-ultra-v2",
  "upstage/solar-pro4-260806": "upstage/solar-pro4",
  "bytedance-seed/seed-2-1-turbo": "bytedance-seed/seed-2.1-turbo",
  "bytedance-seed/dola-seed-2-1-turbo": "bytedance-seed/seed-2.1-turbo",
  "bytedance-seed/dola-seed-2-1-turbo-260628": "bytedance-seed/seed-2.1-turbo",
};
