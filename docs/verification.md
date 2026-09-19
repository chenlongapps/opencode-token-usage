# v0.1.0 验证记录

验证日期：2026-09-19。环境：macOS、Node.js v22.23.2、npm 10.9.8、OpenCode v2.0.9。

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 17 项通过 |
| `npm run build` | 通过，输出 ESM 与类型声明 |
| `npm run test:smoke` | 通过，使用实际 `.tgz` 安装产物 |

单元及组件逻辑测试覆盖五类 token、零值和缺失字段、缓存命中率、K/M 边界、普通及缓存价格、推理费用、价格阶梯的严格阈值、免费模型、缺失价格、模型重算、多层后代、历史分页、compaction、继承历史去重、重复事件、请求隔离、卸载、读取失败与恢复。

游标适配还有独立回归测试：后续消息页不得重新传入 `order`；子会话游标自身包含 `parentID` 过滤条件。

## 真实 OpenCode 集成

`scripts/smoke.mjs` 在独立临时目录中执行 `npm pack` 与 `npm install`，使用安装后的根目录入口加载插件。真实 OpenCode 服务通过本地 OpenAI 兼容模拟端点生成消息，并调用内置 subagent 工具创建子代理。推理返回是固定测试数据，不是付费模型响应。

Python 3 为真实 TUI 提供 160 × 54 的伪终端，终端输出经 xterm 解析后进行断言并保存文本和 ANSI 捕获。

已验证：

- 主插件激活、TUI 插件加载；安装包包含根目录 `index.js` / `tui.js`、编译产物及类型声明。
- 空会话显示全部八行；宿主标题、Context 与费用区继续保留。
- 首条 assistant 完成后无需重新进入会话即可刷新：Input 100、Output 50、Reasoning 20、Cache Read 1,000、Cache Write 100，Total 1,270。
- 父会话三条 assistant 消息和一个真实子代理的一条消息共同累计为 Total 5,080，显示为 `5.1K`。
- 父视图与子代理视图都显示 Input 400、Output 200、Reasoning 80、Cache Read 4K、Cache Write 400、Cache Rate 83.3%。
- 切换根会话活动模型后，面板自动更新为 `usage-test/large`；模型切换费用重算另有数值单元断言。

## 接口适配与验证边界

- 2.0.9 的本地目录加载器通过根部 `index` / `tui` 文件发现入口，仅有 package exports 不足以加载本地目录，因此包包含转发入口。
- 2.0.9 在子代理视图中不挂载侧边栏；通过官方 `session.composer.top` 插槽显示同一完整面板。
- 完整历史使用 `message.list`，不使用会在压缩后截断历史的 `session.context`。
- 分叉副本识别依赖 2.0.9 的消息 ID 后缀约定；更高 OpenCode 版本尚未验证。
- 多层分页、压缩与分叉去重、故障恢复由自动化逻辑测试覆盖；真实 TUI 验证覆盖加载、正常消息、一级真实子代理和模型切换。

重现时运行 README 中的检查命令。烟雾测试会输出临时产物目录，包含 `result.json`、`plugins.json`、各阶段终端捕获和已隐藏服务器密码的日志。
