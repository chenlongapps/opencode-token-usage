# Frequently asked questions

**English** | [简体中文](faq.zh-CN.md)

Short answers about the **opencode-token-usage** community plugin for OpenCode 2. See the [README](../README.md) for the full guide.

## How to track token usage in OpenCode?

Install `@chenlongapps/opencode-token-usage` with `opencode plugin add @chenlongapps/opencode-token-usage`, then restart OpenCode 2. View the **Token Usage** sidebar panel or enter `/usage` to see reported input, output, reasoning and cache tokens. Session totals include descendant subagents; they are not inferred from text length. The plugin requires Node.js 22+, with an OpenTUI engine caveat described in the [README's compatibility section](../README.md#compatibility). See [installation and quick start](../README.md#installation).

## How to see estimated API costs in OpenCode?

With **opencode-token-usage** installed, check **Est. Cost** in the sidebar or open `/usage` and review **By Model**. The plugin estimates each recorded assistant and compaction call using its actual model, with OpenCode-resolved prices and a built-in first-party price snapshot as a fallback. Missing prices display `—`; a known subtotal with unpriced calls is marked `partial`. Estimates exclude items such as gateway markups, tool fees and taxes, and are not provider bills. See the [README's pricing behavior](../README.md#behavior).

## How to monitor TPS and TTFT in OpenCode?

The **Token Usage** panel shows tokens per second (**TPS**) and average time to first token (**TTFT**) when measurable data is available. TPS without `~` uses reported output plus reasoning tokens and recorded timing across valid assistant samples in the session tree. During streaming, a recent observable-delivery estimate marked with `~` takes precedence once enough data is available; otherwise it falls back to historical TPS or hides the row if unavailable. Live and historical TPS use different timing definitions. See the [README's metrics and limits](../README.md#metrics).

## How to track subagent token usage?

**opencode-token-usage** automatically includes descendant subagents in the viewed session's token and estimated-cost totals, even if those subagents have never been opened. Open a subagent view and click the summary above the composer to inspect that subagent's own subtree in the full panel. Inherited fork history is not counted again as new usage. Context usage and Run Time remain specific to the viewed session rather than adding child-session values. See the [README's detailed usage guide](../README.md#detailed-usage).

## Can OpenCode display hidden reasoning token speed?

This plugin cannot reconstruct the real-time speed of hidden reasoning that a provider does not expose. Live TPS estimates observable text, reasoning summaries and tool-input delivery, not internal model generation; summaries and buffered bursts cannot reveal complete hidden reasoning. Historical TPS can include provider-reported reasoning token totals alongside output tokens, but it is a combined average, not a separate hidden-reasoning speed measurement. See the [README's performance limitations](../README.md#behavior).

## Does the plugin send prompts to external servers?

No—the plugin does not send prompts to model providers or third-party analytics services, and opening `/usage` does not issue a model request. It reads session data from your configured OpenCode server, which may be local or remote. Its server-side context hook inspects the already assembled request to estimate prompt composition, storing only aggregate category estimates and timestamp/model metadata, not prompt text. OpenCode itself still sends normal model requests to your configured provider. The plugin does not download prices at runtime. See the [README's context breakdown details](../README.md#detailed-usage) and [runtime behavior](../README.md#behavior).

## Why is the Token Usage panel missing after installation?

Restart OpenCode after installing the plugin, then open a session. The sidebar panel requires a sufficiently wide terminal and `session.sidebar` set to `auto`; you can also enter `/usage` to open details without the sidebar. OpenCode hides the sidebar in subagent views, where the plugin instead shows a clickable summary above the composer. For remote sessions, configure the local terminal entry point as described in the [README's installation options](../README.md#other-installation-options). See [quick start](../README.md#quick-start).

## Does the plugin support OpenCode 1?

No. **opencode-token-usage** targets OpenCode 2 and uses its plugin and terminal UI APIs; it is not an OpenCode 1 plugin. Tested OpenCode 2 host versions and feature-specific verification notes are listed in the [README's compatibility section](../README.md#compatibility). A version not listed there should not be assumed verified simply because it is an OpenCode 2 release.

## Why do Context, Last Request and Session show different token counts?

They answer different questions. **Context Window** uses the viewed session's latest reported assistant usage after the most recent completed compaction, relative to the active model's context limit. **Last Request** shows the selected latest reported call in that session, even if the context limit is unknown. **Session** accumulates usage across the session tree, including subagents. Context is not a lifetime total, and **Context Breakdown** is a separate prompt-composition estimate, not a measured token count to add to the others. See the [README's dialog sections](../README.md#detailed-usage).

## Are cache tokens included in Total, and how is the cache rate calculated?

Yes. **Total** adds Input, Output, Reasoning, Cache Read and Cache Write. **Input** excludes both cache categories, and **Output** excludes Reasoning, so those categories are not counted twice. **Cache Rate** is `Cache Read ÷ (Input + Cache Read + Cache Write)`: its denominator is all incoming tokens, not just uncached input or all tokens including output. See the [README's metric definitions](../README.md#metrics).

## Why does estimated cost show —, partial or $0.00?

`—` means the plugin cannot price the recorded usage; `partial` marks a known subtotal when some calls remain unpriced. `$0.00` means the applied rates yield a confirmed zero estimate, not that pricing data is missing. Small positive estimates below `$0.001` display `<$0.001` instead of being rounded to free. None of these labels guarantees a matching provider bill. See the [README's pricing and display rules](../README.md#behavior).

## Do prices update automatically, and does the plugin fetch them at runtime?

The repository's daily price workflow checks models.dev and releases updated fallback snapshots when reviewed prices change and validation passes. Those snapshots ship with plugin releases; the installed plugin does not fetch prices from models.dev while running or refreshing statistics. Update the plugin to obtain a newer bundled snapshot. OpenCode-resolved prices remain part of the pricing policy, so the snapshot is not the only possible rate source. See the [README's price update workflow](../README.md#development) and [pricing behavior](../README.md#behavior).

## Why does Run Time differ from the sum of response footer durations?

**Run Time** counts only the viewed session's final completed response duration for each turn, not overlapping durations from every assistant step or additional child-session durations. It adds unrounded milliseconds before formatting, so adding rounded footer labels can produce a different result. While running, `~` marks a display-only estimate of elapsed time so far, not a prediction; reported completion timing replaces it and can slightly reduce the display. See the [README's runtime behavior](../README.md#behavior).

## Are usage and Run Time preserved after restarting OpenCode?

The plugin rebuilds token totals, estimated costs and native completed-turn durations from the session's retained message history, including sessions created before installation. It does not need to have been running when those calls occurred. Recovery depends on the data OpenCode still retains: missing token or timing data cannot be reconstructed, and deleted history is not restored by the plugin. Real-time estimates are not a separate permanent usage ledger. See the [README's history and failure behavior](../README.md#behavior).

## How do forks, compaction and reverts affect statistics?

A fork is a separate session tree: inherited message copies are not counted again as new token usage or as the fork's own Run Time. Completed compaction changes the boundary used to select context and the latest request, while retained earlier usage and completed-turn durations remain in cumulative totals; compaction calls also contribute reported tokens and estimated cost. A committed revert that deletes messages removes their contributions. A staged revert alone does not remove completed turns from Run Time. See the [README's statistics behavior](../README.md#behavior) and [request selection rules](../README.md#detailed-usage).

## Why does Context Breakdown show source estimates as unavailable?

**Context Breakdown** needs an assembled model request captured by the server-side plugin and an available plugin RPC to read the estimate. A session without a captured request, or a connection where that RPC is unavailable, cannot show the source breakdown. Opening `/usage` does not send a model request just to populate it. This is separate from reported token usage: missing source estimates do not mean zero usage and do not prevent **Last Request** from showing reported tokens. See the [README's context breakdown requirements](../README.md#detailed-usage).
