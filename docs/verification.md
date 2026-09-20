# 验证记录

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
- 不显示进度条，上下文百分比与用量同行；行值加标签约 31 字符，窄侧边栏可能换行，响应式布局留待 v0.3.0。
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
