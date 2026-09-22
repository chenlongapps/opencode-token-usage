# 验证记录

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

v0.3.0 成本测试覆盖：assistant 与 compaction 按消息实际 `model` 和五类 token 分别计算，混合模型树各自采用对应价格，消息自带 `cost` 不参与主 Cost。当前 OpenCode 模型目录中的完整适用价格优先；适用档位或实际使用类别缺价时，整条消息回退到内置官方快照，不拼接两套费率。官方目录测试锁定 72 个 2026-03-22 至 2026-09-22 发布的模型、来源 URL、唯一 ID、OpenAI/xAI/通义千问/MiniMax/Sakana 长上下文与上下文档位边界，以及 OpenRouter、Bedrock、Vertex 等包装格式和明确别名；相似名称不得猜价。目录按 OpenCode 当前模型目录（`temp/models.json`，210 个模型）补齐主流厂商：OpenAI、Anthropic、Google、xAI、Mistral、Cohere 之外新增 Z.ai（GLM）、DeepSeek、Moonshot（Kimi）、阿里云百炼（Qwen）、小米（MiMo）、MiniMax、腾讯（混元）、StepFun、Meta、Inception、Upstage、Arcee AI、ByteDance Seed、Sakana、Aion Labs、美团（LongCat）；DeepSeek V4.1 Flash 与 V4 Pro 按厂商官方峰值最高价估算，旧 Flash、Vision Exp 和日期版本通过精确别名匹配。Step 5 Preview 的缓存写入按官方“cache-miss Input 包含首次缓存写入”规则使用 `$1 / M`。OpenRouter 圆点写法 `claude-opus-4.7`/`4.8`/`5.5`、官方 ChatGPT SKU `chat-latest`（别名 `gpt-chat-latest`）、Mercury 2.5、Solar Pro 4、Seed 2.1 Turbo、Fugu 版本、Aion 的 `aion-labs/` 前缀与 LongCat 网关链路同样通过精确别名匹配。窗口外的 `grok-4.20`、Fast/Priority 档、图片/音频/视频、免费与无官方标准价的模型均不收录；`kwaipilot/kat-coder-pro-v2.5`、`inclusionai/ling-3.0-*` 和 `bytedance-seed/seed-2.0-code` 只有网关或第三方报价，未据此猜价。缺价显示 `Cost —`，已知小计与缺价消息并存时显示 `· partial`，明确零价显示 `$0.00`。

### 真实 OpenCode 集成

隔离 smoke 测试确认打包插件可加载；空会话隐藏无数据行并显示 `Steps 0`；在独立会话已经开始慢速流后，同一 TUI 切换过去会立即显示 `TPS ~…` 与 TTFT，完成后变为无 `~` 的精确 TPS；既有 token、上下文刷新、真实子代理全树累计、会话局部上下文及模型切换验证均继续通过。Steps 在真实集成中断言为：首条 assistant 完成后 `Steps 1` 且行序位于 Context 与 Input 之间；真实子代理场景下根视图与子代理视图均为 `Steps 4`（父 3 条 + 子 1 条），而被查看会话自身仍为 1。按 OpenCode 夹具价格计算，首条调用为 `$0.00126`，四条父/子代理调用累计 `$0.00504`；根会话切换到另一价格模型后，历史消息仍按自身模型保持 `$0.00504`，Context 则从 128,000 上限同步切换到 32,000。另一个模型在 OpenCode 目录中明确为 `cost: []`，其 `gpt-5.6-luna` 调用由打包产物内置官方价格计算为 `$0.000149`，TUI 显示 `Cost <$0.01`；安装包同时断言包含 `dist/pricing.js`、类型声明与 `docs/pricing.md`。本次 smoke 使用官方 `@opencode/cli-darwin-arm64@2.0.11` 的隔离二进制（安装于 `/private/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/opencode/isolated-cli-2011`，机器默认宿主仍为 2.0.14，未放宽版本断言），测试产物保存在 `/var/folders/rw/bmx6c8hd737brl55m0_ff_b80000gn/T/token-usage-smoke-Zq62zn`。

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

- 空会话隐藏 TPS、TTFT、Context、Cache Write 与 Cost，不显示伪零性能值。
- 第一段文本到达时，面板显示 `TPS ~2.4 tok/s` 与 `TTFT 0.4s`；`~` 明确表示按 UTF-8 字节估算的活动流速度。
- assistant 完成并刷新快照后，TPS 自动变为无 `~` 的 `62.9 tok/s`。打包产物的 `historicalPerformance` 返回 62.893… tok/s，且同屏 OpenCode 自带消息状态也显示 62.9 tok/s。
- 行顺序为 Context、五类 token、Cache Rate、Total、Cost、空行、TPS、TTFT；Cost 隐藏时仍在最后一条用量行后空一行。原有上下文、真实子代理全树累计与模型切换测试继续通过。
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

- 空会话：面板保持 Input、Output、Reasoning、Cache Read、Cache Rate、Total 六行零值，不出现 `/ 128,000`、Context 行、Cache Write 与 Cost。
- 首条 assistant 完成后：`Context  1,270 / 128,000 (1.0%)`，且该行出现在 `Input` 行之上（终端逐行比对行号）。同一时刻宿主自带侧边栏为 `Context 1,270 tokens 1% used`，用量与插件一致（宿主百分比取整，插件保留一位小数）。
- 子代理视图：树的累计 `Total 5,080`，而上下文仍为 `1,270 / 128,000 (1.0%)`，确认上下文只反映被查看会话、不随子树累计。
- 切换到 `usage-test/large`（夹具上限 32,000）后无需新消息即同步：`Context 1,270 / 32,000 (4.0%)`。
- 打包产物导出的 `contextUsage` / `viewedMessages` 直接断言为 `used 1270`、`limit 128000`、`percent 1.0`。

### 接口适配与验证边界

- 上下文口径参照 OpenCode 2.0.10 打包产物的侧边栏实现（`Ws`/`S6`）：最后一次 `completed` 压缩之后、最后一条带 `tokens` 的 assistant 消息的五类 token 之和。SDK 依赖仍为 2.0.9，2.0.9 宿主未单独核对这一显示算法。
- 宿主 `Ws` 还使用 `session.revert` 作为搜索上界；本版本不读取 revert 状态，回退会话的取值可能与宿主不同。
- 分母使用被查看会话的**活动模型**，而不是产生该用量的消息自身记录的模型；会话中途切换模型后两者可能不同。
- Cost 与上下文上限使用同一活动模型解析规则，同样不使用消息自身记录的 `model` 字段：混合模型会话的 Cost 按查看时活动模型统一重算，不等于各模型实际账单之和。真实集成只验证了单夹具模型下的价格重算，混合模型的失真未单独断言。
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
- 空会话隐藏零值的 Cache Write 与 Cost；基础统计行、宿主标题、Context 与费用区继续保留。
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
