# 仓库指南

## 当前状态

- 本仓库是 Node.js 22+、npm、TypeScript ESM 工程，包版本以 `package.json` 为准（当前为 0.4.8），使用 `@opencode/plugin@2.0.24` 与 OpenTUI `0.5.14`。OpenTUI 原生 Node 运行时声明 Node >=26.4，Node 22 的 npm 安装会警告 `EBADENGINE`，`engine-strict` 会拒绝；项目 Node 22 工具链与 OpenCode 宿主内 TUI 已验证，不代表独立 Node 22 原生 TUI 渲染受支持。
- `src/usage.ts` 负责统计、上下文、定价与格式化；`src/runtime.ts` 负责当前会话原生对话耗时累计及当前轮估算准备，`src/runtime-monitor.ts` 负责共享服务端时间锚点、单调时钟与运行结束门控；`src/source.ts` 负责 v2 API、分页与去重；`src/controller.ts` 负责刷新生命周期；`src/tui.tsx` 负责侧边栏、子代理浮窗和 `/usage` 弹窗。
- 可执行检查：`npm run typecheck`、`npm test`、`npm run build`。`npm run test:smoke` 默认使用 PATH 中的稳定版 OpenCode 2（最低 2.0.9）、Python 3 终端、本地模拟提供商与隔离配置验证打包产物；未验证版本只警告并继续实际检查。可用 `OPENCODE_BIN` 指定独立基准二进制，统一用于版本探测、服务端与 TUI。
- `ROADMAP.md` 区分已验证功能与后续规划；只勾选实际通过验证的项目。没有 lint 配置，不要臆造 lint 命令。
- 修改 README 时，必须同步更新英文版 `README.md` 与简体中文版 `README.zh-CN.md`，确保安装、用法、功能和版本信息等内容一致。
- 2026-10-02 已通过类型检查、85 项自动化测试、构建及 SDK 2.0.11 + 真实 OpenCode 2.0.11 / 2.0.22 打包集成验证，包含真实分叉、压缩与消息排序检查，记录见 `docs/verification.md`。
- 2026-10-05 自动价格 patch 链路已通过类型检查、101 项测试、构建、打包／发布 dry-run 和工作流静态检查；真实 GitHub 调度与 npm OIDC 写入尚未触发，不得将本地验证写成已实际自动发布，记录见 `docs/verification.md`。
- 2026-10-07 SDK 2.0.24 升级已通过 Node 22 干净安装、类型检查、103 项测试、构建及真实 OpenCode 2.0.11 / 2.0.22 / 2.0.24 打包集成验证；媒体分类兼容新 SDK 的 `part.media.mediaType` 与旧宿主的 `part.mediaType`，仍不计媒体负载。包版本与价格快照未变，未发布，记录见 `docs/verification.md`。
- 2026-10-07 npm 发布校验修复已通过类型检查、113 项测试、构建、打包／发布 dry-run 与 actionlint 检查。已只读确认真实定时价格任务发布了 0.4.5，旧发布工作流因约 2 分钟的可见性校验超时而报“假失败”；registry 的版本与 `latest` 均已可见。新校验默认共用 10 分钟总预算，可配置并输出进度，超时保留真实错误、不掩盖故障；新实现尚未推送或在真实发布中验证，不移动旧标签，记录见 `docs/verification.md`。
- 2026-10-09 Last Request 与模型上下文上限解耦已通过类型检查、116 项测试、构建及真实 OpenCode 2.0.25 打包集成验证，包含未知上限下的请求明细和实测／估算时间分别显示，记录见 `docs/verification.md`。
- 2026-10-09 当前会话累计原生对话耗时已通过类型检查、160 项测试、构建及真实 OpenCode 2.0.26 打包集成验证，包含同屏原生页脚、历史恢复、空闲、中断、分叉及窄终端子代理视图；旧执行日志方案已移除。本次未升版本、提交、推送或发布，记录见 `docs/verification.md`。
- 2026-10-10 当前已耗时实时估算已通过类型检查、192 项测试、构建及真实 OpenCode 2.0.26 完整打包集成验证；运行中带 `~`，首轮非零可见，500ms 仅更新内存，结束后恢复原生值。新开安静运行视图使用可选只读 `context.clock` RPC 取得时间锚点，RPC 不可用时回退到带时间戳的实时事件；实际 synthetic `server.connected` 不带 `created`。版本仍为 0.4.8，未升版本、提交、推送或发布，记录见 `docs/verification.md`。
- 2026-10-10 侧边栏标题点击详情已通过类型检查、197 项测试、构建及真实 OpenCode 2.0.26 完整打包集成验证；左键单击 `Token Usage` 复用 `/usage` 弹窗，拖选与非左键不误触，切换会话和关闭重开正确，不产生模型请求。版本仍为 0.4.8，未升版本、提交、推送或发布，记录见 `docs/verification.md`。

