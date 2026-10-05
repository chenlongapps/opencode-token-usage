# 内置原厂价格快照

插件在 OpenCode 当前模型目录无法为一条消息提供完整价格时，使用仓库内已生成的价格快照。快照的版本、核对日期、逐模型费率和档位见 [`src/prices.generated.ts`](../src/prices.generated.ts)；来源是 [models.dev 的 API](https://models.dev/api.json)。少量经原厂核实的例外见 [`src/overrides.ts`](../src/overrides.ts)，例外的来源、原因及统一核验日期也保存在该文件。所有金额均为美元 / 100 万 token。

## 更新方式

GitHub Actions [价格更新工作流](../.github/workflows/update-prices.yml) 每天 UTC 22:00 从 models.dev 检查一次，也可从 Actions 页面在 `main` 上手动触发。生成快照没有差异就结束，不会因检查日期或 API 中未导入的元数据变化发布新版本。白名单内的快照有变化（包含新增、移除和重新定价）时，先运行类型检查、测试、构建和 `npm pack --dry-run`，全部通过后自动升级 patch 版本，只提交 `src/prices.generated.ts`、`package.json`、`package-lock.json`，原子推送 `main` 与版本标签，再创建 GitHub Release 并显式触发 `publish.yml` 自动发布 npm。

验证失败不升版本；并发修改 `main` 会令原子推送失败，不覆盖他人提交或留下孤立的远端标签。已推送但 npm 未完成的自动价格版本会先重试原标签，不再递增版本。npm 查询只有明确的 404 才视为版本不存在，网络错误会停止流程。工作流摘要记录快照条数与新增／移除／变化数量；最终 npm 结果见发布工作流。仓库推送权限与 npm Trusted Publishing 配置见[发布说明](releasing.md)。

本地手动更新可在联网的维护环境中运行：

```sh
npm run prices:update
npm run typecheck
npm test
npm run build
```

本地更新时，审阅生成文件与 `overrides.ts` 的差异后提交。更新脚本只请求 `https://models.dev/api.json`，从人工确认的**原厂 Provider + 自家模型系列**提取公开的文本模型价格；原厂平台上托管的其他厂商模型、OpenRouter 等网关报价、地域性/订阅制费率不作为回退价格来源。自动化不修改来源白名单、别名或人工例外。API 不标注模型的真实厂商，因此新增原厂或新系列需要维护者先审核并扩充 `ORIGINAL_PROVIDERS`，不能按相似名称自动猜测。

`src/prices.generated.ts` 是随 npm 包发布的离线快照：插件启动、刷新、构建、打包和测试均不请求 models.dev。`src/aliases.ts` 只记录无法按已知包装形式解决的厂商 slug 与精确模型 ID 差异；`src/overrides.ts` 只记录有原厂来源的缺失 SKU、已核实的例外费率及无法直接使用的 API 字段。普通价格变动通过重新生成快照维护，不往别名或例外表中增加常规型号。

## 估算规则与边界

- 每条 assistant / compaction 消息使用自身记录的模型和五类 token 用量计价。OpenCode 当前解析出的完整非零价格优先；价格不完整时，整条消息回退到快照；完整零价只有在快照能覆盖该消息实际使用的类别时才被替换。两套价格不混用。
- 上下文档位按该条消息的 `input + cache read + cache write` 选择，档位阈值为**严格大于**。输出与推理分开统计；原厂明确提供不同 `reasoning` 单价时分别计费，否则沿用输出单价。
- 缺少实际用到的 token 类别费率就不能按该来源完整计价，不把缺价填作零。无法计价显示 `—`，部分可计价显示 `partial`，明确零价显示 `$0.00`。
- `/usage` 的 By Model 详细模式仅列出有用量模型在**当前估算**中实际采用的费率，按来源与上下文档位归组，并显示每组调用数；无法定价的调用单独计数。五类费率均为美元／百万文本 token，缺少某类价格显示 `—`，Reasoning 未单列价格时沿用 Output。这里使用当前解析出的模型目录或打包快照重新估算历史消息，不代表消息生成时的实际价格或提供商账单。
- 网关仅通过精确原厂 ID、唯一的完整裸 ID、明确别名及已知包装格式匹配。终尾 `-free` / `:free` 可在精确匹配失败后再去掉；不剥离 `-fast`、`-pro` 等其他后缀。Fast 模式只匹配支持它的原厂 Provider；不会把普通费率借给网关 Fast 变体。
- 导入文本输入与文本输出的 token 费率；图片、音频、视频、存储时长、搜索和工具调用等独立计费项无法由五类 token 可靠还原。音频输出另有不同价格的型号不会导入；其余多模态请求仍可能超出此文本估算范围。

## 人工核实的例外

`overrides.ts` 保存较少量的可追溯例外，而不是另一份手动维护的完整价格目录。例如 DeepSeek 的历史消息没有计费时段，因此使用官网峰值价而不是 API 的低峰价；xAI 在 200K 起涨价，需要把目录中的阈值调整为符合 OpenCode 严格大于比较的 199,999；Z.ai 的缓存存储按时间收费，不把目录中的 `cache_write: 0` 解释为免费；阿里云隐式和显式缓存写入费率不同，不把聚合的 Cache Write 当作其中一种。

另外，OpenAI Fast 的长上下文档、Step 5 Preview 的缓存写入、Kimi K3 的五分钟缓存写入、腾讯 Hy3 的按量价格，以及 models.dev 暂无原厂条目的少数型号（如 Aion）均按文件中标注的原厂页面和理由维护。Meta Contributor 是具有单独条件价格的原厂 SKU；仅精确匹配对应 Contributor 型号，不将普通 Muse Spark 一概按该价计算。

**Est. Cost 仍只是估算，不代表提供商账单**：快照可能滞后，也不含网关加价、地域价、未记录的促销或折扣、工具费和税费。更新时应复核有时效性的人工例外。
