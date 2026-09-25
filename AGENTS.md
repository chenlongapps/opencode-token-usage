# 仓库指南

## 当前状态

- 本仓库是 Node.js 22+、npm、TypeScript ESM 工程，当前包版本为 0.4.0，使用 `@opencode/plugin@2.0.11`。
- `src/usage.ts` 负责统计、上下文、定价与格式化；`src/source.ts` 负责 v2 API、分页与去重；`src/controller.ts` 负责刷新生命周期；`src/tui.tsx` 负责侧边栏、子代理浮窗和 `/usage` 弹窗。
- 可执行检查：`npm run typecheck`、`npm test`、`npm run build`。`npm run test:smoke` 使用打包产物和隔离的 OpenCode 2.0.11、Python 3 终端、本地模拟提供商进行集成验证。
- `ROADMAP.md` 区分已验证功能与后续规划；只勾选实际通过验证的项目。没有 lint 配置，不要臆造 lint 命令。
- 修改 README 时，必须同步更新英文版 `README.md` 与简体中文版 `README.zh-CN.md`，确保安装、用法、功能和版本信息等内容一致。
- 2026-09-24 已通过类型检查、62 项自动化测试、构建及 SDK 2.0.11 + 真实 OpenCode 2.0.11 打包集成验证，记录见 `docs/verification.md`。

## 产品约定

- 目标是为 OpenCode 2 开发一个 Node.js 插件。不要复制 OpenCode 1 的 API；在实现插件和 TUI 集成之前，请根据 OpenCode 2 文档进行验证。
- 使用量应在整个会话树中累计，包括子代理。
- `Input` 不包括缓存读取和缓存写入；传入 token 总数为 input + cache read + cache write。
- `Output` 不包括 `Reasoning`；`Total` 为五类 token 之和。缓存命中率分母为全部传入 token。
- 成本按会话树中每条 assistant 与 compaction 消息实际记录的模型及五类 token 分别估算。优先使用当前会话位置经 OpenCode 解析的完整非零价格；若 OpenCode 给出完整零价，且插件内置的价格快照能完整覆盖该消息实际使用的 token 类别，则采用快照价格，否则保留 OpenCode 零价。OpenCode 价格不完整时，整条消息回退到内置价格，不混用两套费率。网关模型仅通过精确厂商 ID、明确别名和已知包装格式匹配；匹配后可移除模型 ID 的终尾 `-free` 或 `:free` 再精确查找基础 ID，不剥离其他后缀、不按相似名称猜测。无法定价时显示不可用；只有部分消息可定价时明确标注 `partial`；明确零价显示 `$0.00`。内置价格采用厂商标准同步 API 公开价，仅在明确标出的条目采用 Meta Contributor 条件价。Est. Cost 不含网关加价、区域价、工具费和税费，仍是估算，不代表提供商账单。
- 内置回退价从 `https://models.dev/api.json` 的原厂 Provider 自家文本模型生成，按需运行 `npm run prices:update` 并审阅提交的 `src/prices.generated.ts`；插件与构建均不联网。新原厂/模型系列须审核 `src/overrides.ts` 的来源白名单；无法自动处理的精确别名放 `src/aliases.ts`，有原厂依据的少量价格或计费例外放 `src/overrides.ts`。API 缺少厂商归属字段，不得把原厂平台转售第三方模型的价格冒充原厂价。
- 读取失败不得显示为零用量；刷新失败保留上次完整快照，切换会话时丢弃旧请求结果。
- 分叉不是 `parentID` 子代理关系。2.0.9 为继承消息生成带 `_序号` 后缀的 ID；这些副本的用量只归原始来源。升级 OpenCode 时必须重新核对这一实现约定。
- 上下文用量取当前查看会话中最后一条带 `tokens` 的 assistant 消息（只搜索最后一次 `status === "completed"` 的 compaction 之后）的五类 token 之和；分母为当前查看会话活动模型的 `limit.context`，缺失、为零或非有限值时隐藏该行。它只反映被查看会话本身，不随子树累计；分叉继承副本仍计入被查看会话的上下文。宿主实现参照 OpenCode 2.0.10 侧边栏的 `Ws`/`S6`，SDK 锁定 2.0.11；升级 OpenCode 或 SDK 时必须重新核对 compaction 的 `status` 与消息排序语义。
- 上下文行是面板第一行（状态提示之后），行内为 `已用 / 上限 (百分比%)`，百分比保留一位小数、允许超过 100%。
- `/usage` 使用 CLI 插件斜杠命令打开原生弹窗，并以宿主 `centered` 选项垂直居中；窗口宽度取宿主 `large` 档（88 列，方向随终端收窄），条形图与两列布局按该内容宽度收敛。
- `/usage` 分为 Context Window、Last Request、Context Breakdown、Session、By Model 五个区域，口径互相独立：Context Window 只回答上下文占用（分母为活动模型 `limit.context`）；Last Request 是被查看会话最近一次已上报调用的五类 token 与缓存率；Session 为全树汇总；By Model 为逐模型 tokens/calls/费用，按费用降序。标题下方一行显示会话与活动模型（多模型时显示模型数量），正文不重复模型名。
- 弹窗默认紧凑模式：数字用 `K`/`M` 缩写（`812`、`139.4K`、`3.70M`），隐藏零值行，Context Breakdown 中 `System Tools` 与 `MCP Tools` 合并为 `Tools` 并按占比降序；按 `d` 切换详细模式，显示精确数字、零值行、两类工具拆分与 Session 逐类明细。侧边栏始终使用精确数字和原有行序。
- `/usage` 的六类来源占比是最近一次已组装模型请求的文本与工具定义估算值，占比以六类估算和为分母；不得将其当作实测 Context 或与之强行加总。服务端 `context` 钩子仅保存分类数值，RPC 不可用或未捕获请求时显示不可用，不影响实测用量。
- 2.0.9–2.0.11 在子代理视图中不挂载侧边栏；`session.composer.top` 仅显示 Context、Total、Cost、TPS 单行实时摘要，不显示快捷键；点击摘要打开居中原生弹窗，弹窗复用摘要的同一控制器及侧边栏完整面板并可用 Esc 关闭，保持子代理中的全树统计可按需查看且不挤占会话高度。

## 官方文档

- [OpenCode 2 文档](https://opencode.ai/v2/docs)
- [OpenCode 2 插件开发文档](https://opencode.ai/v2/docs/build/plugins)
