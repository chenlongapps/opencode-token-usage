# opencode-token-usage

面向 **OpenCode 2** 的 token 用量插件，当前版本 **0.2.1**。SDK 依赖固定为 2.0.9，宿主已验证 2.0.9、2.0.10 和 2.0.11。在原生 TUI 侧边栏追加用量面板，统计当前会话所在的整棵会话树，包括未打开的子代理，并显示性能指标与当前查看会话的上下文占用。

## 预览

```text
Token Usage
Context        9,810 / 128,000 (7.7%)
TPS                         48.7 tok/s
TTFT                              2.7s
Input                          54,200
Output                          6,800
Reasoning                       4,100
Cache Read                     31,700
Cache Write                     1,300
Cache Rate                      36.4%
Total                          98,100
Cost                            $0.21
```

示例费用使用每百万 token 的 Input / Output / Cache Read / Cache Write 单价 $2 / $8 / $0.2 / $3。实际价格与上下文上限取自当前查看会话的活动模型。

## 本地安装

需要 Node.js 22+、npm 和 OpenCode **2.0.9、2.0.10 或 2.0.11**。本版本没有发布到 npm；更高版本的 OpenCode 尚未验证。npm SDK 依赖仍锁定为 2.0.9。

在此仓库中执行：

```bash
npm ci
npm run typecheck
npm test
npm run build
```

将仓库的绝对路径加入目标项目的 `opencode.json` 或 `opencode.jsonc`，保留已有插件：

```json
{
  "plugins": ["/absolute/path/opencode-token-usage"]
}
```

然后在目标项目运行 `opencode`，进入会话。OpenCode 自动加载主入口及 `./tui` 入口；包根目录还提供 `index.js` 和 `tui.js`，适配 2.0.9–2.0.11 的本地目录发现方式。面板追加到 `sidebar.content`，宿主原有侧边栏内容继续保留。侧边栏的显示与宽度由宿主管理；终端需要足够宽，并且 CLI 设置 `session.sidebar` 为 `auto`。

OpenCode 2.0.9–2.0.11 在子代理视图中强制隐藏侧边栏，因此插件通过 `session.composer.top` 在输入区上方显示同一完整面板。进入子代理仍统计整棵会话树，费用、上下文用量与上限改用该子代理的消息和活动模型。

连接远程服务器时，可把相同插件路径加入本机 `~/.config/opencode/cli.json` 的 `plugins`，仅加载终端入口。配置路径遵循 `XDG_CONFIG_HOME`，没有项目级 `cli.json`。

也可安装独立打包产物：

```bash
npm pack
npm install --prefix /absolute/path/local-plugins ./opencode-token-usage-0.2.1.tgz
```

此时配置的插件路径为 `/absolute/path/local-plugins/node_modules/opencode-token-usage`。包包含编译后的 ESM 和类型声明，无需在使用时编译 JSX。

## 统计口径

- 沿当前会话的 `parentID` 找到根，再分页读取所有后代及其完整消息。进入子代理仍显示同一棵树的累计用量。
- 统计服务端上报的 assistant 和 compaction 消息，包括压缩前历史及失败消息中已记录的用量。不根据文本长度估算 token，不计入没有关联消息的标题生成用量。
- 按会话和消息 ID 保存快照，每次成功刷新替换旧值，重复事件不会累加两次。分叉会话属于独立会话树；继承历史只归原始来源，其副本不重复计费。分叉副本识别依据 OpenCode 2.0.9 的 ID 生成规则。
- `Input` 不含缓存读取或写入；`Output` 不含 `Reasoning`。
- `Total = Input + Output + Reasoning + Cache Read + Cache Write`。
- `Cache Rate = Cache Read ÷ (Input + Cache Read + Cache Write)`；保留一位小数，分母为零时显示 `0.0%`。
- `Cache Write` 和 `Cost` 仅在值大于零时显示。空会话保留其他统计行并显示零；首次读取显示 `Loading…` 和 `—`，首次失败显示 `Unavailable`。刷新失败保留上次完整结果，标注 `Not updated` 并自动重试。

### 性能指标

`TPS` 统计整棵会话树的模型生成速度，token 口径为 Output + Reasoning。已完成消息使用服务端记录的 `time.created → time.streamed` 总时长和真实 token 加权计算，即 `Σ(Output + Reasoning) ÷ Σ流式时长`。有活动生成时优先显示实时估算：合并所有活动流的 UTF-8 增量，按约 4 字节/token 换算并以 `~` 标记；完成刷新后自动替换为精确值。流式增量不会触发完整历史扫描。

