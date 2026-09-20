# opencode-token-usage

[![npm version](https://img.shields.io/npm/v/%40chenlongapps%2Fopencode-token-usage?logo=npm)](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)
[![OpenCode 2](https://img.shields.io/badge/OpenCode-2-5A67D8)](https://opencode.ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

面向 **OpenCode 2** 的 token 用量插件。在原生 TUI 中显示整棵会话树（含子代理）的 token、估算费用与性能指标，以及当前会话的上下文占用。

## 预览

```text
Token Usage
Context        9,810 / 128,000 (7.7%)
Input                          54,200
Output                          6,800
Reasoning                       4,100
Cache Read                     31,700
Cache Write                     1,300
Cache Rate                      36.4%
Total                          98,100
Cost                            $0.21

TPS                         48.7 tok/s
TTFT                              2.7s
```

实际价格与上下文上限取自当前会话的活动模型。

## 安装

推荐使用 OpenCode 安装：

```bash
opencode plugin add @chenlongapps/opencode-token-usage
```

也可以在项目的 `opencode.json` 或 `opencode.jsonc` 中配置：

```json
{
  "plugins": ["@chenlongapps/opencode-token-usage"]
}
```

安装后重启 OpenCode。主会话中的面板位于原生侧边栏；终端需要足够宽，且 `session.sidebar` 应设为 `auto`。宿主在子代理视图中隐藏侧边栏，因此插件会在输入区上方显示同一面板。

连接远程服务器时，可将包名加入本机 `~/.config/opencode/cli.json` 的 `plugins`，仅加载终端入口；配置路径遵循 `XDG_CONFIG_HOME`。

## 指标口径

| 指标 | 定义 |
| --- | --- |
| `Input` | 输入 token，不含缓存读取和写入 |
| `Output` | 输出 token，不含推理 token |
| `Reasoning` | 推理 token |
| `Cache Rate` | `Cache Read ÷ (Input + Cache Read + Cache Write)` |
| `Total` | 五类 token 之和 |
| `Context` | 当前会话最后一次已完成压缩后的最新上下文用量，不随子树累计 |
| `Cost` | 按当前会话活动模型重新估算的全树费用，不代表提供商账单 |
| `TPS` | 全树 `Output + Reasoning` 的生成速度；生成中显示 `~` 估算值，完成后显示精确值 |
| `TTFT` | 全树中可测 assistant step 的平均首 token 时间 |

补充说明：

- 用量覆盖当前会话树中的 assistant 与 compaction 消息，包括未打开的子代理；只使用服务端上报值，不按文本长度估算。
- 分叉会话是独立会话树。继承消息副本只归原始来源，避免重复计费。
- `Context` 仅搜索最后一次 `status === "completed"` 的 compaction 之后；没有可靠用量或模型上限时隐藏。
- `Cost` 使用每条消息的传入 token 选择价格档位，`Output` 与 `Reasoning` 使用输出价格。缺失适用价格时按 OpenCode 官方行为回退为 0。
- 首次读取失败显示 `Unavailable`；后续刷新失败保留上次完整快照、标注 `Not updated` 并自动重试。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`test:smoke` 会打包真实产物，并在隔离的 OpenCode 与本地模拟提供商中验证加载、刷新、子代理累计、模型切换、TPS 和 TTFT。它需要 Python 3、可用的本地端口和 npm 网络访问，不会修改现有 OpenCode 配置或调用付费模型。

从源码加载时，先构建项目，再将仓库绝对路径加入目标项目的 `plugins`。根目录入口会转发到已编译的 ESM 产物。

- [路线图](ROADMAP.md)
- [验证记录](docs/verification.md)
- [发布说明](docs/releasing.md)

## 接口依据

- [OpenCode 2 插件开发](https://opencode.ai/v2/docs/build/plugins/)
- [OpenCode 2 CLI 插件接口](https://opencode.ai/v2/docs/build/plugins/cli/)
- [CLI 设置](https://opencode.ai/v2/docs/cli/config/)
- [TokenUsage 定义](https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/token-usage.ts)
- [官方计费实现](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/usage.ts)
- [分叉历史投影](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/projector.ts)

## 许可证

[MIT](LICENSE)
