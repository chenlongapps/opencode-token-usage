# 内置官方价与参考价

插件优先使用 OpenCode 当前解析的费率。需要回退时，离线快照 [`src/prices.generated.ts`](../src/prices.generated.ts) 对每个标准模型或独立计费 SKU **只保存一个来源**；该来源可以包含多个上下文档位。报价候选只存在于生成脚本内存中。快照中的 `lab` / `id` 是模型身份，`sourceProvider` 是报价方（与 `lab` 同名时省略），`reference: true` 表示参考价。`bindings` 和 `freeReferences` 只存精确 SKU 映射，不存报价。金额均为美元 / 100 万 token。

## 模型身份与选价

[models.dev `catalog.json`](https://models.dev/catalog.json) 在同一份响应中返回 Provider 报价和独立的 LAB 型号目录。Provider 模型的 `canonical_model_id` 来源于上游 `base_model`，格式是 `LAB/模型 ID`。生成器用 LAB 目录校验它；缺失时仅接受目录中可验证的精确限定 ID，或精确的 `LAB/本地 ID`。第三方裸 ID 无法凭同名或模型系列取得报价资格。身份冲突或未登记的条目不参与报价。已知的 Free、Fast、Pro 等计费 SKU 与标准费率分开，上游发布的不同版本也不合并。

Provider ID 与 LAB 相同即视为该 LAB 的原厂 API；名称不同的可核验关系记录在 [`src/aliases.ts`](../src/aliases.ts)，例如 `tencent-tokenhub` → `tencent`、`zai` → `zhipuai`、`amazon-bedrock` → `amazon`。关联只对模型自己的 LAB 生效：Bedrock 转售的 Claude、阿里云转售的 Kimi 均不是官方价。原厂有多个有效非零报价时，优先常用直连 API，再考虑同厂商的其他云／区域 API。普通新模型无需维护系列白名单。

1. 选有效的**原厂非零价**。缺失 Cache Read / Write 不会使有效的原厂基础报价让位给第三方。
2. 否则依次选有有效非零价的 **OpenRouter**（`openrouter`）、**Vercel AI Gateway**（`vercel`）、**Amazon Bedrock**（`amazon-bedrock`）、**LLM Gateway**（`llmgateway-providers` 为指定上游路由，`llmgateway` 为同一网关的自动路由）。低优先级供应商即使更便宜，也不能覆盖已选报价。同一优先级有多条非零报价时，优先更直接的精确型号路由，再按字段覆盖度、Provider ID 和 SKU 排序。
3. 四家都没有有效非零价时，选其他 Provider 中基础档 **Input + Output** 最低的非零价。总和相同，优先选各档位最少缺失的缓存费率，再看是否有独立 Reasoning 费率，最后按 Provider ID 和 SKU 字典序。不会跨 Provider 拼接价格；该比较只是选基准，不能判断每种请求的实际最低成本。
4. 全部有效报价均为零时，按原厂、上述供应商顺序、其余 Provider ID 字典序选一条明确的零价。无有效报价则不生成记录。之后应用有来源和原因的人工例外，整条替换选定费率。

## 估算规则与边界

- Input / Output 必须同时为有限非负数字；缓存费率允许缺失，但不补零。上游单列 Reasoning 费率时采用该值，否则沿用 Output。存在正数费率的有效档位表不是零价表。上下文按该条消息的 `input + cache read + cache write` 计入档位，阈值为**严格大于**；不从旧 `context_over_200k` 字段或不完整的模式价格猜测档位。
- 每条 assistant / compaction 消息按记录的模型和实际用到的 token 类别估算。OpenCode 的完整非零价格优先。SDK 只按模型 ID 返回费率；若消息用 `variant` 指定已知独立计费模式，不把标准 SKU 的费率当成模式价。OpenCode 费率缺失或不完整时整条回退。内置价格也缺少实际用到的费率则不能计价，不改选其他 Provider、不混用费率。
- 若上游明确关联了 Free SKU 和付费型号，且参考价能完整覆盖该调用，则把参考费用计入 `Est. Cost`，例如 `opencode/hy4-flash-free` 对应 `tencent/hy4-flash`。独立计费的 Contributor、Fast 等需找到同模式的付费身份。无法匹配或参考费率不完整时保留有效零价；没有有效零价才显示不可计价。普通 SKU 的完整零价不会仅因参考价存在而被替换，除非有已核实的端点计费例外。
- 精确的 Provider / SKU 映射优先于精确限定 ID、明确别名和已知包装格式；只在无歧义时兼容完整裸 ID。不会去掉 `-free` / `:free` 后用裸 ID 猜测对应的付费型号。
- `/token-usage` 的 By Model 标注 `Free usage reference`；详细模式按实际采用的来源和上下文档位列出五类费率及调用数。无法计价显示 `—`，仅部分调用可计价标注 `partial`，确认零价且未应用参考价时显示 `$0.00`。运行时使用当前模型目录和随包价格；不重现历史账单。
- 只导入可用五类 token 估算的文本费率；独立音频费率、非文本输出、特殊计费或已知订阅／额度报价不能充当标准 token 价。上游 v1 报价也不一定能表达区域、分时、缓存 TTL 等条件。参考价不含其他渠道的加价、折扣、工具费、税费或非文本计费。

## 例外与更新

[`PRICE_OVERRIDES`](../src/overrides.ts) 保留出处和原因，例如 DeepSeek 的可核实峰值价、Kimi K3 的五分钟缓存写入费率、OpenAI Fast 的长上下文档位，以及腾讯 Hy3 的按量价格。人工条目也不能用假定费率填补未知档位。另有少量已知字段修正：xAI 在 200K 起涨价，换算为 199,999 的严格大于阈值；Z.ai 按时间收费的缓存存储不解释为免费写入；阿里云隐式和显式写入价格不同，不能用聚合写入计数选择其一。

本地手动更新：

```sh
npm run prices:update
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

[价格更新工作流](../.github/workflows/update-prices.yml) 每 4 小时检查一次，也可在 `main` 上手动触发。检查日期、记录顺序、未胜出的费率变化和无关元数据不会触发发布；选定来源、费率或查找结果实际变化时，才验证、升级 patch、原子推送价格提交及标签并显式触发 `publish.yml`。待发布的手动版本会延期，已有自动价格标签只重试原版本。详见[发布说明](releasing.md)。更新脚本联网，插件运行、正常构建和测试离线。