## 产品约定

- 目标是为 OpenCode 2 开发一个 Node.js 插件。不要复制 OpenCode 1 的 API；在实现插件和 TUI 集成之前，请根据 OpenCode 2 文档进行验证。
- 使用量应在整个会话树中累计，包括子代理。
- `Run Time` 的原生累计仅包括当前查看会话保留历史中每轮最终已完成回答，不额外叠加子代理；主会话等待子代理已在自己的轮次跨度内。口径参照 OpenCode 2.0.26 的 `turnDuration` / `inputIndex`：完成时间减去上一 idle 之后首个 user／synthetic 的创建时间，无 idle 的旧历史取最近输入，无输入则取 assistant 创建时间，负差值截为零。同轮新完成回答替换而不重复叠加。时间缺失不可冒充零，失败读取保留旧值并标注未更新。分叉副本不继承耗时，压缩保留旧轮次；暂存回退不扣除，已提交回退删除历史后扣除相应耗时。复用完整消息历史，不依赖实验性执行日志或服务端持久化。
- 原生状态运行中、当前轮及服务端时间锚点可信时，`Run Time` 用 `~` 标记截至当前的累计耗时估算，不预测最终／剩余时间。显示值为原生累计减去同轮已计时长，再加当前轮已过去时长；估算不写入原生 `milliseconds`。共享 ticker 每 500ms 只更新内存，不定时读取历史。启动／重连时通过一次可选的只读 `context.clock` RPC 取得服务端锚点，带时间戳的实时事件可作为回退，以本地单调时钟推进，不能拿客户端 `Date.now()` 直接减远程时间；2.0.26 的 synthetic `server.connected` 握手实际缺少 `created`，不能据 SDK 类型假造时间。工具／重试／前台等待继续计时，terminal 回答、执行结束、未知状态及读取失败冻结估算，刷新后用原生完成时间校正并移除 `~`，允许小幅回调。切换／关闭视图清理 ticker；空闲父会话不继承子代理的活动。
- `Run Time` 显示时在侧边栏及子代理完整面板中始终位于最后一行，排在可用的 TPS／TTFT 之后；`/usage` 保持在 Session 区域的最后一行。正常状态下确认显示值为零（且没有非零实时估算）时，各入口（含子代理摘要及 `/usage` 紧凑／详细模式）隐藏整项，不留空行或空字段；首轮实时估算非零时显示。非零毫秒值、不可用值和未更新提示仍显示。
- `Input` 不包括缓存读取和缓存写入；传入 token 总数为 input + cache read + cache write。
- `Output` 不包括 `Reasoning`；`Total` 为五类 token 之和。缓存命中率分母为全部传入 token。
- 成本按会话树中每条 assistant 与 compaction 消息实际记录的模型及五类 token 分别估算。优先使用当前会话位置经 OpenCode 解析的完整非零价格；若 OpenCode 给出完整零价，且插件内置的价格快照能完整覆盖该消息实际使用的 token 类别，则采用快照价格，否则保留 OpenCode 零价。OpenCode 价格不完整时，整条消息回退到内置价格，不混用两套费率。网关模型仅通过精确厂商 ID、明确别名和已知包装格式匹配；匹配后可移除模型 ID 的终尾 `-free` 或 `:free` 再精确查找基础 ID，不剥离其他后缀、不按相似名称猜测。无法定价时显示不可用；只有部分消息可定价时明确标注 `partial`；明确零价显示 `$0.00`。内置价格采用厂商标准同步 API 公开价，仅在明确标出的条目采用 Meta Contributor 条件价。Est. Cost 不含网关加价、区域价、工具费和税费，仍是估算，不代表提供商账单。
- 内置回退价从 `https://models.dev/api.json` 的原厂 Provider 自家文本模型生成；每日价格工作流对已审核白名单内的快照变化，验证后自动提交快照、升级 patch 并触发 `publish.yml` 通过 npm OIDC 发布。无变化不发布，未完成的自动价格版本重试原标签，registry 故障不得当作版本不存在；`scripts/release.mjs` 负责版本、提交范围、原子推送与发布状态核验。本地可按需运行 `npm run prices:update` 并审阅提交；插件与构建均不联网。新原厂/模型系列须审核 `src/overrides.ts` 的来源白名单；无法自动处理的精确别名放 `src/aliases.ts`，有原厂依据的少量价格或计费例外放 `src/overrides.ts`。API 缺少厂商归属字段，不得把原厂平台转售第三方模型的价格冒充原厂价。测试不得锁死 models.dev 的动态费率；算法用固定夹具、快照保留来源与结构验证，人工例外可保留精确费率断言。
- 读取失败不得显示为零用量；刷新失败保留上次完整快照，切换会话时丢弃旧请求结果。
- 分叉不是 `parentID` 子代理关系。2.0.9 为继承消息生成带 `_序号` 后缀的 ID；这些副本的用量只归原始来源。升级 OpenCode 时必须重新核对这一实现约定。
- 上下文用量取当前查看会话中最后一条带 `tokens` 的 assistant 消息（只搜索最后一次 `status === "completed"` 的 compaction 之后）的五类 token 之和；分母为当前查看会话活动模型的 `limit.context`，缺失、为零或非有限值时隐藏该行。它只反映被查看会话本身，不随子树累计；分叉继承副本仍计入被查看会话的上下文。宿主实现参照 OpenCode 2.0.10 侧边栏的 `Ws`/`S6`，SDK 锁定 2.0.24，已在 2.0.11 / 2.0.22 / 2.0.24 复核；升级 OpenCode 或 SDK 时必须重新核对 compaction 的 `status` 与消息排序语义。
- 上下文行是面板第一行（状态提示之后），行内为 `已用 / 上限 (百分比%)`，百分比保留一位小数、允许超过 100%。
- 侧边栏 `Token Usage` 标题左键单击与 `/usage` CLI 插件斜杠命令共用同一个详情弹窗入口，不向模型发送消息；其他统计行不绑定打开行为，标题拖选、非左键与没有匹配按下的松开事件均不得误触。弹窗以宿主 `centered` 选项垂直居中；窗口宽度取宿主 `large` 档（88 列，方向随终端收窄），条形图与两列布局按该内容宽度收敛。
- `/usage` 分为 Context Window、Last Request、Context Breakdown、Session、By Model 五个区域，口径互相独立：Context Window 只回答上下文占用（分母为活动模型 `limit.context`）；Last Request 是被查看会话最近一次已上报调用的五类 token 与缓存率，不依赖模型上限，请求选择遵循回退截断和已完成压缩边界，时间依次取所选 assistant 有效的 `time.streamed`、`time.completed`、`time.created`，缺失时隐藏；Session 为全树汇总；By Model 为逐模型 tokens/calls/费用，按费用降序。标题下方一行显示会话与活动模型（多模型时显示模型数量），正文不重复模型名。
- 弹窗默认紧凑模式：数字用 `K`/`M` 缩写（`812`、`139.4K`、`3.70M`），隐藏零值行，Context Breakdown 中 `System Tools` 与 `MCP Tools` 合并为 `Tools` 并按占比降序；按 `d` 切换详细模式，显示精确数字、零值行、两类工具拆分与 Session 逐类明细。侧边栏始终使用精确数字和原有行序。
- `/usage` 的六类来源占比是最近一次已组装模型请求的文本与工具定义估算值，占比以六类估算和为分母；不得将其当作实测 Context 或与之强行加总。服务端 `context` 钩子仅保存分类数值，RPC 不可用或未捕获请求时显示不可用，不影响实测用量。估算的 `capturedAt` 仅显示在 Context Breakdown，不能用作 Last Request 的实测请求时间。
- 2.0.9–2.0.11、2.0.22、2.0.24 与 2.0.26 在子代理视图中不挂载侧边栏；`session.composer.top` 仅显示 Context、Total、Cost、Time、TPS 单行实时摘要，不显示快捷键，窄终端优先保留 Time；点击摘要打开居中原生弹窗，弹窗复用摘要的同一控制器及侧边栏完整面板并可用 Esc 关闭，保持子代理中的全树统计可按需查看且不挤占会话高度。

## 官方文档

- [OpenCode 2 文档](https://opencode.ai/v2/docs)
- [OpenCode 2 插件开发文档](https://opencode.ai/v2/docs/build/plugins)
