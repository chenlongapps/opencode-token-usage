/** Gateway slugs that differ from the manufacturer provider ID. The matching
 * code handles identical slugs, Bedrock/Vertex wrappers and terminal free
 * suffixes without entries in this table. */
export const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  "arcee-ai": "arcee",
  "bytedance-seed": "volcengine",
  "meituan": "longcat",
  "mistralai": "mistral",
  "qwen": "alibaba",
  "stepfun": "stepfun-ai",
  "tencent": "tencent-tokenhub",
  "x-ai": "xai",
  "z-ai": "zai",
};

/** Exact SKU/version differences, not fuzzy model-name matching. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "alibaba/qwen3.5-plus-20260420": "alibaba/qwen3.5-plus-2026-04-20",
  "alibaba/qwen3.8-max-0902": "alibaba/qwen3.8-max",
  "deepseek/deepseek-flash": "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-flash": "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-flash-0731": "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-flash-vision-exp": "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-pro": "deepseek/deepseek-v4-pro-0813",
  "mistral/mistral-medium-3-5": "mistral/mistral-medium-2604",
  "mistral/mistral-medium-3-5-26-04": "mistral/mistral-medium-2604",
  "openai/gpt-chat-latest": "openai/chat-latest",
  "sakana/fugu-max": "sakana/fugu-max-v1.0",
  "sakana/fugu-ultra-v2": "sakana/fugu-ultra-v2.0",
  "upstage/solar-pro4-260806": "upstage/solar-pro4",
  "volcengine/seed-2-1-turbo": "volcengine/dola-seed-2-1-turbo",
  "volcengine/dola-seed-2-1-turbo-260628": "volcengine/dola-seed-2-1-turbo",
};
