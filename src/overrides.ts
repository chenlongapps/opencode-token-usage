import type { Price } from "./usage.js";

/** models.dev has no manufacturer-of-model field. Only these first-party
 * catalogs and model families can supply fallback prices. A manufacturer
 * listing somebody else's model (e.g. Alibaba's Kimi) is not its origin. */
export const ORIGINAL_PROVIDERS: Readonly<Record<string, RegExp>> = {
  ai21: /^jamba-/i,
  alibaba: /^(?:qwen|qwq|qvq)/i,
  anthropic: /^claude-/i,
  arcee: /^trinity-/i,
  cohere: /^(?:command-|north-)/i,
  deepseek: /^deepseek-/i,
  google: /^(?:gemini-|gemma-|deep-research-)/i,
  inception: /^mercury-/i,
  longcat: /^longcat-/i,
  meta: /^muse-/i,
  minimax: /^minimax-/i,
  mistral: /^(?:open-mistral-|open-mixtral-|mistral-|ministral-|magistral-|codestral-|devstral-|labs-devstral-|pixtral-|voxtral-)/i,
  moonshotai: /^kimi-/i,
  nvidia: /^nvidia\/(?:nemotron-|llama-[\w.-]*nemotron-)/i,
  openai: /^(?:gpt-|o\d|chat-latest$)/i,
  perplexity: /^sonar(?:-|$)/i,
  sakana: /^(?:fugu|sakana-namazu)/i,
  "stepfun-ai": /^step-/i,
  // TokenHub's hy3 zero is a subscription-plan quote, not a token tariff;
  // hy3 pay-as-you-go is a reviewed exception below.
  "tencent-tokenhub": /^hy4-preview$/i,
  upstage: /^solar-/i,
  volcengine: /^doubao-seed-/i,
  xai: /^grok-/i,
  xiaomi: /^mimo-/i,
  zai: /^glm-/i,
};

export interface PriceOverride {
  providerID: string;
  id: string;
  prices: readonly Price[];
  source: string;
  reason: string;
  released?: string;
  /** Exceptional SKUs such as Fast are only available at the first party. */
  providers?: readonly string[];
}

/** Rates absent from the first-party models.dev listing or contradicted by a
 * specifically verified manufacturer tariff. Never use a reseller's quote. */
