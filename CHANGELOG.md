# 更新日志

按版本倒序记录主要功能、行为变更与修复。条目依据 Git 标签之间的实际差异整理；带标签版本的日期取自标签记录，不等同于 npm 上架时间。早期未打标签版本单独列于文末，日期取自对应提交。

价格条目反映对应版本的内置快照，不代表当前费率或提供商账单。当前用法与统计口径见 [README.zh-CN.md](README.zh-CN.md)，历史检查及验证边界见[验证记录](docs/verification.md)。

## [0.4.11] - 2026-10-15

### 变更

- 同步 models.dev 原厂价格快照：新增 NVIDIA `nvidia/nemotron-3.5-super-vl-120b-a12b` 条目，移除 `nvidia/nemotron-3-super-120b-a12b` 条目。

## [0.4.10] - 2026-10-14

### 修复

- 保留完整首轮耗时：尚无首次 idle 的新会话中，synthetic 投递、steer 与工具延续不再重置 `Run Time` 起点。
- 等待重连校时时保留同一开放轮次的可信耗时显示，避免历史刷新将其归零；完成、回退删除与历史替换仍以原生历史为准。
- 通过服务端活动集合对账离屏及静默流，回收丢失结束事件的流、事件去重状态与 TTFT 观察；仍运行的工具、重试及首 token 等待不会按静默时长误清理，查询失败时保留状态并重试。
- 构建前清理 `dist`，避免已删除模块和其他旧产物进入安装包。

### 变更

- 更新 models.dev 原厂价格快照。
- 补充真实 OpenCode 2.0.28 的打包集成验证。

## [0.4.9] - 2026-10-10

### 新增

- 运行中以 `~` 显示含当前轮已过去时间的会话累计耗时估算，首轮非零估算也可见；完成或中断后恢复原生已完成耗时，不预测最终或剩余时间。
- 使用服务端时间锚点与共享 500ms 单调时钟推进耗时；时钟更新只操作内存，不定时读取消息历史。
- 左键单击侧边栏 `Token Usage` 标题打开与 `/usage` 相同的详情弹窗，不发送模型消息；拖选和非左键不会误触。

### 变更

- 实时 TPS 合并 100ms 内的增量，首批仅作基线，至少观察 500ms 后才显示估算，平滑改为按经过时间推进。
- 流式增量静默 2 秒后，实时 TPS 在内存中过期并回退历史值；无历史值时隐藏，恢复输出后重新建立基线。
- 各入口隐藏确认零值的 `Run Time`／`Time`，不留下空行；非零实时估算、不可用和未更新标记仍保留。

## [0.4.8] - 2026-10-10

### 新增

- 侧边栏、子代理摘要／弹窗及 `/usage` 显示当前查看会话的累计原生对话耗时。每轮只计最终已完成回答，不额外累加子代理耗时；侧边栏和完整面板中的 `Run Time` 位于末行。
- 从保留的完整消息历史恢复耗时，处理同轮回答替换、压缩、分叉和回退；缺失时间显示不可用，读取失败保留旧值并标注未更新。

### 变更

- 提高小额费用的显示精度：正值低于 `$0.001` 显示 `<$0.001`，至 `$0.01`（含）显示三位小数，更大金额显示两位；明确零价仍显示 `$0.00`。

## [0.4.7] - 2026-10-09

### 新增

- `Last Request` 显示所选 assistant 消息的实测请求时间，与 `Context Breakdown` 的估算采样时间分开。

### 修复

- 将 `Last Request` 与模型上下文上限解耦，未知或无效上限不再隐藏已上报的 token 明细与缓存率。
- 实时 TPS 的平滑状态由增量更新，而不是由读取推进，避免侧边栏、子代理与详情弹窗同时读取时影响结果。
- MCP 元数据读取默认最多等待 100ms；超时或失败复用旧缓存，无缓存时跳过本次来源估算，迟到响应不覆盖新缓存。
- npm 发布可见性校验改为默认共用 10 分钟总预算，支持配置超时与轮询间隔、输出进度并保留真实错误，减少 registry 延迟造成的“假失败”。

## [0.4.6] - 2026-10-08

### 变更

