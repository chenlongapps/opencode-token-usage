<h1 align="center">opencode-token-usage</h1>

<p align="center">A session-tree token usage monitor for OpenCode 2.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm" src="https://img.shields.io/npm/v/%40chenlongapps%2Fopencode-token-usage?style=flat-square&logo=npm" /></a>
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@chenlongapps/opencode-token-usage" /></a>
  <a href="https://opencode.ai/" target="_blank" rel="noopener noreferrer"><img alt="OpenCode 2" src="https://img.shields.io/badge/OpenCode-2-5A67D8?style=flat-square" /></a>
  <a href="https://github.com/chenlongapps/opencode-token-usage/actions/workflows/ci.yml" target="_blank" rel="noopener noreferrer"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/opencode-token-usage/ci.yml?style=flat-square&branch=main&label=ci" /></a>
  <a href="LICENSE" target="_blank" rel="noopener noreferrer"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" /></a>
</p>

<p align="center">
  <strong>English</strong> |
  <a href="https://github.com/chenlongapps/opencode-token-usage/blob/main/README.zh-CN.md">简体中文</a>
</p>

[![OpenCode Token Usage plugin preview](https://raw.githubusercontent.com/chenlongapps/opencode-token-usage/main/docs/assets/opencode-token-usage-preview.webp)](https://www.npmjs.com/package/@chenlongapps/opencode-token-usage)

---

### Installation

```bash
opencode plugin add @chenlongapps/opencode-token-usage
```

Alternatively, add the package to your project's `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["@chenlongapps/opencode-token-usage"]
}
```

> [!NOTE]
> Requires Node.js 22+. OpenCode 2.0.9, 2.0.10, and 2.0.11 have been verified across project releases. The current SDK 2.0.11 build has been reverified on OpenCode 2.0.11.

Restart OpenCode after installation. The panel appears in the native sidebar when `session.sidebar` is set to `auto` and the terminal is wide enough. OpenCode hides the sidebar in subagent views, so the plugin keeps one live summary line above the composer with Context, Total, Cost, and TPS. Click the line to open the full statistics in a centered dialog. Press Escape or click **esc** to close it; closing the dialog does not interrupt the subagent.

For remote sessions, add the package name to `plugins` in your local `~/.config/opencode/cli.json` to load only the terminal entry point. The configuration path follows `XDG_CONFIG_HOME`.

### Detailed usage

Enter `/usage` in a session to open a native dialog with the session tree's token totals and estimated cost by recorded model. Scroll with ↑/↓, Page Up/Down, Home/End, press `d` to switch between compact and detailed numbers, and close with Escape. The command does not send a prompt to the model.

The subagent picker keeps the summary in the form `Token Usage · Context … · Total … · Cost … · TPS …`. Missing values remain unavailable rather than becoming zero, and the line does not advertise a keyboard shortcut. Clicking it opens a smaller dialog with the sidebar's exact rows (including Steps, TPS and TTFT) without reserving space for the full panel while closed.

The dialog is split into five sections with separate statistics:

| Section | Contents |
| --- | --- |
| Context Window | Used / limit and a percentage of the active model's context limit, with a usage bar |
| Last Request | The five token categories and cache rate of the viewed session's most recent reported call |
| Context Breakdown | Estimated prompt composition, largest first, with bars |
| Session | Tree totals: steps, calls, tokens, cache rate, cost (single line, or per-category rows in detailed mode) |
| By Model | Tokens, calls and cost per recorded model, highest cost first |

One line under the title names the session and its active model, and the body never repeats the model name. Compact mode uses `K`/`M` abbreviations (`812`, `139.4K`, `3.70M`), hides empty rows and merges the two tool families in Context Breakdown into a single `Tools` row. Detailed mode shows exact numbers, empty rows, and the `System Tools` / `MCP Tools` split. The sidebar keeps exact numbers and its own layout.

Costs follow the sidebar's pricing and `partial`/unavailable/free conventions. Context sections are unavailable until the viewed session has reported usage and a known context limit.

**Context Breakdown** separates Messages, System Tools, System Prompt, Skills, MCP Tools, and Other. It estimates the text and tool definitions in the viewed session's **latest assembled model request**; its percentages use the sum of those estimates. These are not provider-reported token counts and do not add up to the measured context window, which also includes output and reasoning. Media and provider-specific framing cannot be measured from the request. A server plugin records only aggregate estimates (not prompt text); sessions without a captured request or an available server RPC show “Source estimates unavailable”.

### Metrics

| Metric | Definition |
| --- | --- |
| `Input` | Input tokens, excluding cache reads and writes |
| `Output` | Output tokens, excluding reasoning tokens |
| `Reasoning` | Reasoning tokens |
| `Cache Rate` | `Cache Read ÷ (Input + Cache Read + Cache Write)` |
| `Total` | Sum of all five token categories |
| `Context` | Latest context usage after the most recent completed compaction in the viewed session; not aggregated across the subtree |
| `Steps` | Assistant message count across the session tree, including subagents; follows OpenCode's own stats definition, so compaction and user messages are not steps |
| `Est. Cost` | Estimated cost across the tree, pricing each assistant and compaction call with its actual model |
| `TPS` | Generation throughput for `Output + Reasoning` across the tree; live estimates are marked with `~` |
| `TTFT` | Average time to first token across measurable assistant steps in the tree |

#### Behavior

- Usage includes server-reported assistant and compaction messages throughout the session tree, including unopened subagents. Token counts are never inferred from text length.
- A fork is a separate session tree. Inherited message copies are attributed only to their original source to prevent double counting.
- `Context` only searches messages after the most recent compaction with `status === "completed"` and is hidden when reliable usage or a model context limit is unavailable.
- `Steps` counts every assistant message in the tree, whether or not it reported usage, and reuses the fork-copy de-duplication so inherited history is never counted twice.
- `Est. Cost` prices every message with its recorded model. A complete non-zero price resolved by OpenCode takes precedence. If OpenCode reports a complete zero price, a complete first-party snapshot price overrides it; incomplete prices fall back for the whole message without mixing rates.
- The checked-in fallback snapshot is generated from [models.dev](https://models.dev/api.json) using only reviewed first-party provider/model families; a small set of manufacturer-verified exceptions is kept separately. It covers priced text models, without downloading prices while the plugin runs. Gateway models match exact manufacturer IDs, documented aliases, and known wrappers; only a terminal `-free` or `:free` can be removed for a second exact lookup.
- Confirmed free usage displays `$0.00`; unavailable prices display `—`; known subtotals with unpriced messages are marked `partial`. The snapshot excludes gateway markups, regional premiums, unlisted discounts, non-text billing, tool fees, and taxes, so Est. Cost is not a provider bill. See [price sources and limitations](docs/pricing.md).
- Initial read failures display `Unavailable`. Later failures retain the last complete snapshot, display `Not updated`, and retry automatically.

### Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The [price update workflow](.github/workflows/update-prices.yml) checks models.dev every day at 03:17 UTC (or on demand via **Run workflow**). No snapshot diff means no pull request; a diff that passes typecheck, tests, build, and pack validation opens or updates one review-only PR containing `src/prices.generated.ts`. Enable **Allow GitHub Actions to create and approve pull requests** under repository Actions settings. PRs created with `GITHUB_TOKEN` do not trigger a second CI run, so the update workflow runs the checks before opening the PR. Nothing is merged or published automatically.

For a manual refresh, run `npm run prices:update` in a networked environment, review the generated diff and exceptions, then run the checks above. Builds and plugin refreshes do not contact models.dev.

`test:smoke` packages the real artifact and validates loading, refreshes, `/usage`, subagent aggregation, per-message pricing, first-party price fallback, model switching, TPS, and TTFT against an isolated OpenCode instance and a local mock provider. It requires Python 3, an available local port, and npm network access. It never modifies your existing OpenCode configuration or calls paid models.

To load the plugin from source, build the project and add the repository's absolute path to `plugins` in the target project.

### Documentation

- [Roadmap](ROADMAP.md)
- [Verification record](docs/verification.md)
- [Release guide](docs/releasing.md)
- [OpenCode 2 plugin documentation](https://opencode.ai/v2/docs/build/plugins/)
- [OpenCode 2 CLI plugin API](https://opencode.ai/v2/docs/build/plugins/cli/)

The implementation follows OpenCode's [TokenUsage schema](https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/token-usage.ts), [cost calculation](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/usage.ts), and [fork history projection](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/projector.ts).

### Disclaimer

This is an independent community plugin. It is not built, maintained, or endorsed by the OpenCode team.

### License

[MIT](LICENSE)
