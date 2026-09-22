<h1 align="center">opencode-token-usage</h1>

<p align="center">面向 OpenCode 2 的会话树 token 用量监视器。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage"><img alt="npm" src="https://img.shields.io/npm/v/%40chenlongapps%2Fopencode-token-usage?style=flat-square&logo=npm" /></a>
  <a href="https://opencode.ai/"><img alt="OpenCode 2" src="https://img.shields.io/badge/OpenCode-2-5A67D8?style=flat-square" /></a>
  <a href="https://github.com/chenlongapps/opencode-token-usage/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/opencode-token-usage/ci.yml?style=flat-square&branch=main&label=ci" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <strong>简体中文</strong>
</p>

[![OpenCode Token Usage 插件预览](https://raw.githubusercontent.com/chenlongapps/opencode-token-usage/main/docs/assets/opencode-token-usage-preview.webp)](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)

---

### 安装

```bash
opencode plugin add @chenlongapps/opencode-token-usage
```

也可以在项目的 `opencode.json` 或 `opencode.jsonc` 中配置：

```json
{
  "plugins": ["@chenlongapps/opencode-token-usage"]
}
```

> [!NOTE]
> 需要 Node.js 22+。项目历次发布已验证 OpenCode 2.0.9、2.0.10 和 2.0.11；当前 SDK 2.0.11 构建已在 OpenCode 2.0.11 上重新验证。

安装后重启 OpenCode。终端足够宽且 `session.sidebar` 设为 `auto` 时，面板会显示在原生侧边栏中。OpenCode 在子代理视图中隐藏侧边栏，因此插件会在输入区上方显示同一面板。

连接远程服务器时，可将包名加入本机 `~/.config/opencode/cli.json` 的 `plugins`，仅加载终端入口；配置路径遵循 `XDG_CONFIG_HOME`。

### 指标

| 指标 | 定义 |
| --- | --- |
| `Input` | 输入 token，不含缓存读取和写入 |
| `Output` | 输出 token，不含推理 token |
| `Reasoning` | 推理 token |
| `Cache Rate` | `Cache Read ÷ (Input + Cache Read + Cache Write)` |
| `Total` | 五类 token 之和 |
| `Context` | 当前会话最后一次已完成压缩后的最新上下文用量，不随子树累计 |
| `Steps` | 全树（含子代理）的 assistant 消息数，口径与 OpenCode 自带统计一致，compaction 与用户消息不计为 step |
| `Cost` | 按当前会话活动模型重新估算的全树费用，不代表提供商账单 |
| `TPS` | 全树 `Output + Reasoning` 的生成速度；生成中的估算值带 `~` 标记 |
| `TTFT` | 全树中可测 assistant step 的平均首 token 时间 |

#### 行为

- 用量覆盖会话树中服务端上报的 assistant 与 compaction 消息，包括未打开的子代理；不按文本长度估算 token。
- 分叉会话是独立会话树。继承消息副本只归原始来源，避免重复计费。
- `Context` 仅搜索最后一次 `status === "completed"` 的 compaction 之后；没有可靠用量或模型上限时隐藏。
- `Steps` 统计树中全部 assistant 消息，无论是否已上报用量；复用分叉副本去重，继承历史不会重复计数。
- `Cost` 使用当前查看会话的活动模型重算整棵树；缺失适用价格时按 OpenCode 行为回退为 0。
- 首次读取失败显示 `Unavailable`；后续失败保留上次完整快照、标注 `Not updated` 并自动重试。

### 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`test:smoke` 会打包真实产物，并在隔离的 OpenCode 与本地模拟提供商中验证加载、刷新、子代理累计、模型切换、TPS 和 TTFT。它需要 Python 3、可用的本地端口和 npm 网络访问，不会修改现有 OpenCode 配置或调用付费模型。

从源码加载时，先构建项目，再将仓库绝对路径加入目标项目的 `plugins`。

### 文档

- [路线图](ROADMAP.md)
- [验证记录](docs/verification.md)
- [发布说明](docs/releasing.md)
- [OpenCode 2 插件开发文档](https://opencode.ai/v2/docs/build/plugins/)
- [OpenCode 2 CLI 插件接口](https://opencode.ai/v2/docs/build/plugins/cli/)

实现遵循 OpenCode 的 [TokenUsage 定义](https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/token-usage.ts)、[官方计费实现](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/usage.ts)和[分叉历史投影](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/projector.ts)。

### 声明

这是一个独立的社区插件，并非由 OpenCode 团队构建、维护或认可。

### 许可证

[MIT](LICENSE)
