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
> 需要 Node.js 22+（见[开发](#开发)中的 OpenTUI 引擎说明）。此前发布已验证 OpenCode 2.0.9 和 2.0.10；当前 SDK 2.0.24 构建已在 OpenCode 2.0.11、2.0.22 和 2.0.24 上验证。

安装后重启 OpenCode。终端足够宽且 `session.sidebar` 设为 `auto` 时，面板会显示在原生侧边栏中。OpenCode 在子代理视图中隐藏侧边栏，因此插件会在输入区上方保留一行实时摘要，显示 Context、Total、Cost 和 TPS。点击摘要可在居中弹窗中查看完整统计；按 Escape 或点击 **esc** 即可关闭，关闭弹窗不会中断子代理。

连接远程服务器时，可将包名加入本机 `~/.config/opencode/cli.json` 的 `plugins`，仅加载终端入口；配置路径遵循 `XDG_CONFIG_HOME`。

### 详细用量

在会话中输入 `/usage`，可打开原生弹窗查看当前会话树的 token 总量，以及按消息实际模型汇总的估算费用。使用 ↑/↓、Page Up/Down、Home/End 滚动，按 `d` 切换紧凑／详细数字并查看模型费率，Escape 关闭。该命令不会向模型发送消息。

子代理视图中的摘要格式为 `Token Usage · Context … · Total … · Cost … · TPS …`。缺失数据仍显示不可用，不会被当作零，摘要也不提示快捷键。点击后打开较小的弹窗，按侧边栏原有行序展示精确数值（包括 Steps、TPS 和 TTFT）；关闭时不会为完整面板预留高度。

弹窗分为五个区域，统计口径互相独立：

| 区域 | 内容 |
| --- | --- |
| Context Window | 已用 / 上限、占活动模型上下文上限的百分比，并带占用条 |
| Last Request | 被查看会话最近一次已上报调用的五类 token 与缓存命中率 |
| Context Breakdown | 提示词构成估算，按占比降序排列并带条形图 |
| Session | 全树汇总：steps、calls、tokens、缓存率与费用（紧凑模式为单行，详细模式逐类展开） |
| By Model | 各模型的 tokens、calls 与费用，按费用降序；详细模式显示用于估算各模型费用的费率 |

标题下方一行注明会话与当前活动模型，正文不再重复模型名。紧凑模式使用 `K`/`M` 缩写（`812`、`139.4K`、`3.70M`），隐藏零值行，并把 Context Breakdown 中的两类工具合并为一行 `Tools`；详细模式显示精确数字、零值行及 `System Tools` / `MCP Tools` 拆分。侧边栏仍使用精确数字和原有布局。

费用沿用侧边栏的价格及 `partial`、不可定价、免费口径。详细模式下，By Model 显示 Input、Output、Reasoning、Cache Read、Cache Write 的美元／百万文本 token 费率。每组费率注明来源（OpenCode 或内置快照）、传入 token 档位和调用数；同一模型可能有多组。传入 token 为 Input + Cache Read + Cache Write。缺失费率显示 `—`，确认免费显示 `$0.00`，无法定价的调用单独计数。这些是当前用于估算已记录调用的费率，不是历史提供商账单。当前会话尚未上报用量或上下文上限未知时，上下文相关区域显示不可用。

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
| `TPS` | 全树 `Output + Reasoning` 的生成吞吐。请求进行中时，插件根据首个流式增量之后最近的可观察文本、reasoning summary 和工具输入流（UTF-8 字节数 / 4）按短时间滑动窗口估算输出速度，不包含首 token 前等待时间，并以 `~` 标记。OpenAI Responses 等 API 不会实时暴露完整的隐藏 reasoning token，因此实时值不能表示隐藏推理吞吐。请求完成后，插件使用服务端上报的 Output 与 Reasoning token 及时间信息计算精确 TPS，并移除 `~` 标记 |
| `TTFT` | 全树中可测 assistant step 的平均首 token 时间 |

#### 行为

- 用量覆盖会话树中服务端上报的 assistant 与 compaction 消息，包括未打开的子代理；不按文本长度估算 token。
- 分叉会话是独立会话树。继承消息副本只归原始来源，避免重复计费。
- `Context` 仅搜索最后一次 `status === "completed"` 的 compaction 之后；没有可靠用量或模型上限时隐藏。
- `Steps` 统计树中全部 assistant 消息，无论是否已上报用量；复用分叉副本去重，继承历史不会重复计数。
- `Est. Cost` 按每条消息记录的实际模型分别计算。OpenCode 当前解析出的完整非零价格优先；若 OpenCode 给出完整零价，且内置价格快照可以完整计价，则采用快照价格。价格不完整时整条消息回退，不混用两套费率。
- 内置回退快照从 [models.dev](https://models.dev/api.json) 生成，只采用审核过的原厂 Provider 与自家模型系列；少量经原厂核实的例外单独维护。快照覆盖有价格的文本模型，插件运行时不下载价格。网关模型通过精确原厂 ID、明确别名和已知包装格式匹配；只有终尾 `-free` 或 `:free` 会在再次精确查找前移除。
- 确认免费时显示 `$0.00`；价格不可用时显示 `—`；只有部分消息可计算时在已知小计后标注 `partial`。快照不含网关加价、区域溢价、未列明的折扣、非文本计费、工具费和税费；Est. Cost 是估算而非账单。覆盖范围、来源和限制见[价格来源与限制](docs/pricing.md)。
- 带 `~` 的实时 `TPS` 是首个流式增量之后约 2 秒滑动窗口内可观察增量的估算值（带轻度平滑），不包含 TTFT 与隐藏推理等待；不带 `~` 时为服务端上报的 `Output + Reasoning` 精确吞吐。不做模型专属倍率，也不猜测隐藏 reasoning token。
- 首次读取失败显示 `Unavailable`；后续失败保留上次完整快照、标注 `Not updated` 并自动重试。

### 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

OpenCode SDK 包精确锁定为 `2.0.24`，OpenTUI 为 `0.5.14`。Node.js 22 下已通过干净安装、类型检查、测试、构建和真实宿主 smoke。OpenTUI 为其原生 Node 运行时声明 Node.js `>=26.4.0`，因此 Node 22 安装时 npm 会输出 `EBADENGINE`；启用 `engine-strict` 时须使用满足该依赖引擎要求的 Node 版本。插件的 TUI 在 OpenCode 内运行，并非独立的 Node 22 渲染器。本次升级保持项目 Node.js 22+ 的最低要求不变。

[价格更新工作流](.github/workflows/update-prices.yml) 每天 UTC 22:00 检查 models.dev，也可在 `main` 上通过 **Run workflow** 手动触发。快照无变化就不发布。经审核的原厂来源白名单内有变化时，先通过类型检查、测试、构建和打包检查，再自动升级 patch 版本（例如 `0.4.4` → `0.4.5`），只提交 `src/prices.generated.ts`、`package.json` 和 `package-lock.json`，并原子推送 `main` 与版本标签。工作流创建 GitHub Release，显式触发该标签上的 [`publish.yml`](.github/workflows/publish.yml)，通过 npm Trusted Publishing/OIDC 发布，无需长期 npm token。仓库必须允许 GitHub Actions 推送 `main` 和创建标签；npm 必须信任 `publish.yml` 并允许执行 `npm publish`。

验证失败不会升版本。已打标签但未完成的自动价格发布会优先重试同一版本，再检查新价格；registry 故障不会被当作版本不存在。发布时跳过 npm 已有版本、防止 `latest` 倒退，并在发布后核验 registry 中的版本。新增原厂／来源白名单、别名及人工核实的价格例外仍需人工审核。配置和重试方法见[发布说明](docs/releasing.md)。

手动更新时，在联网的维护环境运行 `npm run prices:update`，审阅生成文件及例外差异，再执行上述检查。构建和插件刷新不会请求 models.dev。

`test:smoke` 会打包真实产物，并在隔离的 OpenCode 与本地模拟提供商中验证加载、刷新、`/usage`、子代理累计、逐消息计价、原厂价格补全、模型切换、TPS 和 TTFT。它需要 Python 3、可用的本地端口和 npm 网络访问，不会修改现有 OpenCode 配置或调用付费模型。

默认使用 `PATH` 中的 `opencode`。OpenCode 2.0.9 及之后的稳定版 2.x 可以运行；尚未与当前 SDK 验证的宿主会输出警告，然后继续实际兼容性检查。仅通过版本检查不代表兼容性已验证。SDK 依赖仍独立锁定，不随本机 CLI 更新而自动升级。

如需用独立安装的二进制复现基准，而不降级日常使用的安装：

```bash
OPENCODE_BIN=/absolute/path/to/opencode-2.0.11 npm run test:smoke
```

`OPENCODE_BIN` 为版本检查、隔离服务端和 TUI 统一选择同一个可执行文件。相对路径以执行命令时的目录为基准解析。smoke 输出和 `result.json` 会记录宿主版本与所选二进制；已测试组合见[验证记录](docs/verification.md)。

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
