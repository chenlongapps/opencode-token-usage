# 仓库指南

## 项目与资料

- 这是面向 **OpenCode 2** 的 Node.js 22+、npm、TypeScript ESM 插件。包和依赖版本以 `package.json` 为准；不要套用 OpenCode 1 API。
- 实现插件或 TUI 集成前，先核对 [OpenCode 2 文档](https://opencode.ai/v2/docs)和[插件文档](https://opencode.ai/v2/docs/build/plugins)。
- OpenTUI 原生 Node 运行时要求 Node >=26.4：Node 22 安装会有 `EBADENGINE`，启用 `engine-strict` 会被拒绝。Node 22 工具链及宿主内 TUI 验证不代表独立 Node 22 原生渲染受支持。
- 功能交互和指标细节见 [中文 README](README.zh-CN.md#详细用量)；修改相关功能前也要阅读其[指标说明](README.zh-CN.md#指标)。价格、发布和验证记录分别见 [`docs/pricing.md`](docs/pricing.md)、[`docs/releasing.md`](docs/releasing.md)、[`docs/verification.md`](docs/verification.md)。
- `ROADMAP.md` 区分已验证功能和规划，只勾选实际通过验证的项目。验证和发布状态以对应记录及实际结果为准，不把本地测试、专项冒烟或模拟场景说成完整宿主、远程 CI 或真实发布验证。
- 修改 README 时，同步更新 `README.md` 和 `README.zh-CN.md`，保持安装、用法、功能及版本信息一致。

## 开发与检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
```

- lint 使用 ESLint Flat Config（`eslint.config.mjs`）及 JS／TypeScript 推荐规则，不负责格式化；`npm run lint:fix` 可自动修复支持的问题。忽略构建产物、依赖、临时目录和生成的价格快照；不启用 React 规则。ESLint 10 在 Node 22 分支要求 >=22.13（也支持 Node >=24），不改变插件运行时 Node >=22 的要求。
- smoke 打包并隔离安装插件，使用 Python 3 终端、本地模拟提供商和 OpenCode 2 稳定版（最低 2.0.9）；未验证宿主只警告，仍执行实际检查。当前 SDK 的已验证宿主及边界见 `docs/verification.md`，旧 SDK 的验证结果不能自动继承。
- 默认使用 PATH 中的 `opencode`；设置 `OPENCODE_BIN` 可为版本探测、服务端和 TUI 指定同一独立二进制。

## 代码导航

| 路径 | 职责 |
| --- | --- |
| `src/usage.ts`、`src/pricing.ts` | 用量、上下文、定价和格式化 |
| `src/performance.ts` | 历史 TPS／TTFT、实时测速及流生命周期 |
| `src/runtime.ts`、`src/runtime-monitor.ts` | 当前会话耗时、服务端时间锚点和实时估算 |
| `src/source.ts`、`src/controller.ts` | V2 API、分页去重、刷新和视图生命周期 |
| `src/tui.tsx` | 侧边栏、子代理摘要及详情弹窗 |
| `src/aliases.ts`、`src/price-identity.ts`、`src/overrides.ts` | LAB／Provider 关联、精确价格查询和人工例外 |

## 统计约定

### 用量与上下文

- 用量和费用累计整个会话树，包括子代理；分叉不是 `parentID` 子代理关系，继承副本的用量只归原始来源。升级宿主时须重新核对分叉消息 ID 的 `_序号` 约定。
- `Input` 不含缓存读写，`Output` 不含 `Reasoning`；`Total` 是五类 token 之和，缓存命中率分母为 Input + Cache Read + Cache Write。
- `Context` 只看当前会话：取最后一次 `status === "completed"` 的 compaction 之后，最后一条带 tokens 的 assistant 消息的五类 token 之和。分叉继承副本仍计入当前会话上下文。
- Context 上限取当前活动模型的 `limit.context`；缺失、非正值或非有限时隐藏该行。百分比保留一位小数，可以超过 100%。升级 OpenCode 或 SDK 时重新核对 compaction 状态与消息排序。
- 读取失败不能显示为零；刷新失败保留上次完整快照并标注未更新，切换会话时丢弃旧请求结果。

### 费用与价格更新

- 按全树每条 assistant／compaction 消息实际模型及五类 token 估算。优先 OpenCode 的完整非零价格；有已核实付费对应关系的 Free SKU 可按完整参考价计入 `Est. Cost` 并标注，其他有效零价保留（明确端点例外除外）。价格不完整时整条消息回退，不混用费率。
- 无法定价显示不可用，部分可定价标注 `partial`，明确免费显示 `$0.00`。估算不含网关加价、区域价、工具费和税费，不代表账单。
- 用 models.dev LAB 目录验证 `canonical_model_id` 及精确身份；不按相似名称猜测。Free SKU 本身与付费 SKU 分开，参考估价只用已核实的精确关联；不同计费模式不混用标准价。精确别名与不同名的 LAB／Provider 关联放 `src/aliases.ts`。
- 仅在快照生成时选价：原厂非零价 > OpenRouter > Vercel > Bedrock > LLM Gateway > 其他最低非零价 > 有效零价，再整条应用 `src/overrides.ts` 的已核实例外。每个标准模型或计费 SKU 只留一个来源，转售报价不是被转售模型的官方价。插件和构建不联网。
- 每 4 小时的价格工作流在快照变化并验证后自动提交、升 patch，触发 `publish.yml` 通过 npm OIDC 发布；无变化不发布，结果以发布工作流和 registry 为准。本地可运行 `npm run prices:update` 并审阅差异。测试用固定夹具验证算法，不锁死 models.dev 动态费率。
- 当前版本尚未在 npm 可见，且未打标签或有效标签属于手动发布时，价格任务须延期、写入摘要并跳过本轮更新，下次调度重查，不能接管手动发布。自动价格版本只重试已验证的原始价格专用标签；异常标签和 registry 故障须失败。

### Run Time

- 只累计**当前查看会话**保留历史中每轮最终已完成回答的原生耗时，不额外叠加子代理。每轮以最终完成时间减去上一 idle 后首个 user／synthetic 输入时间；同轮新回答替换旧值，不重复累计。
- 会话 `time.created` 有效且 `time.idle` 未设置时，尚无首次 idle 的首轮使用首个输入，synthetic／steer 不重置起点；不能仅凭没有 idle 消息判定旧历史。无 idle 的旧历史取最近输入，无输入则取 assistant 创建时间。负差截为零，缺失时间不能冒充零。
- 复用完整消息历史，不依赖实验性执行日志或服务端持久化。分叉副本不继承耗时，压缩保留旧轮次；暂存回退不扣除，提交回退删除历史后扣除。
- 运行中仅在状态、当前轮和服务端时间锚点可信时显示带 `~` 的已耗时估算：原生累计减去同轮已计时长，再加当前轮已过去时长。估算不写入原生 `milliseconds`，不是最终／剩余时间预测。
- 启动／重连通过可选只读 `context.clock` RPC 校时，失败可回退到带时间戳的实时事件，并用本地单调时钟推进；不能用客户端 `Date.now()` 减远程时间。2.0.26 的 synthetic `server.connected` 实际不带 `created`。
- 共享 ticker 每 500ms 只更新内存，不定时读取历史；工具、重试和前台等待继续计时，terminal 回答、执行结束、未知状态或读取失败时冻结。切换／关闭视图清理对应状态，无视图需要时停止 ticker；空闲父会话不继承子代理活动。
- 重连校时期间，只在起点一致、此前 assistant 仍保留且其他轮次小计未变时沿用可信冻结估算；完成、回退和替换历史仍以原生值为准，不用最大值锁掩盖变化。完成后校正并移除 `~`，允许小幅回调。

### TPS、TTFT 与流回收

- 历史 TPS 为全树有效 assistant 的 `Σ(Output + Reasoning) ÷ Σ(time.streamed − (time.firstToken ?? time.created))`（秒），不计 compaction；`firstToken` 缺失或无效时回退 `created`，零生成时长不伪造速度。
- 有效实时 TPS 优先显示，以 `~` 标记，正值低于 `0.1` 显示 `~<0.1 tok/s`。使用 UTF-8 字节 / 4，100ms 合并，每个响应独立采样，不跨响应或子代理合并门槛；首批只作测速基线，不进入速度分子。快速模式优先，使用 2 秒窗口、单响应累计至少 80 字节、窗口至少 3 批、跨度至少 500ms，并按时间平滑。
- 快速模式未就绪时，低速回退在不超过 30 秒的连续稀疏区间取平均，不复用快速平滑；至少 3 批、跨度至少 3 秒，且区间累计至少 12 字节（含基线）。最近两段批次间隔至少 500ms 且彼此不超过 3 倍；孤立长间隔或主导低速窗口的大突发不能支撑持续估算。
- 快速估算静默 2 秒后过期，低速估算为最近最多 5 个有效间隔的下中位数 × 3，限制在 6–30 秒。样本跨度用服务端时间，静默用本地单调时钟；快估算过期不清空低速候选样本，已过期的低速窗口、工具执行或重试边界不跨段测速。过期或未就绪时回退历史，无历史则隐藏；过期不结束 step，也不清零单响应累计字节。视图增量和过期更新只用内存，不读取历史或调用 API，多视图读取不推进平滑。
- 实时 TPS 不等于模型内部生成速度；不做模型倍率、硬限幅或隐藏 reasoning 猜测，也不用客户端 epoch 减远程时间。
- TTFT 是全树可测 assistant step 的平均值：优先历史 `time.firstToken − time.created` 和实时 `session.step.first-token` 服务端时间，不人为扣除 100ms。旧宿主回退到首个非空文本／reasoning／工具输入 delta，或历史 reasoning／tool 创建时间；纯文本旧历史缺失时不伪造。
- 原生与回退样本按消息去重；同 ID 新 retry attempt 以新 `started` 隔离旧样本，迟到原生标记不延长完成后的保留期。原生历史值可在视图重建和运行期观察过期后恢复。
- 重连时重置实时窗口，并用 V2 `session.active()` 对账全部已跟踪流，包括离屏会话；不能把未同步的 TUI 缓存视为权威 idle。未结束流静默 60 秒后共享检查全部未结束流，确认 inactive 后再保留 60 秒回收；失败或超时保留并重试，仍运行的工具／重试／首 token 等待没有硬性寿命上限。
- 历史 tokens／`time.streamed` 可替换实时 TPS，但不能证明工具完成或启动 TTFT 回收；有效 `time.completed`、step／execution 结束及后继 step 可以结算。回收使用单调时钟、重复结束不续期；异步对账须隔离新活动、重连和销毁。活动检查不读取历史、不复用 Run Time ticker，无未结束流时停止。

## 界面约定

- Context 位于面板第一行（状态提示之后），格式为 `已用 / 上限 (百分比%)`。Run Time 显示时位于侧边栏和子代理完整面板最后一行，也位于详情 Session 区域最后一行。
- 各入口的 Run Time／Time 只显示耗时及估算／不可用／未更新标记，不显示 `Running...` 或动画。正常状态确认显示值为零且无非零估算时隐藏整项；非零毫秒、不可用和未更新仍显示。
- 侧边栏标题左键点击和 `/token-usage` 打开同一个详情弹窗，不向模型发消息；不注册 `/usage` 别名。命令 ID 为 `opencode-token-usage.show`，命令面板标题为 `Token usage`。拖选、非左键或没有匹配按下的松开不得误触，其他统计行不绑定打开行为。
- 详情弹窗使用宿主 `centered` 与 `large`（88 列，随终端收窄），布局和条形图随宽度收敛。它分为 Context Window、Last Request、Context Breakdown、Session、By Model 五区，口径互不混用。
- Last Request 是当前会话最近已上报调用，遵循回退及已完成压缩边界，不依赖上下文上限；时间依次取有效的 `streamed`、`completed`、`created`，缺失则隐藏。Session 为全树汇总，By Model 按费用降序。
- Context Breakdown 是最近一次已组装请求的六类文本与工具定义估算，分母为六项估算之和；不能当作实测 Context。只保存分类数值，未捕获或 RPC 不可用时显示不可用；其 `capturedAt` 不能充当 Last Request 时间。
- 默认紧凑模式使用 K／M 缩写、隐藏零值并合并两类 Tools；`d` 切换详细模式，显示精确数字、零值、工具拆分和 Session 明细。侧边栏始终使用精确数字及原行序。
- 子代理视图通过 `session.composer.top` 显示 Context、Total、Cost、Time、TPS 单行摘要，不显示快捷键，窄终端优先保留 Time。点击打开居中原生弹窗，复用同一控制器及侧边栏完整面板，Esc 关闭，不额外占用会话高度。