`TTFT` 是整棵会话树中可测 assistant step 从请求发出到首个模型输出的算术平均值。首输出包括文本、推理和工具输入增量。插件运行期间使用实时事件精确记录；加载历史时仅使用带可靠创建时间的首个 reasoning 或 tool 内容。纯文本历史没有首 token 时间戳，因此不以完成时间伪造样本，也不会拉低平均值。没有可用样本时隐藏对应性能行。

### 上下文用量

`Context` 是面板的第一行（状态提示之后），只反映**当前查看会话本身**，不随子树累计：取该会话中最后一条带 `tokens` 的 assistant 消息的五类 token 之和，并且只搜索最后一次 `completed` 压缩之后的消息——与 OpenCode 侧边栏显示的口径一致。正在运行或失败的压缩不重置窗口；压缩刚结束而尚无新回复时隐藏该行，不回退到压缩前的数值。正在生成、尚无用量的最后一条消息会被跳过，沿用上一条有上报的消息。

上限取当前查看会话活动模型的 `limit.context`，与 `Cost` 使用同一解析规则，因此切换模型后百分比立即更新。模型没有可用上限（缺失、为零、非有限值）或尚无用量的会话隐藏 `Context` 行。行内格式为 `已用 / 上限 (百分比%)`，百分比保留一位小数，用量超过上限时显示真实值。当前版本不显示进度条。

### 估算费用

`Cost` 是按**当前查看会话的活动模型**重新估算的全树费用，不是提供商账单，也不累加历史消息中保存的 `cost`。它不使用每条消息自身记录的模型：同一会话里即使多条消息由不同模型生成，也统一按查看时活动模型的价格档位推算，因此混合模型会话的金额**不等于**按各消息实际模型计费之和——它回答的是"把这棵树按当前模型重跑一遍会花多少"。未选定模型时使用该会话位置的默认模型，切换模型后重新计算。

每条消息分别使用其传入 token 数（Input + Cache Read + Cache Write）选择价格档位：严格超过阈值才进入该档，多个档位适用时取最高阈值，否则用基础档。Output 和 Reasoning 都使用输出单价，最后合计各条消息的费用。

没有模型价格或适用档位时按 OpenCode 官方计费实现回退为 **0**。合法的免费模型也按其实际价格计算；价格请求失败会显示未更新状态。这里的“默认价格”并非内置的公开价格目录。

数字使用千位逗号分组并显示为四舍五入后的整数；例如 `1200 → 1,200`、`125000 → 125,000`、`1500000 → 1,500,000`。美元保留两位小数，正数不足一美分显示 `<$0.01`。

## 开发与验证

```bash
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`test:smoke` 需要本机 OpenCode 2.0.9、2.0.10 或 2.0.11、Python 3、可用的本地端口及 npm 网络访问。它打包并安装真实产物，在临时目录启动隔离的 OpenCode 服务和真实 TUI，通过带延迟的本地模拟提供商检查加载、实时 TPS 与 TTFT、完成后精确 TPS、用量与上下文刷新、真实子代理累计及模型切换。不会修改现有 OpenCode 配置或使用付费模型。终端捕获和测试记录保留在输出的临时路径。

2026-09-20 已通过类型检查、29 项自动化测试、构建和上述真实集成验证，详见 [验证记录](docs/verification.md)。

架构：`usage.ts` 处理统计、上下文与格式化，`performance.ts` 处理 TPS、TTFT 与流式事件，`source.ts` 对接 v2 客户端和分页，`controller.ts` 合并刷新、隔离旧请求与处理失败，`tui.tsx` 渲染侧边栏。流式增量只更新内存中的性能指标；用量、会话和模型事件仍通过合并刷新重新分页扫描会话树，以保证历史完整性。超大历史的增量读取优化留待后续版本。

紧凑模式、`/usage` 和公开价格目录尚未实现，详见 [ROADMAP.md](ROADMAP.md)。

## 接口依据

- [OpenCode 2 CLI 插件接口](https://opencode.ai/v2/docs/build/plugins/cli/)
- [OpenCode 2 插件加载](https://opencode.ai/v2/docs/build/plugins/)
- [CLI 设置](https://opencode.ai/v2/docs/cli/config/)
- [TokenUsage 定义](https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/token-usage.ts)
- [官方计费实现](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/usage.ts)
- [分叉历史投影](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/projector.ts)

## 许可证

[MIT](LICENSE)