- OpenCode SDK 从 2.0.11 升级至 2.0.24，OpenTUI 同步至 0.5.14。
- 来源估算兼容新版 `part.media.mediaType` 与旧版 `part.mediaType`，仍不将媒体负载当作文本 token。
- 更新 models.dev 原厂价格快照。
- 明确 OpenTUI 原生 Node 运行时要求 Node >=26.4；项目的 Node.js 22+ 工具链要求不变，插件 TUI 在 OpenCode 宿主内运行，启用 `engine-strict` 时须满足依赖的引擎要求。

## [0.4.5] - 2026-10-07

### 变更

- 价格更新任务从创建待审 PR 改为校验后自动升级 patch、原子推送提交与标签，并触发 npm OIDC 发布；快照无变化时不发布。
- 未完成的自动价格发布重试原标签；registry 故障不再当作版本不存在，并防止 `latest` 倒退。
- 上游无相关变化时保持生成文件不变，避免仅更新时间戳触发发布。
- 更新 models.dev 原厂价格快照。

## [0.4.4] - 2026-10-02

### 变更

- 实时 TPS 改用约 2 秒的近期滚动窗口和平滑值，不再将首 token 前的等待计入实时交付速度；完成后仍使用已上报用量计算历史 TPS。
- smoke 检查允许稳定版 OpenCode 2.0.9 及以上的 2.x 宿主实际运行；未验证版本警告后继续检查，不将版本检查通过等同于兼容性验证。
- 支持通过 `OPENCODE_BIN` 统一选择版本探测、服务端和 TUI 使用的二进制，并补充真实分叉、压缩及消息排序检查。
- 更新 models.dev 原厂价格快照。

## [0.4.3] - 2026-09-29

### 新增

- `/usage` 的 By Model 详细模式展示实际采用的五类 token 费率、OpenCode／内置快照来源、上下文档位及调用数。

### 变更

- 缓存未变化会话的完整消息历史并限制跨会话读取并发，减少大会话树中单个会话变化后的重复读取。
- 流式性能更新复用预先计算的历史基线，不再为每个增量遍历全部历史；无关会话事件不触发当前树刷新。
- 来源估算缓存 MCP 元数据，按会话异步持久化，减少模型请求等待；删除会话时清理已保存的估算。
- 更新 models.dev 原厂价格快照。

### 修复

- 按回退消息截断被查看会话的上下文，再应用已完成压缩边界。
- 修复历史快照、结束事件到达顺序及结束事件缺失时的 TTFT 保留与清理。

## [0.4.2] - 2026-09-25

### 新增

- `npm run prices:update` 从 models.dev 提取审核过的原厂文本模型价格，生成离线快照。
- 每日价格检查工作流：通过校验后创建或更新同一个待审 PR，此版本尚不自动合并或发布。
- 支持独立 Reasoning 费率，未单列时沿用 Output 费率。

### 变更

- 将生成价格、精确别名、原厂来源白名单与人工价格例外拆分维护；插件运行与构建均不联网下载价格。

## [0.4.1] - 2026-09-24

### 新增

- 子代理视图改用 Context、Total、Cost、TPS 单行实时摘要；点击打开居中的完整统计弹窗，Esc 关闭后摘要继续刷新，不中断子代理。

### 变更

- 将完整面板的 `Cost` 更名为 `Est. Cost`，强调费用为估算值而非提供商账单。

### 修复

- 修复用量面板文本意外换行的问题。

## [0.4.0] - 2026-09-23

### 新增

- `/usage` 原生居中详情弹窗，不向模型发送消息，支持滚动及 Escape 关闭。
- Context Window、Last Request、Context Breakdown、Session、By Model 五个独立区域，展示上下文、请求明细、来源估算、全树汇总和逐模型费用。
- 默认紧凑模式使用 K/M 数字、隐藏零值并合并工具分类；按 `d` 切换精确数字、零值行和完整分类，布局适配窄终端。
- 通过服务端 `context` 钩子记录最近组装请求的六类来源估算，仅保存分类数值，不保存提示词正文；RPC 不可用时仍显示实测统计。

## [0.3.4] - 2026-09-23

### 新增

- 增加 OpenAI GPT 与 Anthropic Claude Opus Fast 模式的独立价格条目，限制为对应原厂提供商，避免混用普通模型或网关费率。
- 对未公开的 Fast 长上下文价格保持不可估价，不推测缺失费率。

## [0.3.3] - 2026-09-23

### 新增

