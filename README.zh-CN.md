<h1 align="center">opencode-token-usage</h1>

<p align="center">面向 OpenCode 2 的会话树 token 用量监视器。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm" src="https://img.shields.io/npm/v/%40chenlongapps%2Fopencode-token-usage?style=flat-square&logo=npm" /></a>
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@chenlongapps/opencode-token-usage" /></a>
  <a href="https://opencode.ai/" target="_blank" rel="noopener noreferrer"><img alt="OpenCode 2" src="https://img.shields.io/badge/OpenCode-2-5A67D8?style=flat-square" /></a>
  <a href="https://github.com/chenlongapps/opencode-token-usage/actions/workflows/ci.yml" target="_blank" rel="noopener noreferrer"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/opencode-token-usage/ci.yml?style=flat-square&branch=main&label=ci" /></a>
  <a href="LICENSE" target="_blank" rel="noopener noreferrer"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" /></a>
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

安装后重启 OpenCode。终端足够宽且 `session.sidebar` 设为 `auto` 时，面板会显示在原生侧边栏中。OpenCode 在子代理视图中隐藏侧边栏，因此插件会在输入区上方保留一行实时摘要，显示 Context、Total、Cost 和 TPS。点击摘要可在居中弹窗中查看完整统计；按 Escape 或点击 **esc** 即可关闭，关闭弹窗不会中断子代理。

连接远程服务器时，可将包名加入本机 `~/.config/opencode/cli.json` 的 `plugins`，仅加载终端入口；配置路径遵循 `XDG_CONFIG_HOME`。

### 详细用量

在会话中输入 `/usage`，可打开原生弹窗查看当前会话树的 token 总量，以及按消息实际模型汇总的估算费用。使用 ↑/↓、Page Up/Down、Home/End 滚动，按 `d` 切换紧凑／详细数字，Escape 关闭。该命令不会向模型发送消息。

子代理视图中的摘要格式为 `Token Usage · Context … · Total … · Cost … · TPS …`。缺失数据仍显示不可用，不会被当作零，摘要也不提示快捷键。点击后打开较小的弹窗，按侧边栏原有行序展示精确数值（包括 Steps、TPS 和 TTFT）；关闭时不会为完整面板预留高度。

弹窗分为五个区域，统计口径互相独立：

| 区域 | 内容 |
| --- | --- |
| Context Window | 已用 / 上限、占活动模型上下文上限的百分比，并带占用条 |
| Last Request | 被查看会话最近一次已上报调用的五类 token 与缓存命中率 |
| Context Breakdown | 提示词构成估算，按占比降序排列并带条形图 |
| Session | 全树汇总：steps、calls、tokens、缓存率与费用（紧凑模式为单行，详细模式逐类展开） |
| By Model | 各模型的 tokens、calls 与费用，按费用降序 |

标题下方一行注明会话与当前活动模型，正文不再重复模型名。紧凑模式使用 `K`/`M` 缩写（`812`、`139.4K`、`3.70M`），隐藏零值行，并把 Context Breakdown 中的两类工具合并为一行 `Tools`；详细模式显示精确数字、零值行及 `System Tools` / `MCP Tools` 拆分。侧边栏仍使用精确数字和原有布局。

费用沿用侧边栏的价格及 `partial`、不可定价、免费口径。当前会话尚未上报用量或上下文上限未知时，上下文相关区域显示不可用。

弹窗中的 **Context Breakdown** 将消息、系统工具、系统提示词、技能、MCP 工具及其他分开展示。它根据被查看会话**最近一次已组装的模型请求**中的文本和工具定义估算，占比的分母是六项估算值之和；这些不是提供商上报的精确 token，也不会与上方含输出、推理的实测上下文窗口相加一致。媒体内容与提供商额外包装无法准确计量。服务端插件仅保存分类数值，不保存提示词正文；未捕获到请求或服务端 RPC 不可用时显示“来源估算不可用”。

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
| `Est. Cost` | 按每条 assistant 与 compaction 消息实际模型估算的全树费用 |
| `TPS` | 全树 `Output + Reasoning` 的生成速度；生成中的估算值带 `~` 标记 |
| `TTFT` | 全树中可测 assistant step 的平均首 token 时间 |

#### 行为

- 用量覆盖会话树中服务端上报的 assistant 与 compaction 消息，包括未打开的子代理；不按文本长度估算 token。
- 分叉会话是独立会话树。继承消息副本只归原始来源，避免重复计费。
- `Context` 仅搜索最后一次 `status === "completed"` 的 compaction 之后；没有可靠用量或模型上限时隐藏。
- `Steps` 统计树中全部 assistant 消息，无论是否已上报用量；复用分叉副本去重，继承历史不会重复计数。
- `Est. Cost` 按每条消息记录的实际模型分别计算。OpenCode 当前解析出的完整非零价格优先；若 OpenCode 给出完整零价，且内置价格快照可以完整计价，则采用快照价格。价格不完整时整条消息回退，不混用两套费率。
- 内置回退快照从 [models.dev](https://models.dev/api.json) 生成，只采用审核过的原厂 Provider 与自家模型系列；少量经原厂核实的例外单独维护。快照覆盖有价格的文本模型，插件运行时不下载价格。网关模型通过精确原厂 ID、明确别名和已知包装格式匹配；只有终尾 `-free` 或 `:free` 会在再次精确查找前移除。
- 确认免费时显示 `$0.00`；价格不可用时显示 `—`；只有部分消息可计算时在已知小计后标注 `partial`。快照不含网关加价、区域溢价、未列明的折扣、非文本计费、工具费和税费；Est. Cost 是估算而非账单。覆盖范围、来源和限制见[价格来源与限制](docs/pricing.md)。
- 首次读取失败显示 `Unavailable`；后续失败保留上次完整快照、标注 `Not updated` 并自动重试。

### 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

[价格更新工作流](.github/workflows/update-prices.yml) 每天 UTC 03:17 检查 models.dev，也可通过 **Run workflow** 手动触发。快照无变化就不创建 PR；有变化且通过类型检查、测试、构建和打包检查时，只对 `src/prices.generated.ts` 创建或更新同一个待审 PR。需在仓库 Actions 设置中启用 **Allow GitHub Actions to create and approve pull requests**。使用 `GITHUB_TOKEN` 创建的 PR 不会再次触发 CI，因此更新工作流会先完成检查；不会自动合并或发布。

手动更新时，在联网的维护环境运行 `npm run prices:update`，审阅生成文件及例外差异，再执行上述检查。构建和插件刷新不会请求 models.dev。

`test:smoke` 会打包真实产物，并在隔离的 OpenCode 与本地模拟提供商中验证加载、刷新、`/usage`、子代理累计、逐消息计价、原厂价格补全、模型切换、TPS 和 TTFT。它需要 Python 3、可用的本地端口和 npm 网络访问，不会修改现有 OpenCode 配置或调用付费模型。

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
