# 内置官方价格快照

v0.3.0 在 OpenCode 当前模型目录没有可用于某条消息的完整价格时，使用本页所列的厂商官方标准价补全。快照核验于 **2026-09-23**，共收录 72 个模型，金额均为美元 / 100 万 token。

## 规则

- 每条 assistant 与 compaction 消息按自身记录的 `providerID`、模型 ID 和 token 用量分别计算。
- OpenCode 当前解析出的完整适用价格优先；仅当适用档位或本次实际使用的 token 类别缺价时，整条消息回退到内置价格，不混用两套费率。
- 网关模型只通过精确厂商 ID、精确别名及已知包装格式匹配，例如 `openai/gpt-5.6-luna`、`us.anthropic.claude-opus-5` 和 `claude-opus-5@default`。不按相似名称猜测。
- 目录首版只新增 2026-03-22 至 2026-09-22 发布、具有明确标准 token 价格的模型。后续版本只限制新增窗口，已经收录的模型不会因超过半年而自动删除。
- 采用标准同步 API 的公开价，不含 Batch、Flex、Fast/Priority、区域溢价、网关加价、免费额度、企业折扣、工具费和税费，因此 Cost 仍是估算，不代表账单。
- 任一有用量消息仍无法定价时，已知小计标记 `partial`；全部无法定价时显示 `—`。明确零价才显示 `$0.00`。
- 促销价按核验日官网显示的费率收录（如 `gpt-5.6-sol`、MiniMax-M3 的"长期 5 折"标价），不用划线原价。

## OpenAI

