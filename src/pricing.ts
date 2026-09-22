import type { ModelRef, Price } from "./usage.js";

export interface OfficialPriceEntry {
  /** Canonical model ID used by the model manufacturer. */
  id: string;
  /** First public release date, used to enforce the snapshot's inclusion window. */
  released: string;
  /** Exact alternate IDs used by supported gateways or manufacturer aliases. */
  aliases?: readonly string[];
  /** Standard, synchronous API token rates in USD per million tokens. */
  prices: readonly Price[];
  /** Manufacturer pricing page used to verify the rates. */
  source: string;
}

export const OFFICIAL_PRICE_SNAPSHOT = {
  verified: "2026-09-23",
  newModelCutoff: "2026-03-22",
  entries: [
    // OpenAI standard processing. The tier sizes are exclusive thresholds, so
    // 271,999 implements the official "long context at 272K" boundary.
    {
      id: "gpt-5.5", released: "2026-04-23", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 5, output: 30, cache: { read: 0.5 } },
        { tier: { type: "context", size: 271_999 }, input: 10, output: 45, cache: { read: 1 } },
      ],
    },
    {
      id: "gpt-5.5-pro", released: "2026-04-23", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 30, output: 180 },
        { tier: { type: "context", size: 271_999 }, input: 60, output: 270 },
      ],
    },
    {
      id: "gpt-5.6-sol", released: "2026-07-09", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 4, output: 20, cache: { read: 0.4, write: 5 } },
        { tier: { type: "context", size: 271_999 }, input: 8, output: 30, cache: { read: 0.8, write: 10 } },
      ],
    },
    {
      id: "gpt-5.6-terra", released: "2026-07-09", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 2, output: 12, cache: { read: 0.2, write: 2.5 } },
        { tier: { type: "context", size: 271_999 }, input: 4, output: 18, cache: { read: 0.4, write: 5 } },
      ],
    },
    {
      id: "gpt-5.6-luna", released: "2026-07-09", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 0.2, output: 1.2, cache: { read: 0.02, write: 0.25 } },
        { tier: { type: "context", size: 271_999 }, input: 0.4, output: 1.8, cache: { read: 0.04, write: 0.5 } },
      ],
    },
    {
      id: "gpt-6-astra", released: "2026-09-04", source: "https://developers.openai.com/api/docs/pricing",
      prices: [
        { input: 10, output: 50, cache: { read: 1, write: 12.5 } },
        { tier: { type: "context", size: 271_999 }, input: 20, output: 75, cache: { read: 2, write: 25 } },
      ],
    },
    // The official ChatGPT SKU `chat-latest`. OpenRouter serves it under the
    // slug `openai/gpt-chat-latest`, which is registered as an exact alias.
    {
      id: "chat-latest", aliases: ["gpt-chat-latest"], released: "2026-05-05",
      source: "https://developers.openai.com/api/docs/pricing",
      prices: [{ input: 5, output: 30, cache: { read: 0.5 } }],
    },

    // Anthropic standard processing and 5-minute cache writes. OpenCode's
    // aggregate cache-write counter cannot distinguish 5-minute from 1-hour TTL.
    {
      id: "claude-opus-4-7", aliases: ["claude-opus-4.7"], released: "2026-04-14", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }],
    },
    {
      id: "claude-opus-4-8", aliases: ["claude-opus-4.8"], released: "2026-05-28", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }],
    },
    {
      id: "claude-fable-5", released: "2026-06-07", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 10, output: 50, cache: { read: 1, write: 12.5 } }],
    },
    {
      id: "claude-sonnet-5", released: "2026-06-29", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 2, output: 10, cache: { read: 0.2, write: 2.5 } }],
    },
    {
      id: "claude-opus-5", released: "2026-07-24", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }],
    },
    {
      id: "claude-fable-5-1", aliases: ["claude-fable-5.1"], released: "2026-09-01",
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 10, output: 50, cache: { read: 0.25, write: 12.5 } }],
    },
    {
      id: "claude-opus-5-5", aliases: ["claude-opus-5.5"], released: "2026-09-22", source: "https://platform.claude.com/docs/en/about-claude/pricing",
      prices: [{ input: 4, output: 20, cache: { read: 0.2, write: 5 } }],
    },

    // Google paid Standard API rates. Cache storage is billed separately by
    // time and is intentionally not represented as a cache-write token rate.
    {
      id: "gemini-3.1-flash-lite", released: "2026-05-07", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 0.25, output: 1.5, cache: { read: 0.025 } }],
    },
    {
      id: "gemini-3.5-flash", released: "2026-05-19", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 1.5, output: 9, cache: { read: 0.15 } }],
    },
    {
      id: "gemini-3.5-flash-lite", released: "2026-07-21", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 0.3, output: 2.5, cache: { read: 0.03 } }],
    },
    {
      id: "gemini-3.6-flash", released: "2026-07-21", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 0.75, output: 3.75, cache: { read: 0.075 } }],
    },
    {
      id: "gemini-3.7-flash", released: "2026-08-13", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 0.75, output: 3.75, cache: { read: 0.075 } }],
    },
    {
      id: "gemini-3.8-flash", released: "2026-09-02", source: "https://ai.google.dev/gemini-api/docs/pricing",
      prices: [{ input: 0.75, output: 3.75, cache: { read: 0.075 } }],
    },

    // xAI standard text API rates. 199,999 implements the official higher
    // price at 200K prompt tokens with OpenCode's exclusive-tier formula.
    {
      id: "grok-build-0.1", released: "2026-04-16", source: "https://docs.x.ai/developers/models",
      prices: [
        { input: 1, output: 2, cache: { read: 0.2 } },
        { tier: { type: "context", size: 199_999 }, input: 2, output: 4, cache: { read: 0.4 } },
      ],
    },
    {
      id: "grok-4.3", released: "2026-04-17", source: "https://docs.x.ai/developers/models",
      prices: [
        { input: 1.25, output: 2.5, cache: { read: 0.2 } },
        { tier: { type: "context", size: 199_999 }, input: 2.5, output: 5, cache: { read: 0.4 } },
      ],
    },
    {
      id: "grok-4.5", released: "2026-07-08", source: "https://docs.x.ai/developers/models",
      prices: [
        { input: 2, output: 6, cache: { read: 0.3 } },
        { tier: { type: "context", size: 199_999 }, input: 4, output: 12, cache: { read: 0.6 } },
      ],
    },
    {
      id: "grok-4.6", released: "2026-08-12", source: "https://docs.x.ai/developers/models",
      prices: [
        { input: 2, output: 6, cache: { read: 0.5 } },
        { tier: { type: "context", size: 199_999 }, input: 4, output: 12, cache: { read: 1 } },
      ],
    },
    {
      id: "grok-4.7", released: "2026-09-21",
      source: "https://docs.x.ai/developers/models",
      prices: [
        { input: 2, output: 6, cache: { read: 0.5 } },
        { tier: { type: "context", size: 199_999 }, input: 4, output: 12, cache: { read: 1 } },
      ],
    },

    {
      id: "mistral-medium-3-5-26-04",
      aliases: ["mistral-medium-2604", "mistral-medium-3-5"],
      released: "2026-04-29",
      source: "https://docs.mistral.ai/inference/pricing",
      prices: [{ input: 1.5, output: 7.5, cache: { read: 0.15 } }],
    },
    {
      id: "command-a-plus-05-2026",
      released: "2026-05-20",
      source: "https://cohere.com/pricing",
      prices: [{ input: 2.5, output: 10 }],
    },

    // Meta Model API standard-tier rates. The contributor tier is a separate
    // discounted program that permits training on prompts and completions, so
    // it is intentionally not part of the standard snapshot.
    {
      id: "muse-spark-1.1", released: "2026-07-09", source: "https://ai.developer.meta.com/docs/pricing-rate-limits",
      prices: [{ input: 1.25, output: 4.25, cache: { read: 0.15 } }],
    },
    {
      id: "muse-spark-1.2", released: "2026-08-05", source: "https://ai.developer.meta.com/docs/pricing-rate-limits",
      prices: [{ input: 1.25, output: 4.25, cache: { read: 0.15 } }],
    },
    {
      id: "muse-spark-1.3", released: "2026-09-02", source: "https://ai.developer.meta.com/docs/pricing-rate-limits",
      prices: [{ input: 1.25, output: 4.25, cache: { read: 0.15 } }],
    },

    // Inception's current Mercury 2.5 API page shows an 80% launch discount;
    // the snapshot records the billed standard-platform rates on verification
    // day rather than the crossed-out list prices. No cache-write token rate is
    // published.
    {
      id: "mercury-2.5", aliases: ["mercury-2.5-preview"], released: "2026-09-08",
      source: "https://www.inceptionlabs.ai/models",
      prices: [{ input: 0.04, output: 0.15, cache: { read: 0.004 } }],
    },

    // Upstage Solar Pro 4 standard Console API rates. The dated version ID is
    // an exact manufacturer alias; no cache-write token rate is published.
    {
      id: "solar-pro4", aliases: ["solar-pro4-260806"], released: "2026-08-06",
      source: "https://console.upstage.ai/docs/models/solar-pro-4",
      prices: [{ input: 0.3, output: 1.2, cache: { read: 0.06 } }],
    },

    // Arcee AI's hosted API rates for the official Trinity reasoning release.
    // The model is also available as open weights, but only the hosted API
    // price is relevant to this token-cost snapshot.
    {
      id: "trinity-large-thinking", released: "2026-04-01", source: "https://docs.arcee.ai/get-started/pricing",
      prices: [{ input: 0.25, output: 0.8, cache: { read: 0.06 } }],
    },

    // Aion Labs' own model catalog publishes these per-token API rates. The
    // OpenRouter slugs retain the manufacturer's `aion-labs/` prefix, so it is
    // registered as an exact alias rather than inferred from the name.
    {
      id: "aion-3.0", aliases: ["aion-labs/aion-3.0"], released: "2026-05-05",
      source: "https://www.aionlabs.ai/docs/models",
      prices: [{ input: 3, output: 6, cache: { read: 0.75 } }],
    },
    {
      id: "aion-3.0-mini", aliases: ["aion-labs/aion-3.0-mini"], released: "2026-05-14",
      source: "https://www.aionlabs.ai/docs/models",
      prices: [{ input: 0.7, output: 1.4, cache: { read: 0.18 } }],
    },

    // Z.ai (Zhipu GLM) standard API rates. The page publishes a cache-hit input
    // rate and prices cache storage by time instead of a cache-write token rate,
    // so no cache-write rate is stored for these models.
    {
      id: "glm-5.1", released: "2026-04-06", source: "https://docs.z.ai/guides/overview/pricing",
      prices: [{ input: 1.4, output: 4.4, cache: { read: 0.26 } }],
    },
    {
      id: "glm-5.2", released: "2026-06-16", source: "https://docs.z.ai/guides/overview/pricing",
      prices: [{ input: 1.4, output: 4.4, cache: { read: 0.26 } }],
    },
    {
      id: "glm-5.3", released: "2026-08-16", source: "https://docs.z.ai/guides/overview/pricing",
      prices: [{ input: 1.4, output: 4.4, cache: { read: 0.26 } }],
    },
    {
      id: "glm-5.3-flash", released: "2026-08-26", source: "https://docs.z.ai/guides/overview/pricing",
      prices: [{ input: 0.15, output: 0.5, cache: { read: 0.03 } }],
    },
    {
      id: "glm-5.3-flashx", released: "2026-09-18", source: "https://docs.z.ai/guides/overview/pricing",
      prices: [{ input: 0.37, output: 1.25, cache: { read: 0.075 } }],
    },

    // DeepSeek standard API peak rates. The vendor charges half these rates
    // off-peak; using the peak tier provides a conservative upper-bound
    // estimate because historical messages do not retain the billing hour.
    // Retired V4 Flash and Vision Exp names currently route to V4.1 Flash at
    // the Flash price. The dated 0731 and 0813 IDs are exact gateway aliases.
    {
      id: "deepseek-v4.1-flash",
      aliases: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-0731", "deepseek-v4-flash-vision-exp"],
      released: "2026-09-10",
      source: "https://api-docs.deepseek.com/quick_start/pricing",
      prices: [{ input: 0.3, output: 1.2, cache: { read: 0.006 } }],
    },
    {
      id: "deepseek-v4-pro-0813", aliases: ["deepseek-v4-pro"], released: "2026-08-13",
      source: "https://api-docs.deepseek.com/quick_start/pricing",
      prices: [{ input: 1.32, output: 3.96, cache: { read: 0.044 } }],
    },

    // Moonshot Kimi standard API rates. K3 publishes 5-minute and 1-hour cache
    // writes; following the Anthropic convention, the aggregate counter cannot
    // tell them apart, so the snapshot stores the 5-minute write. The K2 table
    // publishes only a cache-hit input rate and no cache-write price.
    {
      id: "kimi-k3", released: "2026-07-15", source: "https://platform.moonshot.ai/docs/pricing",
      prices: [{ input: 3, output: 15, cache: { read: 0.3, write: 3 } }],
    },
    {
      id: "kimi-k2.7-code", released: "2026-06-12", source: "https://platform.moonshot.ai/docs/pricing",
      prices: [{ input: 0.95, output: 4, cache: { read: 0.19 } }],
    },
    {
      id: "kimi-k2.6", released: "2026-04-20", source: "https://platform.moonshot.ai/docs/pricing",
      prices: [{ input: 0.95, output: 4, cache: { read: 0.16 } }],
    },

    // Alibaba Cloud Model Studio standard (Singapore "International") list
    // prices. Tier sizes implement the official inclusive boundaries
    // ("0<Token≤256K" then "256K<Token≤1M") with the exclusive-threshold formula.
    // Cache Read stores the official implicit-cache hit rate, 20% of the tier
    // input, where the page publishes it. The qwen3.8 max/flash family reports
    // cache rates only in the console, so no cache rate is stored for them, and
    // no cache-write rate is stored anywhere because implicit cache writes bill
    // at 100% of the input price while explicit cache writes bill at 125% and
    // the aggregate counter cannot distinguish the two.
    {
      id: "qwen3.8-max", aliases: ["qwen3.8-max-0902"], released: "2026-08-03",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 2, output: 6 }],
    },
    {
      id: "qwen3.8-2.4t-a95b", released: "2026-08-12",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 2, output: 6 }],
    },
    {
      id: "qwen3.8-27b", released: "2026-08-14",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 0.5, output: 3, cache: { read: 0.1 } }],
    },
    {
      id: "qwen3.8-flash", released: "2026-08-26",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 0.15, output: 0.47 }],
    },
    {
      id: "qwen3.7-max", released: "2026-05-20",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 2.5, output: 7.5, cache: { read: 0.5 } }],
    },
    {
      id: "qwen3.7-plus", released: "2026-05-26",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 0.4, output: 1.6, cache: { read: 0.08 } },
        { tier: { type: "context", size: 256_000 }, input: 1.2, output: 4.8, cache: { read: 0.24 } },
      ],
    },
    {
      id: "qwen3.7-flash", released: "2026-07-15",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 0.03, output: 0.13, cache: { read: 0.006 } },
        { tier: { type: "context", size: 32_000 }, input: 0.1, output: 0.4, cache: { read: 0.02 } },
        { tier: { type: "context", size: 256_000 }, input: 0.2, output: 0.8, cache: { read: 0.04 } },
      ],
    },
    {
      id: "qwen3.6-max-preview", released: "2026-04-20",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 1.3, output: 7.8 },
        { tier: { type: "context", size: 128_000 }, input: 2, output: 12 },
      ],
    },
    {
      id: "qwen3.6-plus", released: "2026-04-02",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 0.5, output: 3 },
        { tier: { type: "context", size: 256_000 }, input: 2, output: 6 },
      ],
    },
    {
      id: "qwen3.6-flash", released: "2026-04-16",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 0.25, output: 1.5 },
        { tier: { type: "context", size: 256_000 }, input: 1, output: 4 },
      ],
    },
    {
      id: "qwen3.6-27b", released: "2026-04-22",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 0.6, output: 3.6 }],
    },
    {
      id: "qwen3.6-35b-a3b", released: "2026-04-15",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [{ input: 0.375, output: 2.25 }],
    },
    {
      id: "qwen3.5-plus-2026-04-20", aliases: ["qwen3.5-plus-20260420"], released: "2026-04-20",
      source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      prices: [
        { input: 0.4, output: 2.4 },
        { tier: { type: "context", size: 256_000 }, input: 0.5, output: 3 },
      ],
    },

    // Xiaomi MiMo overseas USD rates. The MiMo-V2.6 series keeps the V2.5 API
    // pricing. Cache writes are free for a limited time, so no cache-write rate
    // is stored.
    {
      id: "mimo-v2.5", released: "2026-04-22", source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      prices: [{ input: 0.14, output: 0.28, cache: { read: 0.0028 } }],
    },
    {
      id: "mimo-v2.5-pro", released: "2026-04-22", source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      prices: [{ input: 0.435, output: 0.87, cache: { read: 0.0036 } }],
    },
    {
      id: "mimo-v2.6-flash", released: "2026-09-21", source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      prices: [{ input: 0.14, output: 0.28, cache: { read: 0.0028 } }],
    },
    {
      id: "mimo-v2.6-pro", released: "2026-09-21", source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      prices: [{ input: 0.435, output: 0.87, cache: { read: 0.0036 } }],
    },
    {
      id: "mimo-v2.6-pro-ultraspeed", released: "2026-09-21", source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      prices: [{ input: 4.35, output: 8.7, cache: { read: 0.036 } }],
    },

    // MiniMax pay-as-you-go billed rates. The page labels the M3 rates as a
    // permanent 50% off and shows the struck-through list price beside them;
    // like the GPT-5.6 Sol promotion, the snapshot stores the billed rates shown
    // on the verification date. Only a prompt-caching read rate is published.
    {
      id: "minimax-m3", released: "2026-05-31", source: "https://platform.minimax.io/docs/guides/pricing-paygo",
      prices: [
        { input: 0.3, output: 1.2, cache: { read: 0.06 } },
        { tier: { type: "context", size: 512_000 }, input: 0.6, output: 2.4, cache: { read: 0.12 } },
      ],
    },

    // Tencent Cloud TokenHub international (Singapore) USD list prices for the
    // vendor's own Hunyuan models. Cache is the published cache-hit rate; the
    // page publishes no cache-write rate.
    {
      id: "hy3", released: "2026-07-06", source: "https://intl.cloud.tencent.com/document/product/1300/78937",
      prices: [{ input: 0.132, output: 0.528, cache: { read: 0.033 } }],
    },
    {
      id: "hy4-preview", released: "2026-08-27", source: "https://intl.cloud.tencent.com/document/product/1300/78937",
      prices: [{ input: 0.834, output: 2.501, cache: { read: 0.042 } }],
    },

    // StepFun overseas platform rates. The page publishes a cache-hit input
    // rate. For Step 5 Preview it explicitly states that cache-miss input
    // includes writing new content to the cache, so split cache-write tokens
    // retain the same rate as ordinary cache-miss input.
    {
      id: "step-5-preview", released: "2026-09-21", source: "https://platform.stepfun.ai/docs/en/guides/pricing/details",
      prices: [{ input: 1, output: 2.7, cache: { read: 0.05, write: 1 } }],
    },
    {
      id: "step-3.7-flash", released: "2026-05-28", source: "https://platform.stepfun.ai/docs/en/guides/pricing/details",
      prices: [{ input: 0.2, output: 1.15, cache: { read: 0.04 } }],
    },

    // ByteDance Seed 2.1 Turbo standard online inference rates on BytePlus
    // ModelArk. The cache-storage fee is time-based rather than a token write
    // rate, so only the published cache-hit input price is represented.
    {
      id: "dola-seed-2-1-turbo",
      aliases: ["seed-2-1-turbo", "dola-seed-2-1-turbo-260628"],
      released: "2026-06-23",
      source: "https://docs.byteplus.com/en/docs/ModelArk/1099320",
      prices: [{ input: 0.5, output: 2.5, cache: { read: 0.1 } }],
    },

    // Sakana Fugu's fixed standard API rates. Fugu Ultra's orchestration
    // tokens are included in the API's input/output usage fields and therefore
    // use the same token rates. Web search/fetch tool fees are not token fees
    // and cannot be represented by the plugin's five usage counters.
    {
      id: "fugu-ultra-v2.0", aliases: ["fugu-ultra-v2"], released: "2026-09-11",
      source: "https://console.sakana.ai/pricing",
      prices: [
        { input: 5, output: 30, cache: { read: 0.5 } },
        { tier: { type: "context", size: 271_999 }, input: 10, output: 45, cache: { read: 1 } },
      ],
    },
    {
      id: "fugu-max-v1.0", aliases: ["fugu-max"], released: "2026-09-11",
      source: "https://console.sakana.ai/pricing",
      prices: [{ input: 2, output: 6, cache: { read: 0.25 } }],
    },

    // LongCat's official API page shows both list and limited-time discounted
    // rates. As with the other documented promotions in this snapshot, record
    // the billed discounted rate visible on verification day. Cache storage or
    // cache writes have no separate token rate on the page.
    {
      id: "longcat-2.0", released: "2026-06-30",
      source: "https://longcat.chat/platform/docs/Pricing/LongCat-2.0.html",
      prices: [{ input: 0.3, output: 1.2, cache: { read: 0.006 } }],
    },
  ] satisfies readonly OfficialPriceEntry[],
} as const;

const index = new Map<string, OfficialPriceEntry>();
for (const entry of OFFICIAL_PRICE_SNAPSHOT.entries) {
  for (const id of [entry.id, ...(entry.aliases ?? [])]) {
    const key = id.toLowerCase();
    if (index.has(key)) throw new Error(`Duplicate official price ID: ${id}`);
    index.set(key, entry);
  }
}

/**
 * Resolves exact manufacturer IDs through common gateway wrappers. It never
 * performs substring or model-name matching, so similarly named variants do
 * not silently inherit a different model's price.
 */
export function officialPrice(model: ModelRef): OfficialPriceEntry | undefined {
  const id = model.id.toLowerCase().replace(/@default$/, "");
  const candidates = [id];
  const slash = id.lastIndexOf("/");
  if (slash >= 0) candidates.push(id.slice(slash + 1));
  const dot = id.lastIndexOf(".");
  if (dot >= 0) candidates.push(id.slice(dot + 1));
  for (const candidate of candidates) {
    const entry = index.get(candidate);
    if (entry) return entry;
  }
  return undefined;
}
