<h1 align="center">opencode-token-usage</h1>

<p align="center">A session-tree token usage monitor for OpenCode 2.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm" src="https://img.shields.io/npm/v/%40chenlongapps%2Fopencode-token-usage?style=flat-square&logo=npm" /></a>
  <a href="https://www.npmjs.com/package/@chenlongapps/opencode-token-usage" target="_blank" rel="noopener noreferrer"><img alt="npm downloads" src="https://img.shields.io/npm/dy/@chenlongapps/opencode-token-usage" /></a>
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

Restart OpenCode after installation. The panel appears in the native sidebar when `session.sidebar` is set to `auto` and the terminal is wide enough. OpenCode hides the sidebar in subagent views, so the plugin renders the same panel above the composer instead.

For remote sessions, add the package name to `plugins` in your local `~/.config/opencode/cli.json` to load only the terminal entry point. The configuration path follows `XDG_CONFIG_HOME`.

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
| `Cost` | Estimated cost across the tree, pricing each assistant and compaction call with its actual model |
| `TPS` | Generation throughput for `Output + Reasoning` across the tree; live estimates are marked with `~` |
| `TTFT` | Average time to first token across measurable assistant steps in the tree |

#### Behavior

- Usage includes server-reported assistant and compaction messages throughout the session tree, including unopened subagents. Token counts are never inferred from text length.
- A fork is a separate session tree. Inherited message copies are attributed only to their original source to prevent double counting.
- `Context` only searches messages after the most recent compaction with `status === "completed"` and is hidden when reliable usage or a model context limit is unavailable.
- `Steps` counts every assistant message in the tree, whether or not it reported usage, and reuses the fork-copy de-duplication so inherited history is never counted twice.
- `Cost` prices every message with its recorded model. A complete non-zero price resolved by OpenCode takes precedence. If OpenCode reports a complete zero price, a complete official snapshot price overrides it; incomplete prices fall back for the whole message without mixing rates.
- Gateway models can use fallback prices through exact model IDs, documented aliases, and known wrappers. A terminal `-free` or `:free` is removed only for an exact base ID lookup; other suffixes are not stripped. The fallback excludes gateway markups, regional premiums, unlisted discounts, tool fees, and taxes, so Cost is an estimate rather than a provider bill.
- Confirmed free usage displays `$0.00`; unavailable prices display `—`; known subtotals with unpriced messages are marked `partial`. See the [built-in price snapshot](docs/pricing.md) for coverage, sources, and limitations.
- Initial read failures display `Unavailable`. Later failures retain the last complete snapshot, display `Not updated`, and retry automatically.

### Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`test:smoke` packages the real artifact and validates loading, refreshes, subagent aggregation, per-message pricing, official-price fallback, model switching, TPS, and TTFT against an isolated OpenCode instance and a local mock provider. It requires Python 3, an available local port, and npm network access. It never modifies your existing OpenCode configuration or calls paid models.

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