来源：[OpenAI API Pricing](https://developers.openai.com/api/docs/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read | Cache Write | 长上下文档位 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `gpt-5.5` | 2026-04-23 | 5 | 30 | 0.5 | — | ≥272K：10 / 45 / 1 / — |
| `gpt-5.5-pro` | 2026-04-23 | 30 | 180 | — | — | ≥272K：60 / 270 / — / — |
| `gpt-5.6-sol` | 2026-07-09 | 4 | 20 | 0.4 | 5 | ≥272K：8 / 30 / 0.8 / 10 |
| `gpt-5.6-terra` | 2026-07-09 | 2 | 12 | 0.2 | 2.5 | ≥272K：4 / 18 / 0.4 / 5 |
| `gpt-5.6-luna` | 2026-07-09 | 0.2 | 1.2 | 0.02 | 0.25 | ≥272K：0.4 / 1.8 / 0.04 / 0.5 |
| `gpt-6-astra` | 2026-09-04 | 10 | 50 | 1 | 12.5 | ≥272K：20 / 75 / 2 / 25 |
| `chat-latest`（别名 `gpt-chat-latest`） | 2026-05-05 | 5 | 30 | 0.5 | — | — |

`gpt-5.6-sol` 的当前标准价是限期促销价；快照采用核验日官网显示的费率。`chat-latest` 是官方 ChatGPT SKU，OpenRouter 上的 `gpt-chat-latest` 作为精确别名指向同一条目。

## Anthropic

来源：[Claude Platform Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read | Cache Write |
| --- | --- | ---: | ---: | ---: | ---: |
| `claude-opus-4-7` | 2026-04-14 | 5 | 25 | 0.5 | 6.25 |
| `claude-opus-4-8` | 2026-05-28 | 5 | 25 | 0.5 | 6.25 |
| `claude-fable-5` | 2026-06-07 | 10 | 50 | 1 | 12.5 |
| `claude-sonnet-5` | 2026-06-29 | 2 | 10 | 0.2 | 2.5 |
| `claude-opus-5` | 2026-07-24 | 5 | 25 | 0.5 | 6.25 |
| `claude-fable-5-1` | 2026-09-01 | 10 | 50 | 0.25 | 12.5 |
| `claude-opus-5-5` | 2026-09-22 | 4 | 20 | 0.2 | 5 |

Cache Write 采用官方 5 分钟写入价。OpenCode 的聚合字段不区分 5 分钟与 1 小时 TTL，无法从历史消息可靠应用 1 小时写入价。OpenRouter 的 `claude-opus-4.7`、`claude-opus-4.8`、`claude-opus-5.5` 圆点写法注册为对应条目的精确别名。

`claude-opus-5-5` 的 Cache Read 是官方 0.05 倍基础输入价的特殊乘率（多数 Claude 模型为 0.1 倍），按官方标价 $0.20 / M 收录。

## Google

来源：[Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

| 模型 | 发布日期 | Input | Output（含 thinking） | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `gemini-3.1-flash-lite` | 2026-05-07 | 0.25 | 1.5 | 0.025 |
| `gemini-3.5-flash` | 2026-05-19 | 1.5 | 9 | 0.15 |
| `gemini-3.5-flash-lite` | 2026-07-21 | 0.3 | 2.5 | 0.03 |
| `gemini-3.6-flash` | 2026-07-21 | 0.75 | 3.75 | 0.075 |
| `gemini-3.7-flash` | 2026-08-13 | 0.75 | 3.75 | 0.075 |
| `gemini-3.8-flash` | 2026-09-02 | 0.75 | 3.75 | 0.075 |

Gemini 3.6–3.8 Flash 的表中价格有效至 2026-12-31。上下文缓存还按存储时间收费；消息 token 统计无法表示该费用，因此目录不伪造 Cache Write 费率，遇到实际 cache write 且 OpenCode 也缺价时会标为不可用。

## xAI

来源：[Grok Models & Pricing](https://docs.x.ai/developers/models)

| 模型 | 发布日期 | Input | Output | Cache Read | ≥200K Input / Output / Cache Read |
| --- | --- | ---: | ---: | ---: | --- |
| `grok-build-0.1` | 2026-04-16 | 1 | 2 | 0.2 | 2 / 4 / 0.4 |
| `grok-4.3` | 2026-04-17 | 1.25 | 2.5 | 0.2 | 2.5 / 5 / 0.4 |
| `grok-4.5` | 2026-07-08 | 2 | 6 | 0.3 | 4 / 12 / 0.6 |
| `grok-4.6` | 2026-08-12 | 2 | 6 | 0.5 | 4 / 12 / 1 |
| `grok-4.7` | 2026-09-21 | 2 | 6 | 0.5 | 4 / 12 / 1 |

## Mistral 与 Cohere

来源：[Mistral Pricing](https://docs.mistral.ai/inference/pricing)、[Cohere Pricing](https://cohere.com/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `mistral-medium-3-5-26-04` | 2026-04-29 | 1.5 | 7.5 | 0.15 |
| `command-a-plus-05-2026` | 2026-05-20 | 2.5 | 10 | — |

## Z.ai（GLM）

来源：[Z.AI Pricing](https://docs.z.ai/guides/overview/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `glm-5.1` | 2026-04-06 | 1.4 | 4.4 | 0.26 |
| `glm-5.2` | 2026-06-16 | 1.4 | 4.4 | 0.26 |
| `glm-5.3` | 2026-08-16 | 1.4 | 4.4 | 0.26 |
| `glm-5.3-flash` | 2026-08-26 | 0.15 | 0.5 | 0.03 |
| `glm-5.3-flashx` | 2026-09-18 | 0.37 | 1.25 | 0.075 |

官方按时间收取缓存存储费（限期免费），没有 cache write token 价，因此这些模型遇到实际 cache write 用量且 OpenCode 也缺价时标记为不可用。

## DeepSeek

来源：[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `deepseek-v4.1-flash` | 2026-09-10 | 0.30 | 1.20 | 0.006 |
| `deepseek-v4-pro-0813` | 2026-08-13 | 1.32 | 3.96 | 0.044 |

表中采用官方**峰值时段最高价**作为保守估算上界；非峰值时段实际费率为表中一半。历史消息没有保留请求发生时对应的计费时段，无法准确选择峰谷档。已退役的 `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 当前由官方路由到 V4.1 Flash 并按 Flash 价格计费；`deepseek-v4-flash-0731` 作为明确版本别名映射到同一条目。`deepseek-v4-pro` 当前对应 V4-Pro-0813。

## Moonshot（Kimi）

来源：[Kimi Model Inference Pricing](https://platform.moonshot.ai/docs/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read | Cache Write |
| --- | --- | ---: | ---: | ---: | ---: |
| `kimi-k3` | 2026-07-15 | 3 | 15 | 0.30 | 3（5 分钟 TTL） |
| `kimi-k2.7-code` | 2026-06-12 | 0.95 | 4.00 | 0.19 | — |
| `kimi-k2.6` | 2026-04-20 | 0.95 | 4.00 | 0.16 | — |

K3 同时公布 5 分钟与 1 小时 cache write，快照沿用 Anthropic 约定取 5 分钟档；K2 系列只公布 cache 命中输入价，没有 cache write 价。

## 阿里云百炼（Qwen）

来源：[Model Studio Model inference pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)（新加坡 International 站点标准价）

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `qwen3.8-max`（含别名 `qwen3.8-max-0902`） | 2026-08-03 | 2 | 6 | — |
| `qwen3.8-2.4t-a95b` | 2026-08-12 | 2 | 6 | — |
| `qwen3.8-27b` | 2026-08-14 | 0.5 | 3 | 0.1 |
| `qwen3.8-flash` | 2026-08-26 | 0.15 | 0.47 | — |
| `qwen3.7-max` | 2026-05-20 | 2.5 | 7.5 | 0.5 |
| `qwen3.7-plus` | 2026-05-26 | 0.4 / 1.2（>256K） | 1.6 / 4.8（>256K） | 0.08 / 0.24（>256K） |
| `qwen3.7-flash` | 2026-07-15 | 0.03 / 0.10 / 0.20（>32K、>256K） | 0.13 / 0.40 / 0.80（>32K、>256K） | 0.006 / 0.02 / 0.04（>32K、>256K） |
| `qwen3.6-max-preview` | 2026-04-20 | 1.3 / 2（>128K） | 7.8 / 12（>128K） | — |
| `qwen3.6-plus` | 2026-04-02 | 0.5 / 2（>256K） | 3 / 6（>256K） | — |
| `qwen3.6-flash` | 2026-04-16 | 0.25 / 1（>256K） | 1.5 / 4（>256K） | — |
| `qwen3.6-27b` | 2026-04-22 | 0.6 | 3.6 | — |
| `qwen3.6-35b-a3b` | 2026-04-15 | 0.375 | 2.25 | — |
| `qwen3.5-plus-2026-04-20`（别名 `qwen3.5-plus-20260420`） | 2026-04-20 | 0.4 / 0.5（>256K） | 2.4 / 3（>256K） | — |

档位边界按官方措辞换算：`256K<Token≤1M` 即传入超过 256,000 token 启用高价档。Cache Read 收录官方隐式缓存命中价（所在档 Input 的 20%），仅限官方公布该费率的模型；`qwen3.8-max`、`qwen3.8-max-0902`、`qwen3.8-flash`、`qwen3.8-2.4t-a95b` 的缓存价只在控制台公布，不收录。隐式缓存创建按 Input 100% 计费、显式缓存创建按 125% 计费，聚合字段无法区分，因此一律不收 Cache Write。`qwen3.7-plus` 页面当前标注限期 8 折，快照采用未打折的刊例价。

## 小米（MiMo）

来源：[Xiaomi MiMo API Pricing](https://mimo.mi.com/docs/price/pay-as-you-go)（海外美元价）

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `mimo-v2.5` | 2026-04-22 | 0.14 | 0.28 | 0.0028 |
| `mimo-v2.5-pro` | 2026-04-22 | 0.435 | 0.87 | 0.0036 |
| `mimo-v2.6-flash` | 2026-09-21 | 0.14 | 0.28 | 0.0028 |
| `mimo-v2.6-pro` | 2026-09-21 | 0.435 | 0.87 | 0.0036 |
| `mimo-v2.6-pro-ultraspeed` | 2026-09-21 | 4.35 | 8.7 | 0.036 |

V2.6 系列官方宣布沿用 V2.5 系列 API 定价。Cache Write 官方限期免费，不设 token 价。

## MiniMax

来源：[MiniMax Pay as You Go](https://platform.minimax.io/docs/guides/pricing-paygo)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `minimax-m3` | 2026-05-31 | 0.30 / 0.60（>512K） | 1.20 / 2.40（>512K） | 0.06 / 0.12（>512K） |

M3 页面标注"长期 5 折"，快照按核验日的实收价收录；官方只公布 cache 读取价，没有 cache write 价。

## 腾讯（混元）

来源：[Tencent Cloud TokenHub Model pricing](https://intl.cloud.tencent.com/document/product/1300/78937)（新加坡国际站美元价）

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `hy3` | 2026-07-06 | 0.132 | 0.528 | 0.033 |
| `hy4-preview` | 2026-08-27 | 0.834 | 2.501 | 0.042 |

官方页面只公布 cache 命中价，没有 cache write 价。

## StepFun

来源：[StepFun Pricing Details](https://platform.stepfun.ai/docs/en/guides/pricing/details)（海外站）

| 模型 | 发布日期 | Input | Output | Cache Read | Cache Write |
| --- | --- | ---: | ---: | ---: | ---: |
| `step-5-preview` | 2026-09-21 | 1 | 2.7 | 0.05 | 1 |
| `step-3.7-flash` | 2026-05-28 | 0.20 | 1.15 | 0.04 | — |

Step 5 Preview 官方明确说明 cache-miss Input 包含首次缓存写入，因此 OpenCode 单独上报的 Cache Write 按同一 `$1 / M` 费率计算。按 7:2:1 的 Cache Read / Input / Output token 比例，综合价为 `(7 × 0.05 + 2 × 1 + 1 × 2.7) / 10 = $0.505 / M`，约 `$0.51 / M`；该数值仅用于场景比较，插件仍按每条消息的实际五类 token 计算。Step 3.7 Flash 没有公布独立 cache write 价。

## Meta（Muse Spark）

来源：[Meta Model API Pricing and rate limits](https://ai.developer.meta.com/docs/pricing-rate-limits)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `muse-spark-1.1` | 2026-07-09 | 1.25 | 4.25 | 0.15 |
| `muse-spark-1.2` | 2026-08-05 | 1.25 | 4.25 | 0.15 |
| `muse-spark-1.3` | 2026-09-02 | 1.25 | 4.25 | 0.15 |

这里只收录 Standard tier。Contributor tier 虽然也是官方 API，但以允许 Meta 使用提示词和回答训练为条件的折扣方案，不属于标准价；官方没有 cache write token 价。

## Inception

来源：[Inception Models](https://www.inceptionlabs.ai/models)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `mercury-2.5`（别名 `mercury-2.5-preview`） | 2026-09-08 | 0.04 | 0.15 | 0.004 |

官网在核验日同时显示 `$0.20 / $0.75 / $0.02` 的刊例价和 80% off 的当前 API 价；快照采用当前实收的促销价，未使用 OpenRouter 自行报价。官方没有公布 cache write token 价。

## Upstage

来源：[Solar Pro 4 model page](https://console.upstage.ai/docs/models/solar-pro-4)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `solar-pro4`（别名 `solar-pro4-260806`） | 2026-08-06 | 0.30 | 1.20 | 0.06 |

Solar Pro 4 的 90% off 活动已于 2026-09-10 结束，快照采用模型页当前标准 Console API 价；官方没有公布 cache write token 价。

## Arcee AI

来源：[Arcee Platform Pricing](https://docs.arcee.ai/get-started/pricing)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `trinity-large-thinking` | 2026-04-01 | 0.25 | 0.80 | 0.06 |

该条目是 Arcee 托管 API 的标准推理价；模型同时提供开源权重，但本目录只记录 API 费用。官方没有公布 cache write token 价。

## ByteDance Seed

来源：[BytePlus ModelArk Pricing](https://docs.byteplus.com/en/docs/ModelArk/1099320)、[Seed2.1 release](https://seed.bytedance.com/en/blog/seed2-1-officially-released-advancing-ai-productivity)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `dola-seed-2-1-turbo`（别名 `seed-2-1-turbo`、`dola-seed-2-1-turbo-260628`） | 2026-06-23 | 0.50 | 2.50 | 0.10 |

表中采用 BytePlus ModelArk 在线标准推理价。缓存存储按 token·小时另行收费，不是可由当前五类 token 统计表示的 Cache Write 单价，因此不收录。

## Sakana Fugu

来源：[Sakana Fugu Pricing](https://console.sakana.ai/pricing)、[Fugu Max and Fugu Ultra v2 release](https://sakana.ai/fugu-max-release)

| 模型 | 发布日期 | Input | Output | Cache Read | 长上下文档位 |
| --- | --- | ---: | ---: | ---: | --- |
| `fugu-ultra-v2.0`（别名 `fugu-ultra-v2`） | 2026-09-11 | 5 | 30 | 0.50 | >272K：10 / 45 / 1 |
| `fugu-max-v1.0`（别名 `fugu-max`） | 2026-09-11 | 2 | 6 | 0.25 | — |

Fugu Ultra 的编排 token 已包含在 API 返回的 input/output 用量中，按同一 token 价估算；web search/web fetch 等工具调用费不是五类 token，故不计入 Cost。官方没有公布 cache write token 价。

## Aion Labs

来源：[Aion Labs Models](https://www.aionlabs.ai/docs/models)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `aion-3.0`（别名 `aion-labs/aion-3.0`） | 2026-05-05 | 3.00 | 6.00 | 0.75 |
| `aion-3.0-mini`（别名 `aion-labs/aion-3.0-mini`） | 2026-05-14 | 0.70 | 1.40 | 0.18 |

表中是 Aion Labs 自家 API 目录公布的 per-token 价，不是 OpenRouter 网关价；官方没有公布 cache write token 价。Aion 3.0 与 3.0 Mini 是基于 GLM / DeepSeek 家族的多模型协作系统，按一次请求的输入输出 token 计费。

## 美团（LongCat）

来源：[LongCat API Docs — LongCat-2.0 Pricing](https://longcat.chat/platform/docs/Pricing/LongCat-2.0.html)、[LongCat-2.0 发布](https://www.meituan.com/news/NN260630164005904)

| 模型 | 发布日期 | Input | Output | Cache Read |
| --- | --- | ---: | ---: | ---: |
| `longcat-2.0` | 2026-06-30 | 0.30 | 1.20 | 0.006 |

官方页面同时列出刊例价（$0.75 / $2.95 / $0.015）与限时活动价；与 MiniMax-M3、Mercury 2.5 相同，快照按核验日实际计收的限时价收录。官方没有公布 cache write token 价，缓存存储也不同 token 计费。

## 暂不收录

- Realtime、音频、图片、视频、embedding、按页、按分钟和按工具调用收费的模型无法仅由当前五类 token 用量准确计算。
- `grok-4.20`、`grok-4.20-multi-agent` 发布于 2026-03-09，早于目录收录窗口起点 2026-03-22。
- Fast/Priority 等加速档（`claude-opus-*-fast`、`gpt-5.6-*-pro`、`gpt-6-astra-pro`、MiniMax priority 档）不是标准同步价。
- 免费模型（Gemma 系列、`cohere/north-mini-code` 等开源或网关零价款）不设价格条目。
- 无法从厂商官方页面确认标准 token 价格的模型不猜价，包括 OpenRouter stealth/alpha 匿名模型、`z-ai/glm-5v-turbo`、`qwen3.6-plus-preview`、腾讯 `hy3-preview` 与 `hy-mt2-*`、`kwaipilot/kat-coder-pro-v2.5` 及其 Air 版本、`inclusionai/ling-3.0-*`、`bytedance-seed/seed-2.0-code` 等。这些模型目前只能查到 OpenRouter、AtlasCloud、DeepInfra 等网关或第三方报价，不能据此推断厂商标准价。
- 浮动别名（`-latest` 指针与 OpenRouter `~` 前缀条目）随底层模型漂移，不收录固定价。
- 只有询价、托管部署价或无法从厂商官方页面确认标准 token 价格的模型不猜价。
