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
> Requires Node.js 22+ (see the OpenTUI engine note under [Development](#development)). OpenCode 2.0.9 and 2.0.10 have been verified in earlier releases. SDK 2.0.24 integration checks have passed on OpenCode 2.0.11, 2.0.22, 2.0.24, and 2.0.26. Native turn durations and sidebar title clicks were integration-tested on 2.0.26; the other listed host checks predate these additions.

Restart OpenCode after installation. The panel appears in the native sidebar when `session.sidebar` is set to `auto` and the terminal is wide enough. Click its **Token Usage** title to open the detailed usage dialog. OpenCode hides the sidebar in subagent views, so the plugin keeps one live summary line above the composer with Context, Total, Cost, Time, and TPS. Click the line to open the full statistics in a centered dialog. Press Escape or click **esc** to close it; closing the dialog does not interrupt the subagent.

For remote sessions, add the package name to `plugins` in your local `~/.config/opencode/cli.json` to load only the terminal entry point. The configuration path follows `XDG_CONFIG_HOME`.

### Detailed usage

Enter `/usage` in a session or left-click the sidebar's **Token Usage** title to open the same centered native dialog with the session tree's token totals and estimated cost by recorded model. It opens in compact mode. Scroll with ↑/↓, Page Up/Down, Home/End, press `d` to switch between compact and detailed numbers and reveal model rates, and close with Escape or **esc**. Neither entry sends a prompt to the model. Other sidebar rows remain selectable; dragging to select text does not open the dialog.

The subagent picker keeps the summary in the form `Token Usage · Context … · Total … · Cost … · Time … · TPS …`. Time sums the viewed subagent's own native per-turn response durations; token totals and cost still cover the whole tree. Narrow terminals omit lower-priority fields, keeping Time visible when present without adding a second line. Missing values remain unavailable rather than becoming zero, and the line does not advertise a keyboard shortcut. Clicking it opens a smaller dialog with the sidebar's exact rows (including Steps, TPS, TTFT and Run Time) without reserving space for the full panel while closed. When shown, Run Time is the last row in both the sidebar and this dialog.

The dialog is split into five sections with separate statistics:

| Section | Contents |
| --- | --- |
| Context Window | Used / limit and a percentage of the active model's context limit, with a usage bar |
| Last Request | The five token categories and cache rate of the viewed session's most recent reported call |
| Context Breakdown | Estimated prompt composition, largest first, with bars |
| Session | Tree totals: steps, calls, tokens, cache rate, cost (single line, or per-category rows in detailed mode); a separate `Run Time (this session)` row sums only the viewed session's native per-turn response durations |
| By Model | Tokens, calls and cost per recorded model, highest cost first; detailed mode shows the rates used for each model's cost estimate |

One line under the title names the session and its active model, and the body never repeats the model name. Compact mode uses `K`/`M` abbreviations (`812`, `139.4K`, `3.70M`), hides empty rows and merges the two tool families in Context Breakdown into a single `Tools` row. Detailed mode shows exact numbers, empty rows, and the `System Tools` / `MCP Tools` split. The sidebar keeps exact numbers and its own layout.

Costs follow the sidebar's pricing and `partial`/unavailable/free conventions. In detailed mode, By Model shows the applied Input, Output, Reasoning, Cache Read and Cache Write rates in USD per million text tokens. Each rate group names its source (OpenCode or the built-in snapshot), incoming-token tier and call count; a model can have multiple groups. `Incoming` means Input + Cache Read + Cache Write. Missing rates show `—`, confirmed free rates show `$0.00`, and unpriced calls are counted separately. These are the current rates used to estimate recorded calls, not historical provider bills.

**Context Window** requires reported usage and a valid active-model context limit. **Last Request** shows the selected assistant call's reported tokens even when that limit is unknown or source estimates are unavailable. Its timestamp comes from that same message: stream end, completion, then creation time, using the first valid value and hiding the timestamp if none is available. Request selection follows the viewed session's revert cutoff and most recent completed compaction boundary.

**Context Breakdown** separates Messages, System Tools, System Prompt, Skills, MCP Tools, and Other. It estimates the text and tool definitions in the viewed session's **latest assembled model request**; its percentages use the sum of those estimates. Its timestamp is the estimate's own capture time, which may refer to a different request than Last Request. These are not provider-reported token counts and do not add up to the measured context window, which also includes output and reasoning. Media and provider-specific framing cannot be measured from the request. A server plugin records only aggregate estimates (not prompt text); sessions without a captured request or an available server RPC show “Source estimates unavailable”.

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
| `Run Time` | The viewed session's cumulative native per-turn response duration; while running, includes a display-only estimate of the current turn's elapsed time marked with `~`; never adds child-session durations |
| `TPS` | Generation throughput for `Output + Reasoning` across the tree. While streaming, it estimates recent observable text, reasoning-summary and tool-input deltas (UTF-8 bytes / 4) over a short sliding window after the first delta, excluding pre-first-token waiting, and marks the value with `~`. APIs such as OpenAI Responses do not expose complete hidden reasoning tokens in real time, so live values cannot represent hidden reasoning throughput. After completion it uses provider-reported Output and Reasoning tokens and removes `~` |
| `TTFT` | Average time to first token across measurable assistant steps in the tree |

#### Behavior

- Usage includes server-reported assistant and compaction messages throughout the session tree, including unopened subagents. Token counts are never inferred from text length.
- A fork is a separate session tree. Inherited message copies are attributed only to their original source to prevent double counting.
- `Context` only searches messages after the most recent compaction with `status === "completed"` and is hidden when reliable usage or a model context limit is unavailable.
- `Steps` counts every assistant message in the tree, whether or not it reported usage, and reuses the fork-copy de-duplication so inherited history is never counted twice.
- `Run Time` follows OpenCode 2.0.26's native response footer: assistant completion time minus the first user/synthetic input's creation time after the previous idle marker. Older histories without idle markers use the nearest input; without any input, it uses the assistant's creation time. Each turn contributes only its final completed response duration, not the overlapping duration of every assistant step. Model calls, tools, retries and foreground waits within that span are included; idle time between turns is not. Waiting for a subagent is already part of the parent's span and is never added separately.
- While the viewed session is running, `Run Time` estimates **elapsed time so far**, not final or remaining time, and prefixes the cumulative display with `~` (for example, `~42.5s`). A shared 500 ms clock replaces the current turn's already-counted duration rather than adding an overlapping steer/retry duration. Clock ticks only update memory: history reads remain event-driven. One optional read-only server-plugin clock RPC at startup/reconnection supplies a server-time anchor, with timestamped live events as a fallback; local monotonic time advances it without assuming that a remote server shares the client's clock. Opening an already-running session restores the turn's start from history. Without a trusted anchor or valid timing, native totals remain unchanged.
- Completion, failure or interruption stops projection; reported native completion timing replaces the estimate and removes `~`, so a small downward correction is possible. Only native completed durations enter the historical subtotal. Totals use unrounded milliseconds before formatting (milliseconds below one second, one decimal below one minute, then minutes/hours), so they need not equal the sum of rounded footer labels. The existing message-history read restores totals after restarts, including sessions predating installation; no experimental execution-log API or server plugin is required. Missing historical timing data displays `—`, not zero. Read failures freeze the last displayed value and mark it `Not updated` (`stale` in the short summary).
- While the viewed session's native status is running, visible `Run Time` / `Time` values append `Running.` → `Running..` → `Running...`, cycling every 500 ms in a fixed-width dot area. Activity never marks an idle parent as running just because a child is active. The indicator disappears on completion/interruption; closing or switching views cleans up their clocks, and the shared elapsed-time ticker stops when no view needs it. Unavailable/stale timing keeps its own marker.
- A confirmed zero `Run Time` / `Time` is hidden in the sidebar, subagent summary/dialog and both `/usage` modes, without leaving an empty row or field. A nonzero live estimate makes the first turn visible even before any response has completed. Nonzero millisecond durations, unavailable values and stale timing remain visible.
- Runtime follows retained history: agent/model switches and compaction preserve past turns; fork copies never contribute to the fork's own time. A staged revert does not remove turns, but a committed revert deleting messages also removes their durations. Deleted historical timing cannot be reconstructed.
- `Est. Cost` prices every message with its recorded model. A complete non-zero price resolved by OpenCode takes precedence. If OpenCode reports a complete zero price, a complete first-party snapshot price overrides it; incomplete prices fall back for the whole message without mixing rates.
- The checked-in fallback snapshot is generated from [models.dev](https://models.dev/api.json) using only reviewed first-party provider/model families; a small set of manufacturer-verified exceptions is kept separately. It covers priced text models, without downloading prices while the plugin runs. Gateway models match exact manufacturer IDs, documented aliases, and known wrappers; only a terminal `-free` or `:free` can be removed for a second exact lookup.
- Confirmed free usage displays `$0.00`; positive estimates below `$0.001` display `<$0.001`, estimates through and including `$0.01` use three decimal places, and larger estimates use two. Unavailable prices display `—`; known subtotals with unpriced messages are marked `partial`. The snapshot excludes gateway markups, regional premiums, unlisted discounts, non-text billing, tool fees, and taxes, so Est. Cost is not a provider bill. See [price sources and limitations](docs/pricing.md).
- Live `TPS` with `~` is an estimate from recent observable deltas after the first delta over a ~2s sliding window with light smoothing; it excludes TTFT and hidden-reasoning waits. Without `~` it is exact provider-reported `Output + Reasoning` throughput. No model-specific multipliers or hidden-reasoning guesses are applied.
- Initial read failures display `Unavailable`. Later failures retain the last complete snapshot, display `Not updated`, and retry automatically.

### Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The OpenCode SDK packages are pinned to `2.0.24`, with OpenTUI `0.5.14`. Clean installation, typecheck, tests, build, and real-host smoke have passed on Node.js 22. OpenTUI declares Node.js `>=26.4.0` for its native Node runtime, so npm reports `EBADENGINE` on Node 22; `engine-strict` installations require a Node version meeting that dependency's engine requirement. The plugin's TUI runs inside OpenCode, not as a standalone Node 22 renderer. This upgrade keeps the project's Node.js 22+ minimum unchanged.

The [price update workflow](.github/workflows/update-prices.yml) checks models.dev every day at 22:00 UTC (or on demand via **Run workflow** on `main`). No snapshot diff means no release. Changes within the reviewed first-party source allowlist pass typecheck, tests, build, and pack validation, then automatically bump the patch version (for example, `0.4.4` → `0.4.5`), commit only `src/prices.generated.ts`, `package.json`, and `package-lock.json`, and atomically push `main` and its version tag. The workflow creates a GitHub Release and explicitly dispatches [`publish.yml`](.github/workflows/publish.yml) on that tag to publish via npm Trusted Publishing/OIDC; no long-lived npm token is needed. GitHub Actions must be allowed to push to `main` and create tags, and npm must trust `publish.yml` with permission to run `npm publish`.

Failed validation never bumps the version. An unfinished tagged price release is retried with the same version before checking new prices; registry outages are not treated as missing versions. Publishing skips versions already on npm, prevents moving `latest` backwards, and polls registry visibility for up to 10 minutes after publication, logging progress. A verification timeout is not proof that `npm publish` failed: check the registry and retry the same tag without bumping the version; already-published versions are not republished. Manufacturer/source allowlist additions, aliases, and manually verified price exceptions still require human review. See the [release guide](docs/releasing.md) for setup, verification timing, and retries.

For a manual refresh, run `npm run prices:update` in a networked environment, review the generated diff and exceptions, then run the checks above. Builds and plugin refreshes do not contact models.dev.

`test:smoke` packages the real artifact and validates loading, refreshes, `/usage`, sidebar title clicks, subagent aggregation, per-message pricing, first-party price fallback, model switching, TPS, TTFT, and session-local native turn durations (unfinished responses, idle gaps, interruption, message-history restoration, forks and narrow child views) against an isolated OpenCode instance and a local mock provider. It requires Python 3, an available local port, and npm network access. It never modifies your existing OpenCode configuration or calls paid models.

By default, smoke uses `opencode` from `PATH`. Stable OpenCode 2 versions from 2.0.9 onward can run; a host not yet verified with the current SDK prints a warning and continues through the actual compatibility checks. Passing the version check alone does not establish compatibility. The SDK dependencies remain pinned independently of your local CLI updates.

To reproduce a baseline with a separately installed binary, without downgrading your normal installation:

```bash
OPENCODE_BIN=/absolute/path/to/opencode-2.0.11 npm run test:smoke
```

`OPENCODE_BIN` selects the same executable for the version check, isolated server, and TUI. Relative paths resolve from the directory where you run the command. The host version and selected binary are recorded in the smoke output and `result.json`; see the [verification record](docs/verification.md) for tested combinations.

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
