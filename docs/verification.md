# 验证记录

## 2026-10-09 · 统计钩子的 MCP 等待上限

环境：macOS、Node.js v22.23.2、npm 10.9.8，插件包仍为 0.4.6、SDK 2.0.24，真实宿主为 PATH 中的 OpenCode 2.0.25。未升级版本、提交、推送或发布。

MCP 元数据缓存缺失或失效时，共享读取默认最多等待 100 ms，构造参数可注入测试预算。独立定时器结束等待，同时通过 SDK 的 `AbortSignal` 请求中止读取；忽略取消的迟到成功／失败不会更新缓存或清除后续读取。超时或错误时复用旧元数据，不延长缓存 TTL，后续请求可重试；无缓存则跳过本次估算，保留已有估算与时间戳，不写入伪造零值。成功读取的空列表仍是有效缓存。持久化继续按会话顺序异步执行。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `node --import tsx --test test/context-capture.test.ts` | 专项 14 项通过，新增 11 项回归测试 |
| `npm test` | 129 项通过 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 完整通过，打包／隔离安装 + 真实 OpenCode 2.0.25 + 本地模拟提供商 |

新增测试覆盖永久挂起、100 ms 默认预算与可注入预算、并发共享读取、TTL／事件失效后的旧缓存回退、空缓存、超时后重试、迟到成功／失败与新读取的竞争、同步／异步错误、定时器清理，以及会话删除、flush 和服务端钩子的有界 MCP 等待。挂起与迟到竞态使用可控 Promise 和模拟时钟验证；真实 smoke 验证正常宿主链路，未在真实宿主中注入 MCP 挂起。Node 22 的 MockTimers 实验性警告和 OpenTUI 安装引擎警告未隐藏。

验证产物：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-Syw70N`。

## 2026-10-09 · Last Request 与上下文上限解耦

环境：macOS、Node.js v22.23.2、npm 10.9.8，插件包 0.4.6、SDK 2.0.24，真实宿主为 PATH 中的 OpenCode 2.0.25。

`requestDetails` 独立提取所选 assistant 的五类 token、总量和消息时间，`contextUsage` 单独校验模型上限。Last Request 的分类占比以请求总量为分母；上限缺失、为零、负值或非有限值时，实测请求仍可显示。时间依次取同一条消息有效的 `streamed`、`completed`、`created`，缺失时隐藏；来源估算的 `capturedAt` 仅显示在 Context Breakdown。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 116 项通过，新增 3 项请求明细、时间与边界回归测试，并扩展控制器生命周期断言 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 完整通过，打包／隔离安装 + 真实 OpenCode 2.0.25 + 本地模拟提供商 |

自动化测试覆盖有效／无效上限切换、请求分类与缓存率、时间优先级及无效日期、压缩与回退边界、子会话本地请求、刷新失败保留快照、跨会话清理，以及来源 RPC 缓慢／失败／返回另一轮请求的估算时间。

真实终端验证新增上限为 0 的活动模型：Context Window 显示不可用，Last Request 在紧凑／详细模式下仍显示 `Cache Read 1.0K`／`1,000 (78.7%)` 与 `Cache Rate 83.3%`，切回有效上限后恢复 Context。另核对两个标题各自显示实测 assistant 的流式结束时间和来源估算采样时间，并验证空请求不显示时间。完整 smoke 同时通过 100／48 列布局、子代理全树汇总、TPS／TTFT、定价、真实分叉及已完成压缩与消息排序检查。启动时按既有版本策略提示 2.0.25 未验证，随后实际完成全部检查。

验证产物：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-12xAKR`，其中 `08-unknown-context-limit.txt` 保存未知上限下的详细弹窗。

## 2026-10-07 · npm 发布可见性校验“假失败”修复

环境：macOS、Node.js v22.23.2、npm 10.9.8，本地包版本为 0.4.5、SDK 为 2.0.24。本轮仅修改发布校验、工作流、测试与文档，未修改价格快照或插件运行时代码，未升级版本、移动标签、提交、推送、重跑 GitHub 工作流或实际发布 npm。

只读诊断确认已有真实自动发布链路：