export const OVERRIDES_VERIFIED = "2026-09-23";
export const PRICE_OVERRIDES: readonly PriceOverride[] = [
  {
    providerID: "openai", id: "chat-latest", released: "2026-05-05",
    source: "https://developers.openai.com/api/docs/pricing", reason: "Official ChatGPT API SKU missing from the first-party catalog",
    prices: [{ input: 5, output: 30, cache: { read: 0.5 } }],
  },
  // The first-party API records Fast as a mode, but not its long-context
  // schedule. Keep the published Fast schedule restricted to direct API IDs.
  ...([
    ["gpt-5.5", 12.5, 75, 1.25, undefined, undefined, undefined, undefined, undefined],
    ["gpt-5.6-sol", 8, 40, 0.8, 10, 16, 60, 1.6, 20],
    ["gpt-5.6-terra", 4, 24, 0.4, 5, 8, 36, 0.8, 10],
    ["gpt-5.6-luna", 0.4, 2.4, 0.04, 0.5, 0.8, 3.6, 0.08, 1],
    ["gpt-6-astra", 20, 100, 2, 25, 40, 150, 4, 50],
    ["gpt-6-sol", 4, 20, 0.4, 5, 8, 30, 0.8, 10],
    ["gpt-6-luna", 0.2, 1, 0.02, 0.25, 0.4, 1.5, 0.04, 0.5],
  ] as const).map(([id, input, output, read, write, longInput, longOutput, longRead, longWrite]): PriceOverride => ({
    providerID: "openai", id: `${id}-fast`, providers: ["openai"],
    source: "https://developers.openai.com/api/docs/pricing",
    reason: "Published first-party Fast rate and long-context boundary (not in mode.cost)",
    prices: [
      { input, output, cache: { read, ...(write === undefined ? {} : { write }) } },
      { tier: { type: "context", size: 272_000 },
        ...(longInput === undefined ? {} : { input: longInput, output: longOutput, cache: { read: longRead, write: longWrite } }) },
    ],
  })),
  {
    providerID: "deepseek", id: "deepseek-v4.1-flash", released: "2026-09-10",
    source: "https://api-docs.deepseek.com/quick_start/pricing",
    reason: "Peak synchronous price; the hourly billing tier is not recorded in historical messages",
    prices: [{ input: 0.3, output: 1.2, cache: { read: 0.006 } }],
  },
  {
    providerID: "deepseek", id: "deepseek-v4-pro-0813", released: "2026-08-13",
    source: "https://api-docs.deepseek.com/quick_start/pricing",
    reason: "Peak synchronous price; the hourly billing tier is not recorded in historical messages",
    prices: [{ input: 1.32, output: 3.96, cache: { read: 0.044 } }],
  },
  {
    providerID: "moonshotai", id: "kimi-k3",
    source: "https://platform.moonshot.ai/docs/pricing",
    reason: "Published five-minute cache-write rate omitted by models.dev",
    prices: [{ input: 3, output: 15, cache: { read: 0.3, write: 3 } }],
  },
  {
    providerID: "stepfun-ai", id: "step-5-preview",
    source: "https://platform.stepfun.ai/docs/en/guides/pricing/details",
    reason: "Cache-miss input includes new cache writes; the API omits the write rate",
    prices: [{ input: 1, output: 2.7, cache: { read: 0.05, write: 1 } }],
  },
  {
    providerID: "tencent-tokenhub", id: "hy3", released: "2026-07-06",
    source: "https://intl.cloud.tencent.com/document/product/1300/78937",
    reason: "Published pay-as-you-go tariff, rather than the catalog's subscription-plan zero",
    prices: [{ input: 0.132, output: 0.528, cache: { read: 0.033 } }],
  },
  {
    providerID: "longcat", id: "longcat-2.0",
    source: "https://longcat.chat/platform/docs/Pricing/LongCat-2.0.html",
    reason: "Manufacturer's billed promotion, verified 2026-09-23; review on refresh",
    prices: [{ input: 0.3, output: 1.2, cache: { read: 0.006 } }],
  },
  {
    providerID: "mistral", id: "mistral-medium-2604",
    source: "https://docs.mistral.ai/inference/pricing",
    reason: "Manufacturer cache-hit price missing from models.dev",
    prices: [{ input: 1.5, output: 7.5, cache: { read: 0.15 } }],
  },
  {
    providerID: "alibaba", id: "qwen3.7-flash", released: "2026-07-15",
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    reason: "International pay-as-you-go SKU absent from the international catalog (not the CN tariff)",
    prices: [
      { input: 0.03, output: 0.13, cache: { read: 0.006 } },
      { tier: { type: "context", size: 32_000 }, input: 0.1, output: 0.4, cache: { read: 0.02 } },
      { tier: { type: "context", size: 256_000 }, input: 0.2, output: 0.8, cache: { read: 0.04 } },
    ],
  },
  {
    providerID: "alibaba", id: "qwen3.8-2.4t-a95b", released: "2026-08-12",
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    reason: "Manufacturer's international tariff; this SKU is absent from the international catalog",
    prices: [{ input: 2, output: 6 }],
  },
  {
    providerID: "alibaba", id: "qwen3.8-27b", released: "2026-08-14",
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    reason: "Manufacturer's international tariff; this SKU is absent from the international catalog",
    prices: [{ input: 0.5, output: 3, cache: { read: 0.1 } }],
  },
  {
    providerID: "alibaba", id: "qwen3.5-plus-2026-04-20", released: "2026-04-20",
    source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    reason: "Manufacturer's international tariff; this SKU is absent from the international catalog",
    prices: [
      { input: 0.4, output: 2.4 },
      { tier: { type: "context", size: 256_000 }, input: 0.5, output: 3 },
    ],
  },
  {
    providerID: "volcengine", id: "dola-seed-2-1-turbo", released: "2026-06-23",
    source: "https://docs.byteplus.com/en/docs/ModelArk/1099320",
    reason: "BytePlus manufacturer SKU uses a different ID from the regional Volcengine catalog",
    prices: [{ input: 0.5, output: 2.5, cache: { read: 0.1 } }],
  },
  {
    providerID: "sakana", id: "fugu-ultra-v2.0", released: "2026-09-11",
    source: "https://console.sakana.ai/pricing",
    reason: "Manufacturer versioned SKU not present under this ID; higher tier starts at 272K",
    prices: [
      { input: 5, output: 30, cache: { read: 0.5 } },
      { tier: { type: "context", size: 271_999 }, input: 10, output: 45, cache: { read: 1 } },
    ],
  },
  {
    providerID: "sakana", id: "fugu-max-v1.0", released: "2026-09-11",
    source: "https://console.sakana.ai/pricing",
    reason: "Manufacturer versioned SKU absent from models.dev",
    prices: [{ input: 2, output: 6, cache: { read: 0.25 } }],
  },
  ...([
    ["aion-3.0", "2026-05-05", 3, 6, 0.75],
    ["aion-3.0-mini", "2026-05-14", 0.7, 1.4, 0.18],
  ] as const).map(([id, released, input, output, read]): PriceOverride => ({
    providerID: "aion-labs", id, released,
    source: "https://www.aionlabs.ai/docs/models",
    reason: "First-party hosted API price; models.dev has no Aion manufacturer provider",
    prices: [{ input, output, cache: { read } }],
  })),
];

/** A catalog zero may mean an unmetered subscription, or that cache storage is
 * billed by time rather than per write token. Do not invent a free write rate. */
export function adjustOriginalPrice(providerID: string, price: Price): Price {
  const ambiguousWrite = (providerID === "zai" && price.cache?.write === 0)
    || (providerID === "alibaba" && price.cache?.write !== undefined);
  if (ambiguousWrite && price.cache) {
    // Z.ai stores cache by time; Alibaba mixes implicit and explicit writes
    // at distinct rates, which OpenCode's aggregate counter cannot separate.
    const { write: _unrepresentable, ...cache } = price.cache;
    return { ...price, cache };
  }
  if (providerID === "xai" && price.tier?.size === 200_000) {
    // xAI's >=200K bracket begins at 200,000; OpenCode tiers are exclusive.
    return { ...price, tier: { type: "context", size: 199_999 } };
  }
  return price;
}