- 增加 Meta Muse Spark Contributor 条件价，明确其允许 Meta 将提示词与回答用于训练的适用条件。

### 修复

- 完善 OpenCode 零价与内置快照的选择：完整非零 OpenCode 价格优先；完整零价仅在快照覆盖实际使用的 token 类别时才被替代，否则保留零价。
- 网关模型匹配增加终尾 `-free`／`:free` 的精确基础 ID 查找，不剥离其他后缀或按相似名称猜价。

## [0.3.2] - 2026-09-23

### 新增

- 增加 GPT-6 Sol 与 GPT-6 Luna 的官方短、长上下文价格。

### 修复

- 将相关 OpenAI 模型的长上下文切换边界校正为传入 token 超过 272,000。

## [0.3.1] - 2026-09-23

### 新增

- 增加 Claude Opus 5.5 的官方价格、缓存费率及 OpenRouter 精确别名。

## [0.3.0] - 2026-09-23

### 新增

- 内置可追溯的厂商官方价格快照，支持价格档位、缓存、推理，以及网关精确 ID、明确别名和已知包装格式匹配。
- 区分明确免费、价格不可用与仅部分消息可计价的 `partial` 状态。

### 变更

- 费用改为按每条 assistant／compaction 消息记录的实际模型分别估算，不再按当前活动模型统一重算历史。
- 完整适用的 OpenCode 价格优先，缺价时整条消息回退内置快照，不拼接两套费率。

## [0.2.5] - 2026-09-22

### 新增

- 显示全会话树的 `Steps`：每条 assistant 消息计一步，不要求其已上报 tokens，用户与 compaction 消息不计，分叉继承副本不重复计数。

## [0.2.4] - 2026-09-22

### 修复

- 共享性能监视器在插件生命周期内捕获各会话的流，切换到已开始生成的会话、切走后返回或重建视图时可恢复实时 TPS／TTFT。
- 隔离不同会话树的性能样本，删除会话时清理其运行期状态。

## [0.2.3] - 2026-09-20

### 变更

- OpenCode SDK 依赖升级并固定至 2.0.11。
- 增加简体中文 README、插件预览图，并完善版本提交、标签推送与发布说明。

## [0.2.2] - 2026-09-20

### 变更

- 仅同步 `package.json` 与锁文件中的版本号，无运行时功能变更。

## 早期未打标签版本

以下版本由提交中的包版本、差异及验证记录确认；链接指向提交范围或源码，不虚构版本标签。日期为提交日期，不据此推断 npm 发布时间。

### [0.2.1] - 2026-09-20

- 增加 TPS 与 TTFT；实时 TPS 使用可观察流式增量估算并标记 `~`，完成后回到已上报 token 与时长计算的历史值。
- 支持文本、推理和工具输入增量，合并并发流、去重事件，流式性能更新不读取完整历史。
- 使用 `@chenlongapps/opencode-token-usage` 包名完成首次 npm 发布，并增加 CI 与 npm Trusted Publishing／OIDC 发布工作流。

### [0.2.0] - 2026-09-20

- 增加当前查看会话的 `Context`：最近一次已完成压缩后的上下文用量／活动模型上限及一位小数百分比，不随子树累计。
- 模型切换后同步更新上限；缺少可靠用量或有效上限时隐藏，允许百分比超过 100%。

### [0.1.0] - 2026-09-19

- 提供 OpenCode 2 主插件与 TUI 入口，在侧边栏及子代理视图展示用量。
- 分页读取完整会话树，累计五类 token、缓存命中率与 Total，并去重分叉继承消息。
- 提供按当前活动模型及价格档位计算的初版费用估算、千位分组与零值隐藏。
- 支持事件驱动刷新、会话切换隔离，以及读取失败时的不可用／未更新提示与自动恢复。

[0.4.11]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.10...v0.4.11
[0.4.10]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.9...v0.4.10
[0.4.9]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/chenlongapps/opencode-token-usage/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/chenlongapps/opencode-token-usage/compare/dd0df79...v0.2.2
[0.2.1]: https://github.com/chenlongapps/opencode-token-usage/compare/49f63fa...dd0df79
[0.2.0]: https://github.com/chenlongapps/opencode-token-usage/compare/1e3aec0...49f63fa
[0.1.0]: https://github.com/chenlongapps/opencode-token-usage/tree/1e3aec0