- [价格更新运行 37555311596](https://github.com/chenlongapps/opencode-token-usage/actions/runs/37555311596) 由 `schedule` 触发，验证、patch 提交／原子推送、GitHub Release 和 dispatch 均成功。
- [发布运行 37555363814](https://github.com/chenlongapps/opencode-token-usage/actions/runs/37555363814) 固定在 `v0.4.5`（`66e0584e1f125f2e5012b081014e42d7d8d57d19`）。`npm publish` 成功，生成 provenance，并在 UTC 01:06:28 提示包仍在处理、可能需几分钟才能可用；失败的是 UTC 01:08:21 的 registry 可见性校验。旧实现只查询 12 次、间隔 10 秒，约 2 分钟即超时。
- 当前 registry 查询已返回目标版本与 `latest` 均为 `0.4.5`，`gitHead` 匹配上述提交，`dist.shasum` 为 `75f8490aa51a974a5d76942a4e1ffa2d9d13fd3c`，与真实发布日志一致。因此不能把该工作流的失败结论当作 npm 未收到版本，更不能为此另升 patch。

修复将按次数重试改为默认 10 分钟总时限，使用单调时钟计算剩余预算；每次版本／`latest` 请求最多 30 秒，且不得超过剩余预算，等待同样按剩余时间截短。`NPM_VERIFY_TIMEOUT_MS` 与 `NPM_VERIFY_INTERVAL_MS` 可配置并校验合法性。日志显示轮询进度、当前 `latest` 与具体查询错误；最终超时仍返回非零退出码，在 Actions 摘要中保留最后原因及原标签重试提示，不用 `continue-on-error` 掩盖故障。发布校验步骤上限为 11 分钟，整个任务仍为 20 分钟；已发布版本跳过发布与 `latest` 核验，原有禁止倒退 `latest`、registry 故障不等于版本不存在等保护保持不变。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `node --test test/release.test.mjs` | 发布专项 23 项通过 |
| `npm test` | 113 项通过，比上轮净增 10 项发布校验回归测试 |
| `npm run build` | 通过 |
| `npm pack --dry-run` | 通过，执行 `prepack` 构建，包含 37 个发布文件 |
| `npm publish --dry-run` | 通过，执行类型检查、113 项测试与构建；未写入 registry |
| GitHub 工作流 | 三个工作流均通过官方 actionlint 1.7.12 检查，下载产物已校验 SHA-256 |
| npm 只读查询 | `publish-state` 返回 `published=true`；新版 `verify-published` 确认 `0.4.5` 与 `latest` |

回归测试用注入时钟模拟版本在 3 分钟后可见、`latest` 在 4 分钟后更新；同时覆盖 404、HTTP 401／403／429／500／503、网络及无效响应、最后原因保留、单次请求 30 秒上限、请求与等待共用预算、到期后不再发起 `latest` 查询或判定成功，以及真实 AbortSignal 中止挂起请求。CLI 测试预载本地 registry 模拟，不访问真实 npm，验证环境配置、超时非零退出码和失败／成功摘要。

以上真实 GitHub 运行属于修复前的已有标签；新校验逻辑尚未在新的真实发布工作流中验证。本次没有重跑 TUI smoke，之前的宿主验证记录保留。修复提交进入 `main` 后仅供后续新标签使用；旧标签不移动，重跑已可见的 `v0.4.5` 会由原实现跳过发布并核验现有版本。

## 2026-10-07 · SDK 2.0.24 升级

环境：macOS、Node.js v22.23.2、npm 10.9.8，插件包仍为 0.4.4。`@opencode/plugin`、`@opencode/client`、`@opencode/schema` 和 `@opencode/theme` 从 2.0.11 同步精确升级到 2.0.24；锁文件中的全部七个 OpenCode 包均为 2.0.24。OpenTUI 从 0.5.10 同步到 SDK 与 theme 配套的 0.5.14，没有追随独立发布的 0.5.15。未修改价格快照、未升插件包版本、未提交或推送、未实际发布 npm。

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | Node 22 下通过，保留 OpenTUI 引擎警告 |
| `npm run typecheck` | 通过 |
| `npm test` | 103 项通过，新增两项媒体封装与旧宿主兼容回归测试 |
| `npm run build` | 通过 |
| `npm pack --dry-run` | 通过，完整执行 `prepack` 构建，包含 37 个发布文件 |
| `npm run test:smoke`，默认宿主 2.0.24 | 完整通过，打包、隔离安装、真实服务端与 TUI |
| `OPENCODE_BIN=… npm run test:smoke`，独立宿主 2.0.22 | 完整通过 |
| `OPENCODE_BIN=… npm run test:smoke`，独立宿主 2.0.11 | 完整通过 |

新版 `@opencode/ai` 将请求媒体从平铺的 `mediaType` / `data` 改为 `media` asset。上下文来源估算现在优先读取 `part.media.mediaType`，同时兼容旧宿主的 `part.mediaType`；有文件名时仍优先按文件名估算，缺少标签时不伪造媒体 token。新增测试覆盖 bytes、base64 和 URL 负载不会计入文本 token，以及旧格式与缺失标签。插件入口、请求钩子、RPC、客户端分页及 TUI 插槽无需迁移，实测五类 token、上下文和计费口径不变。

OpenTUI 0.5.14 的原生 Node 运行时声明 Node `>=26.4.0` / Bun `>=1.3.0`。本轮 Node 22 干净安装和打包安装均报告 `EBADENGINE`，未强制绕过或隐藏警告；类型检查、测试与构建不运行原生 Node TUI，真实终端验证使用 OpenCode 自带运行时。因此保留项目 Node 22+ 要求，但不宣称独立 Node 22 原生 TUI 渲染受支持；启用 npm `engine-strict` 时仍须满足该依赖的 Node 引擎要求。

三版宿主均保留并通过原有完整断言：空会话、切换到生成中的会话、实时 TPS / TTFT、完成后精确吞吐、`/usage` 的紧凑／详细模式与 100 / 48 列布局、子代理全树累计和浮窗、按消息模型计费、模型切换与原厂价格回退、删除会话清理 RPC，以及真实分叉和 compaction。分叉继承 ID 仍带 `_序号` 后缀，用量只归原来源但占用分叉本地 Context；真实 compaction 仍为 `status === "completed"`，完整升序历史保留压缩前消息，压缩边界后的新 assistant 恢复 Context。全树 Total 5,080、费用 `$0.00504`、上下文上限 128,000 → 32,000 和回退费用 `$0.000149` 均未变化。

旧版宿主使用校验 npm SHA-512 完整性的官方 `@opencode/cli-darwin-arm64` 独立二进制，未修改日常 OpenCode 安装、用户配置或调用付费模型。当前 SDK 的已验证宿主列表更新为 2.0.11、2.0.22、2.0.24；2.0.9 / 2.0.10 未在本轮复测，保留下方历史记录，不据 smoke 可运行范围扩展兼容声明。

验证产物：
- OpenCode 2.0.24：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-gka7v0`。
- OpenCode 2.0.22：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-RpSxaf`。
- OpenCode 2.0.11：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-NQbaNC`。

## 2026-10-05 · 自动价格 patch 与 npm 发布链路（本地验证）

环境：macOS、Node.js v22.23.2、插件包仍为 0.4.4，SDK 仍锁定 2.0.11。本轮只修改价格更新与发布自动化、测试和文档，未更新真实价格快照、未推送提交或标签、未创建 GitHub Release，也未实际发布 npm。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 101 项通过，新增 16 项价格刷新／发布回归验证 |
| `npm run build` | 通过 |
| `npm pack --dry-run` | 通过，执行真实 `prepack` 构建 |
| `npm publish --dry-run` | 通过，完整执行类型检查、101 项测试与构建；未写入 registry |
| GitHub 工作流 | 通过 actionlint 1.7.12、YAML 解析和 bash 语法检查；检查工具来自官方发行且校验 SHA-256 |
| npm 只读查询 | 当前 `0.4.4` 已存在；发布状态为 `published=true`，价格恢复状态为 `retry=false` |

发布测试在临时仓库和本地 bare remote 中实际运行 `npm version patch`、受限提交、带注释标签及 `git push --atomic`，验证 `0.4.4 → 0.4.5` 的两个 package 文件同步、仅提交三个允许文件、版本钩子不执行，以及并发更新 `main` 时不覆盖远端提交或留下孤立标签。另覆盖未完成价格版本按原标签重试、禁止每日任务发布未完成的手动版本、已占用版本／标签、registry 故障与错误响应、锁文件不一致、`latest` 倒退和发布可见性延迟。

价格刷新覆盖无变化时跨日期保持字节不变、忽略未导入的上游元数据，以及新增、移除、零价、缓存、Reasoning 和档位差异。独立临时副本将全部生成模型的已有费率改为另一组数字，重新运行价格与用量测试，确认正常调价不再被写死的旧费率断言拦住；算法固定夹具和人工价格例外的精确断言仍保留。

真实 GitHub 定时任务、机器人推送／Release／dispatch 和 npm OIDC 写入尚未执行；需将这些变更提交到默认分支，并满足发布说明中的权限及 Trusted Publisher 配置后，在实际工作流中验证。此次未重新运行 OpenCode TUI smoke，之前已验证的宿主结果保留在下方。

## 2026-10-02 · smoke 宿主版本策略与兼容性

环境：macOS、Node.js v22.23.2、插件包 0.4.3。OpenCode SDK 仍精确锁定 2.0.11，未随本机 CLI 升级；本机默认宿主为 Homebrew 安装的 OpenCode 2.0.22。旧版基准使用校验 npm SHA-512 完整性的官方 `@opencode/cli-darwin-arm64@2.0.11` 独立二进制，没有降级或修改日常安装。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 85 项通过，含 6 项 smoke 版本与二进制选择回归测试 |
| `npm run build` | 通过，两版 smoke 的 `npm pack` 均执行真实构建 |
| `npm run test:smoke`，默认宿主 2.0.22 | 完整通过 |
| `OPENCODE_BIN=… npm run test:smoke`，独立宿主 2.0.11 | 完整通过 |

版本检查不再把补丁版本列为白名单：允许稳定版 `>=2.0.9 <3.0.0` 运行实际集成检查。尚未与当前 SDK 验证的宿主会输出警告，但不被提前拒绝；当前已验证列表为 2.0.11、2.0.22。低于最低版本、其他主版本以及无法解析的稳定版输出仍会失败。版本检查通过本身不代表兼容性已验证。`OPENCODE_BIN` 统一用于版本探测、隔离服务端与 TUI；相对路径在切换到临时项目之前解析，结果文件记录实际宿主版本与所选二进制。

本轮保留全部原有 token、费用、上下文、布局、子代理、TPS 与 TTFT 断言，并修正测试夹具的时序：实时场景提供多段、300ms 间隔的模拟文本，避免短片段被宿主批处理合并或跨出 2s TPS 窗口；模拟流在 TUI 观察到实时指标后才结束。隔离 CLI 配置关闭持久标签页，避免不同 TUI 进程复用其他会话的焦点；详细模式滚动持续等待真实目标行可见，避免旧宿主在重新排版前处理 End。压缩模拟响应使用宿主要求的结构化摘要格式。现有 OpenCode 配置未修改，也未调用付费模型。

两版真实宿主新增验证：分叉为独立根，继承 assistant ID 保留 `_序号` 后缀；继承消息仍占被查看会话的 Context，但不重复累计用量或 Steps；分叉自己的调用单独计价。真实压缩投影为 `status === "completed"`，`order: "asc"` 的完整历史仍保留压缩前消息，压缩后没有新 assistant 时隐藏旧 Context，新消息恢复 Context，compaction 不计为 assistant step。原有全树 Total 5,080、成本 `$0.00504`、上下文上限 128,000 → 32,000 与原厂回退价 `$0.000149` 均保持通过。

验证产物：
- OpenCode 2.0.22：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-93KAN2`。
- OpenCode 2.0.11：`/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/token-usage-smoke-p0SsRF`。

产物包含 `result.json`、终端捕获、已隐藏服务器密码的日志，以及流式事件、生成中的消息和压缩消息诊断文件。2.0.9、2.0.10 的历史记录保留在下方，本轮未重新执行这两个宿主；后续版本仍需实际运行 smoke，不能据版本范围宣称兼容。

## v0.4.3 开发验证（`/usage` 模型费率展示）

验证日期：2026-09-29。Node.js v22.23.2；SDK 2.0.11；真实宿主使用隔离的 `@opencode/cli-darwin-arm64@2.0.11`，包版本仍为 0.4.2。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 69 项通过 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 通过，打包产物 + 真实 OpenCode 2.0.11 + 本地模拟提供商 |

`/usage` 的 By Model 详细模式按逐消息估算实际采用的 OpenCode／内置快照价格及上下文档位列出五类 token 费率和调用数；紧凑模式不显示费率。自动化测试覆盖同模型跨来源／档位、Reasoning 沿用 Output、零价、缺价和 `partial`，并核对逐模型与全树费用。真实宿主测试验证 160 × 54 与 100 × 28 终端的展开／收起、48 × 28 终端的单列费率，以及内置快照回退来源；未向付费模型发送请求。测试产物保存在 `/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/token-usage-smoke-4RnnLf`。

## v0.4.2（正确性与刷新性能）

验证日期：2026-09-26。Node.js v22.23.2；SDK 2.0.11；真实宿主使用校验 npm SHA-512 完整性的 `@opencode/cli-darwin-arm64@2.0.11` 隔离二进制。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 67 项通过 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 通过，打包产物 + 真实 OpenCode 2.0.11 + 本地模拟提供商；新增删除会话后的 context 清理断言 |

TTFT 的快照先到、step 结束先到，以及缺少结束事件三种情况都有保留期清理测试；快照后继续收到 delta 时恢复实时估算，不提前丢失 TTFT。无关会话的创建与分叉不触发当前树刷新；新子代理仍立即纳入，切换会话仍隔离旧请求。流式性能更新使用每次完整快照预计算的历史基线，不再为每个 delta 遍历全部历史。

大会话树测试包含根会话和 80 个子会话：首次完整读取 161 个消息页；单个子会话变化后的完整快照只重读该会话的 1 页，跨会话读取同时最多 4 个。每次仍重新枚举子会话，以发现新增与删除；分页失败或请求超时不会替换上一次完整快照，重试后恢复。被查看会话的 Context 按 `SessionInfo.revert.messageID` 截断有效消息，再应用最后一次已完成 compaction 边界；测试覆盖回退、重新生成和压缩，阶段性回退不会扣除已产生的全树费用。

`context` 钩子累计记录 MCP 等待与存储写入耗时；MCP 名称缓存 30 秒，并在连接状态变化时失效。存储写入按会话顺序异步执行，模型请求不等待持久化完成；删除事件会等待该会话未完成的写入后清理 `context/<sessionID>`。自动化测试验证缓存、写入顺序、延迟与删除竞争；打包集成测试确认真实宿主删除会话后 RPC 返回空估算。

## v0.4.0（子代理用量浮窗）

验证日期：2026-09-24。Node.js v22.23.2；SDK 2.0.11，隔离的真实 OpenCode 2.0.11 宿主。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 62 项通过 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 通过，打包产物 + 真实 OpenCode 2.0.11 + 本地模拟提供商 |

子代理视图原本通过 `session.composer.top` 常驻展示完整面板，挤占对话区高度；现在仅保留 `Token Usage · Context … · Total … · Cost … · TPS …` 一行实时摘要，不显示快捷键。点击该行可打开宿主原生居中弹窗；摘要与弹窗共享同一控制器及完整面板的精确数字和实时 TPS/TTFT。Esc 关闭浮窗后摘要继续刷新，不影响子代理运行。根会话侧边栏与 `/usage` 的五区详细弹窗保持原有入口。

真实终端集成在完成父／子代理调用后，确认子代理摘要显示 `Context 1,270 / 128,000 (1.0%)`、`Total 5,080`、`Cost <$0.01` 与实时 TPS，且没有快捷键或额外完整用量行。鼠标点击摘要打开的弹窗显示全树 `Steps 4`、`Input 400`、`Cache Read 4,000`；Esc 关闭后摘要保留，关闭浮窗未向模型发送消息。原有根会话 `/usage`、窄终端详细弹窗、活动模型切换与费用回退集成检查继续通过。

## v0.4.0（`/usage` 原生弹窗）

验证日期：2026-09-23。Node.js v22.23.2；`@opencode/plugin`、`@opencode/client` 等 SDK 精确锁定 2.0.11。弹窗布局参考本地 OpenCode 2.0.15 源码中的 `dialog-status.tsx`、`dialog-debug.tsx` 和 `dialog-shell-output.tsx`，通过插件公开的斜杠命令、弹窗、`session.hook("context")` 和 RPC 接口实现，并在真实 OpenCode 2.0.11 宿主中验证。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 62 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明 |
| `npm run test:smoke` | 通过，使用 `.tgz` 安装产物、真实 OpenCode 2.0.11 与本地模拟提供商 |

`/usage` 仅在会话页面注册为 CLI 斜杠／命令面板命令，打开原生弹窗而不向模型发送新消息。弹窗按当前查看会话展示最后一次已完成压缩后的上下文用量；五类 token 的占比以该条 assistant 消息的已用 context 为分母，窗口占用率以活动模型上下文上限为分母。会话树明细沿用侧边栏的完整分页、子代理汇总和分叉继承去重口径；按模型汇总的费用与全树 Est. Cost 共用逐消息计价规则，分别处理免费、缺价、`partial` 及内置官方价格回退。

自动化测试新增：五类 context 分类百分比、压缩边界与未知上限；混合模型和 compaction、价格回退、免费与缺价时逐模型费用对全树费用的核对；弹窗详细快照在子会话、刷新失败恢复和切换会话时的生命周期。打包集成测试确认空会话不会伪造上下文占用，真实 `/usage` 可打开与关闭、显示 1,270 token 当前上下文分类和模型费用；100 × 28 终端内滚动可到达模型费用；真实子代理合并后显示全树 5,080 token；切换活动模型后弹窗上限变为 32,000，历史消息费用仍列在原模型下。2.0.11 子代理视图最初处于宿主的子代理覆盖层，不提供斜杠输入；其全树面板验证继续由 `session.composer.top` 覆盖。

新增 **Context Sources · estimated**：服务端只在 `context` 钩子中观察最近一次已组装的模型请求，按可识别的消息文本、系统工具定义／Code Mode 目录、系统提示词、技能文本／目录、MCP 指令／工具以及其他内容分别估算，持久化的仅是六类数值、模型和采样时间；CLI 通过位置限定的 RPC 读取。估算使用 UTF-8 字节数近似，不是提供商真实 token 归因，媒体负载及提供商包装无法准确计量，也不会与含输出／推理的实测 Context 相加一致。未捕获过请求的会话显示不可用；服务端插件或 RPC 不可用时仍显示实测统计。测试覆盖六类独立归因、占比分母、无技能/MCP 时的零值、Code Mode 后续项目指令、工具结果媒体忽略、无效 RPC 数据，以及 RPC 缓慢／失败时不阻塞实测用量或串会话。真实 2.0.11 打包集成验证了请求钩子记录与 CLI 弹窗读取均生效。

## v0.4.0（`/usage` 弹窗信息架构重构）

验证日期：2026-09-23。Node.js v22.23.2；SDK 仍精确锁定 2.0.11。本轮只改弹窗的数据映射与呈现，统计与定价逻辑不变。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 62 项通过 |
| `npm run build` | 通过 |
| `npm run test:smoke` | 通过，真实 OpenCode 2.0.11 + 本地模拟提供商 |

信息架构由 `Context / Context Sources / Session Tree / Est. Cost by Model` 改为 **Context Window / Last Request / Context Breakdown / Session / By Model**：Context Window 只呈现上下文占用（分母为活动模型上限）并带条形图；原 Context 内的五类 token 迁入 Last Request 并补充该次请求的缓存率；`Context Sources · estimated` 改名 Context Breakdown；`Session Tree` 改名 Session，因为面板本来就是全树汇总而非树结构；`Est. Cost by Model` 改名 By Model。标题下方新增一行显示会话名与活动模型（多模型时显示模型数量），正文不再重复模型名，弹窗改用宿主 `centered` 选项垂直居中。

默认紧凑模式使用 K/M 缩写（< 1,000 精确、< 1,000,000 一位小数 K、≥ 1,000,000 两位小数 M，四舍五入不会出现 `1000.0K`），隐藏零值行，并把 Context Breakdown 的两类工具合并为 `Tools` 行按占比降序；按 `d` 切换详细模式，恢复精确数字、零值行、`System Tools` / `MCP Tools` 拆分以及 Session 逐类明细（含 Calls）。Session 单行汇总为 `steps · calls · tokens · cached% · cost`，其中 calls 与 By Model 各行同源，可与逐模型行核对。条形图宽度、Last Request 双列与内容宽度随宿主 `large` 档（88 列）收敛，窄终端自动改为单列并收窄条长。

自动化测试新增：`formatCompact` 边界、`bar` 填充与越界、`requestRows` 的紧凑／详细两态、`summarize().calls` 与 `summaryRows`、`countLabel` 单复数、`breakdownRows` 的工具合并、降序与零值策略。打包集成测试确认紧凑与详细两种模式可切换、`Used / Limit` 显示 `1.3K / 128.0K (1.0%)`、Context Breakdown 显示 `Tools` 合并行与条形图、Session 单行汇总、By Model 逐模型费用，以及 100 × 28 终端内滚动仍可到达模型费用。

尚未实现（属于后续评估）：真实的分叉／分支树统计、进度条以外的窗口告警色阶、公开价格目录。

## v0.3.3（GPT 与 Claude Fast 价格）

验证日期：2026-09-23。根据 [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) 与 [Claude Platform Pricing](https://platform.claude.com/docs/en/about-claude/pricing)，为当前快照中官方支持 Fast mode 的 GPT-5.5、GPT-5.6 Sol/Terra/Luna、GPT-6 Astra/Sol/Luna，以及 Claude Opus 4.8/5/5.5 分别加入独立 Fast 条目。Fast 费率按官方长上下文档位与缓存倍率记录；GPT-5.5 Fast 未公布长上下文费率，超过 272,000 个传入 token 时显示不可估价。条目分别限制到官方支持 Fast mode 的 OpenAI 与 Anthropic provider；快照由 76 个模型增至 86 个。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 51 项通过，覆盖 Fast 费率、缓存倍率、长上下文边界及普通版价格隔离 |
| `npm run build` | 通过 |

本轮只改动价格目录、对应测试及价格说明，未重跑打包集成 smoke 测试。

## v0.3.2（GPT-6 Sol / Luna 价格更新，SDK 2.0.11）

验证日期：2026-09-23。根据 [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog)，`gpt-6-sol` 和 `gpt-6-luna` 于 2026-09-22 发布；[官方定价页](https://developers.openai.com/api/docs/pricing)列出两者的 Standard 短、长上下文四类 token 费率。内置快照由 72 个模型增至 74 个。根据 [Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) 与 [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) 模型说明，传入 token 超过 272,000 时才使用长上下文价格；同轮也将已有 OpenAI 条目的边界从 271,999 校正为 272,000。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 45 项通过，新增两款模型的费率、精确匹配和档位边界断言 |
| `npm run build` | 通过 |

本轮未重跑 `npm run test:smoke`；下方的打包集成记录对应更新前的 72 模型快照。

## v0.3.1（SDK 2.0.11）

验证日期：2026-09-23。环境：macOS、Node.js v22.23.2、npm 10.9.8、OpenCode v2.0.11；`@opencode/plugin`、`@opencode/client`、`@opencode/schema` 和 `@opencode/theme` 均精确锁定为 2.0.11。

### 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 44 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明 |
| `npm run test:smoke` | 通过，使用实际 `.tgz` 安装产物和真实 OpenCode 2.0.11 |

SDK 从 2.0.9 升级到 2.0.11 后，四个顶层 OpenCode 包及锁文件中的传递依赖均已统一到 2.0.11。`@opencode/plugin` 两版的导出结构一致；包内容差异除依赖版本外，仅为 `ToastOptions` 新增可选的 `sessionID` 类型字段。

本次发放在内置官方价格快照中新增 Anthropic `claude-opus-5-5`（2026-09-22 发布，$4 / $20，5 分钟缓存写入 $5，缓存读取按官方 0.05 倍基础输入价计为 $0.20），OpenRouter 圆点写法 `claude-opus-5.5` 注册为精确别名；快照由 71 个模型增至 72 个，新增测试锁定官方费率、0.05 倍缓存读取乘率、OpenRouter 与 Bedrock 包装格式匹配。

新增共享性能监视器测试覆盖：查看会话 A 时捕获独立会话 B 的流，切换到 B 后立即恢复实时 TPS/TTFT；生成中切走、继续接收 delta 再切回；控制器销毁重建后恢复共享流；不同会话树隔离、新子代理即时纳入，以及删除会话清理运行期状态。既有重复事件去重与完成后收敛为精确 TPS 的断言继续通过。

新增 Steps 计数覆盖：`summarize` 对带与不带 `tokens` 的 assistant 消息各计一个 step、compaction 与 user 消息不计、无 summary 时显示 `—`；`uniqueMessages` 链路上分叉继承副本不重复计数（快照 2 个 step、独立分叉树 1 个 step）、compaction 不产生 step、孙会话视图与根视图同为 6 个 step；行序断言锁定 Context → Steps → Input，无 Context 时 Steps 位于面板第一行。基准行数由 6 行调整为 7 行。

v0.3.0 成本测试覆盖：assistant 与 compaction 按消息实际 `model` 和五类 token 分别计算，混合模型树各自采用对应价格，消息自带 `cost` 不参与主 Est. Cost。当前 OpenCode 模型目录中的完整适用价格优先；适用档位或实际使用类别缺价时，整条消息回退到内置官方快照，不拼接两套费率。官方目录测试锁定 72 个 2026-03-22 至 2026-09-22 发布的模型、来源 URL、唯一 ID、OpenAI/xAI/通义千问/MiniMax/Sakana 长上下文与上下文档位边界，以及 OpenRouter、Bedrock、Vertex 等包装格式和明确别名；相似名称不得猜价。目录按 OpenCode 当前模型目录（`temp/models.json`，210 个模型）补齐主流厂商：OpenAI、Anthropic、Google、xAI、Mistral、Cohere 之外新增 Z.ai（GLM）、DeepSeek、Moonshot（Kimi）、阿里云百炼（Qwen）、小米（MiMo）、MiniMax、腾讯（混元）、StepFun、Meta、Inception、Upstage、Arcee AI、ByteDance Seed、Sakana、Aion Labs、美团（LongCat）；DeepSeek V4.1 Flash 与 V4 Pro 按厂商官方峰值最高价估算，旧 Flash、Vision Exp 和日期版本通过精确别名匹配。Step 5 Preview 的缓存写入按官方“cache-miss Input 包含首次缓存写入”规则使用 `$1 / M`。OpenRouter 圆点写法 `claude-opus-4.7`/`4.8`/`5.5`、官方 ChatGPT SKU `chat-latest`（别名 `gpt-chat-latest`）、Mercury 2.5、Solar Pro 4、Seed 2.1 Turbo、Fugu 版本、Aion 的 `aion-labs/` 前缀与 LongCat 网关链路同样通过精确别名匹配。窗口外的 `grok-4.20`、Fast/Priority 档、图片/音频/视频、免费与无官方标准价的模型均不收录；`kwaipilot/kat-coder-pro-v2.5`、`inclusionai/ling-3.0-*` 和 `bytedance-seed/seed-2.0-code` 只有网关或第三方报价，未据此猜价。缺价显示 `Est. Cost —`，已知小计与缺价消息并存时显示 `· partial`，明确零价显示 `$0.00`。

### 真实 OpenCode 集成

隔离 smoke 测试确认打包插件可加载；空会话隐藏无数据行并显示 `Steps 0`；在独立会话已经开始慢速流后，同一 TUI 切换过去会立即显示 `TPS ~…` 与 TTFT，完成后变为无 `~` 的精确 TPS；既有 token、上下文刷新、真实子代理全树累计、会话局部上下文及模型切换验证均继续通过。Steps 在真实集成中断言为：首条 assistant 完成后 `Steps 1` 且行序位于 Context 与 Input 之间；真实子代理场景下根视图与子代理视图均为 `Steps 4`（父 3 条 + 子 1 条），而被查看会话自身仍为 1。按 OpenCode 夹具价格计算，首条调用为 `$0.00126`，四条父/子代理调用累计 `$0.00504`；根会话切换到另一价格模型后，历史消息仍按自身模型保持 `$0.00504`，Context 则从 128,000 上限同步切换到 32,000。另一个模型在 OpenCode 目录中明确为 `cost: []`，其 `gpt-5.6-luna` 调用由打包产物内置官方价格计算为 `$0.000149`，TUI 显示 `Est. Cost <$0.01`；安装包同时断言包含 `dist/pricing.js`、类型声明与 `docs/pricing.md`。本次 smoke 使用官方 `@opencode/cli-darwin-arm64@2.0.11` 的隔离二进制（安装于 `/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/isolated-cli-2011`，机器默认宿主仍为 2.0.14，未放宽版本断言），测试产物保存在 `/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/token-usage-smoke-Zq62zn`。

### 验证边界

当前 SDK 2.0.11 与宿主 2.0.11 的组合已完整验证。验证时机器默认宿主已是 2.0.14，因此 smoke 使用校验完整性的官方 `@opencode/cli-darwin-arm64@2.0.11` 隔离二进制，没有放宽宿主版本断言。2.0.9 和 2.0.10 宿主的历史验证记录保留在下方，但升级 SDK 后未重新执行这两个旧宿主的打包矩阵。后续升级 SDK 或宿主时，仍需重新核对消息模型字段、模型价格结构、分叉副本、compaction 排序及 step/delta 事件语义。官方价格是 2026-09-23 的版本内快照，采用标准同步 API 公开价；DeepSeek 峰谷计费采用峰值最高价作为保守上界。网关溢价、区域价、免费额度、折扣、工具费及无法由五类 token 表示的计费不在估算内，详细范围见 `docs/pricing.md`。

## v0.2.1（TPS 与 TTFT）

验证日期：2026-09-20。环境：macOS、Node.js v22.23.2、npm 10.9.8、OpenCode v2.0.11；插件 SDK 依赖为 2.0.9。

### 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 29 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明，包括 `dist/performance.js` |
| `npm pack --dry-run` | 通过，`@chenlongapps/opencode-token-usage@0.2.1` 包含 19 个文件，压缩后约 20 KB |
| `npm publish --dry-run` | 通过，完整执行 `prepublishOnly`、`prepack` 并确认 public access；未写入 registry |
| `npm run test:smoke` | 通过，使用实际 `chenlongapps-opencode-token-usage-0.2.1.tgz` 安装产物 |

npm 发布前检查确认无作用域名称 `opencode-token-usage` 已由其他作者占用，因此本项目使用与 GitHub 仓库所有者一致的 `@chenlongapps/opencode-token-usage`。`0.2.1` 已发布到 [npm](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)，registry 查询确认 `latest` 指向 `0.2.1`。包元数据、公开 registry、GitHub Actions CI 与 Trusted Publishing/OIDC 发布工作流均已配置。`npm audit` 报告 2 个 low、11 个 moderate、0 个 high、0 个 critical，均来自固定的 OpenCode 2.0.9 / OpenTUI / OpenTelemetry 依赖链，当前锁定版本下没有可直接应用的完整修复。

新增测试覆盖：已完成 assistant 的 Output + Reasoning / 流式总时长加权 TPS；无效时间、零输出与 compaction 排除；reasoning/tool 历史 TTFT、纯文本历史不伪造样本、运行期样本覆盖历史；文本、推理、工具输入三类流式增量；UTF-8 字节估算、重复事件去重、并发活动流合并；无关会话忽略、新建子代理即时纳入、切换会话树清理；流式更新不读取数据源，完成后从估算 TPS 收敛到精确 TPS；性能行位于用量与费用之后，与前一组间隔一行，并保持格式与缺失隐藏。

### 真实 OpenCode 集成

`scripts/smoke.mjs` 使用带固定延迟的本地 OpenAI 兼容流，在真实 OpenCode 服务和 160 × 54 TUI 中验证：

- 空会话隐藏 TPS、TTFT、Context、Cache Write 与 Est. Cost，不显示伪零性能值。
- 第一段文本到达时，面板显示 `TPS ~2.4 tok/s` 与 `TTFT 0.4s`；`~` 明确表示按 UTF-8 字节估算的活动流速度。
- assistant 完成并刷新快照后，TPS 自动变为无 `~` 的 `62.9 tok/s`。打包产物的 `historicalPerformance` 返回 62.893… tok/s，且同屏 OpenCode 自带消息状态也显示 62.9 tok/s。
- 行顺序为 Context、五类 token、Cache Rate、Total、Est. Cost、空行、TPS、TTFT；Est. Cost 隐藏时仍在最后一条用量行后空一行。原有上下文、真实子代理全树累计与模型切换测试继续通过。
- 安装包包含 `dist/performance.js` 及其类型声明；结果文件记录宿主版本 2.0.11、Total 5,080 和性能值。
- scoped 包安装在 `node_modules/@chenlongapps/opencode-token-usage` 后，根入口、TUI 入口和所有运行时断言均通过。

### 口径与验证边界

- 精确 TPS 沿用 OpenCode 2 当前口径：全树可用 assistant 样本的 `Σ(Output + Reasoning) ÷ Σ(time.streamed - time.created)`；compaction 不参与。活动生成优先显示 UTF-8 增量按 4 字节/token 换算的估计值，多个活动流先合并 token 与时长再相除，最多每 100ms 发布一次且不触发完整快照读取。
- TTFT 从 `session.step.started.data.started` 到首个 `session.text.delta`、`session.reasoning.delta` 或 `session.tool.input.delta`。运行期样本可精确测量；历史 reasoning/tool 内容可使用自身 `time.created`，纯文本历史缺少首 token 时间，故不纳入平均。
- 2.0.11 的事件字段、流式显示、精确 TPS、子代理事件归属与打包加载已通过上述真实测试。SDK 仍固定 2.0.9；升级 SDK 或宿主到更高版本时仍需重新核对 step/delta 时间语义、compaction 排序和分叉副本规则。
- 实时 TPS 是近似展示，中文、emoji、工具 JSON 等不同 UTF-8 字节分布会影响 4 字节/token 的误差；完成后以服务端真实 token 与时间替换。

## v0.2.0（上下文用量）

验证日期：2026-09-20。环境：macOS、Node.js v22.23.2、npm 10.9.8、OpenCode v2.0.10；插件 SDK 依赖为 2.0.9。

### 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 23 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明 |
| `npm run test:smoke` | 通过，使用实际 `.tgz` 安装产物 |

新增测试覆盖：上下文取五类 token 之和、压缩边界（`completed` 重置窗口，`running` 与 `failed` 不重置）、跳过没有上报用量的消息、未知上限（缺失、零、负数、NaN、Infinity）隐藏、百分比超过 100%、上下文行位于面板第一行且百分比同行；视图消息顺序与被查看会话隔离；模型切换后重新读取上限；刷新失败时保留上次上下文并标注未更新。

### 真实 OpenCode 集成

`scripts/smoke.mjs` 沿用 v0.1.0 的隔离方式，并新增上下文断言：

- 空会话：面板保持 Input、Output、Reasoning、Cache Read、Cache Rate、Total 六行零值，不出现 `/ 128,000`、Context 行、Cache Write 与 Est. Cost。
- 首条 assistant 完成后：`Context  1,270 / 128,000 (1.0%)`，且该行出现在 `Input` 行之上（终端逐行比对行号）。同一时刻宿主自带侧边栏为 `Context 1,270 tokens 1% used`，用量与插件一致（宿主百分比取整，插件保留一位小数）。
- 子代理视图：树的累计 `Total 5,080`，而上下文仍为 `1,270 / 128,000 (1.0%)`，确认上下文只反映被查看会话、不随子树累计。
- 切换到 `usage-test/large`（夹具上限 32,000）后无需新消息即同步：`Context 1,270 / 32,000 (4.0%)`。
- 打包产物导出的 `contextUsage` / `viewedMessages` 直接断言为 `used 1270`、`limit 128000`、`percent 1.0`。

### 接口适配与验证边界

- 上下文口径参照 OpenCode 2.0.10 打包产物的侧边栏实现（`Ws`/`S6`）：最后一次 `completed` 压缩之后、最后一条带 `tokens` 的 assistant 消息的五类 token 之和。SDK 依赖仍为 2.0.9，2.0.9 宿主未单独核对这一显示算法。
- 宿主 `Ws` 还使用 `session.revert` 作为搜索上界；本版本不读取 revert 状态，回退会话的取值可能与宿主不同。
- 分母使用被查看会话的**活动模型**，而不是产生该用量的消息自身记录的模型；会话中途切换模型后两者可能不同。
- Est. Cost 与上下文上限使用同一活动模型解析规则，同样不使用消息自身记录的 `model` 字段：混合模型会话的 Est. Cost 按查看时活动模型统一重算，不等于各模型实际账单之和。真实集成只验证了单夹具模型下的价格重算，混合模型的失真未单独断言。
- 不显示进度条，上下文百分比与用量同行；行值加标签约 31 字符，窄侧边栏可能换行，响应式布局与进度条留待后续版本。
- 夹具 `usage-test/large` 的上下文上限改为 32,000 以便观测模型切换，`usage-test/small` 保持 128,000。

## v0.1.0

验证日期：2026-09-19。环境：macOS、Node.js v22.23.2、npm 10.9.8、OpenCode v2.0.10；插件 SDK 依赖为 2.0.9。

### 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 18 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明 |
| `npm run test:smoke` | 通过，使用实际 `.tgz` 安装产物 |

单元及组件逻辑测试覆盖五类 token、零值和缺失字段、缓存命中率、逗号分组与四舍五入边界、普通及缓存价格、推理费用、价格阶梯的严格阈值、免费模型、缺失价格、模型重算、多层后代、历史分页、compaction、继承历史去重、重复事件、请求隔离、卸载、读取失败与恢复。

游标适配还有独立回归测试：后续消息页不得重新传入 `order`；子会话游标自身包含 `parentID` 过滤条件。

### 真实 OpenCode 集成

`scripts/smoke.mjs` 在独立临时目录中执行 `npm pack` 与 `npm install`，使用安装后的根目录入口加载插件。真实 OpenCode 服务通过本地 OpenAI 兼容模拟端点生成消息，并调用内置 subagent 工具创建子代理。推理返回是固定测试数据，不是付费模型响应。

Python 3 为真实 TUI 提供 160 × 54 的伪终端，终端输出经 xterm 解析后进行断言并保存文本和 ANSI 捕获。

已验证：

- 主插件激活、TUI 插件加载；安装包包含根目录 `index.js` / `tui.js`、编译产物及类型声明。
- 空会话隐藏零值的 Cache Write 与 Est. Cost；基础统计行、宿主标题、Context 与费用区继续保留。
- 首条 assistant 完成后无需重新进入会话即可刷新：Input 100、Output 50、Reasoning 20、Cache Read 1,000、Cache Write 100，Total 1,270。
- 父会话三条 assistant 消息和一个真实子代理的一条消息共同累计为 Total 5,080，显示为 `5,080`。
- 父视图与子代理视图都显示 Input 400、Output 200、Reasoning 80、Cache Read 4,000、Cache Write 400、Cache Rate 83.3%。
- 切换根会话活动模型后，重新读取 `usage-test/large` 的价格并重算费用；模型切换费用重算另有数值单元断言。

### 接口适配与验证边界

- 2.0.10 的本地目录加载器通过根部 `index` / `tui` 文件发现入口，仅有 package exports 不足以加载本地目录，因此包包含转发入口；2.0.9 兼容性也已验证。
- 2.0.10 在子代理视图中不挂载侧边栏；通过官方 `session.composer.top` 插槽显示同一完整面板；2.0.9 兼容性也已验证。
- 完整历史使用 `message.list`，不使用会在压缩后截断历史的 `session.context`。
- 分叉副本识别依赖 2.0.9 的消息 ID 后缀约定；更高 OpenCode 版本尚未验证。
- 多层分页、压缩与分叉去重、故障恢复由自动化逻辑测试覆盖；真实 TUI 验证覆盖加载、正常消息、一级真实子代理和模型切换。

重现时运行 README 中的检查命令。烟雾测试会输出临时产物目录，包含 `result.json`、`plugins.json`、各阶段终端捕获和已隐藏服务器密码的日志。

## 2026-09-25 · 原厂价格半自动更新

`npm run prices:update` 从 models.dev API 提取经审核的原厂 Provider 自家文本型号，生成离线 `src/prices.generated.ts`：本次为 283 条生成价格，叠加已核实例外后为 296 条。脚本重跑时确认生成内容不变（新增、删除、变化均为 0）。例外与原厂过滤在 `src/overrides.ts`，精确别名在 `src/aliases.ts`；网关/地域/订阅报价不作为数据源。

已通过 `npm run typecheck`、55 项 `npm test` 和 `npm run build`。使用临时安装的 OpenCode v2.0.11 运行 `npm run test:smoke`，打包安装后的插件通过侧边栏、`/usage`、真实子代理、模型切换、无 OpenCode 价格时的内置回退等检查；打包产物包含生成快照、别名和例外模块。当前机器默认 OpenCode v2.0.16 未参与本次集成验证。
