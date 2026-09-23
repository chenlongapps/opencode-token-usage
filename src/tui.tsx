import { Plugin } from "@opencode/plugin/tui";
import { useTerminalDimensions } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { UsageController } from "./controller.js";
import type { UsageState } from "./controller.js";
import { PerformanceMonitor } from "./performance.js";
import { breakdownRows } from "./context-sources.js";
import { createSource } from "./source.js";
import { bar, countLabel, formatCompact, formatEstimatedCost, formatTokens, requestRows, summaryRows, usageRows } from "./usage.js";

function UsagePanel(props: {
  context: Plugin.Context;
  sessionID: string;
  performance: PerformanceMonitor;
  register: (controller: UsageController) => () => void;
}) {
  const [state, setState] = createSignal<UsageState>({ status: "loading" });
  const controller = new UsageController(
    createSource(props.context.client),
    listener => props.context.data.listen(({ details }) => listener(details)),
    setState,
    80,
    3_000,
    100,
    props.performance,
  );
  const unregister = props.register(controller);
  createEffect(() => controller.select(props.sessionID));
  onCleanup(() => { controller.dispose(); unregister(); });
  const rows = createMemo(() => usageRows(state().summary, state().context, state().performance));
  const performanceStart = createMemo(() => rows().findIndex(([label]) => label === "TPS" || label === "TTFT"));
  const status = () => ({ loading: "Loading…", ready: "", stale: "Not updated · retrying…", unavailable: "Unavailable · retrying…" })[state().status];

  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text fg={props.context.theme.text.base}><b>Token Usage</b></text>
      <Show when={state().status !== "ready"}>
        <text fg={props.context.theme.text.muted}>{status()}</text>
      </Show>
      <For each={rows()}>{(row, index) => (
        <box flexDirection="row" justifyContent="space-between" marginTop={index() === performanceStart() ? 1 : 0}>
          <text fg={props.context.theme.text.muted}>{row[0]}</text>
          <text fg={props.context.theme.text.muted}>{row[1]}</text>
        </box>
      )}</For>
    </box>
  );
}

function UsageDialog(props: {
  context: Plugin.Context;
  sessionID: string;
  performance: PerformanceMonitor;
  register: (controller: UsageController) => () => void;
}) {
  const [state, setState] = createSignal<UsageState>({ status: "loading" });
  const [detailed, setDetailed] = createSignal(false);
  const dimensions = useTerminalDimensions();
  const controller = new UsageController(
    createSource(props.context.client),
    listener => props.context.data.listen(({ details }) => listener(details)),
    setState, 80, 3_000, 100, props.performance, true,
  );
  const unregister = props.register(controller);
  controller.select(props.sessionID);
  onCleanup(() => { controller.dispose(); unregister(); });

  let scroll: ScrollBoxRenderable | undefined;
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Scroll usage up", group: "Dialog", run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: "Scroll usage down", group: "Dialog", run: () => scroll?.scrollBy(1) },
      { bind: "pageup", title: "Previous usage page", group: "Dialog", run: () => scroll?.scrollBy(-10) },
      { bind: "pagedown", title: "Next usage page", group: "Dialog", run: () => scroll?.scrollBy(10) },
      { bind: "home", title: "First usage row", group: "Dialog", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Last usage row", group: "Dialog", run: () => scroll?.scrollTo(Infinity) },
      { bind: "d", title: "Toggle usage details", group: "Dialog", run: () => { setDetailed(value => !value); } },
    ],
  }));

  const theme = () => props.context.theme.text;
  const context = createMemo(() => state().details?.context);
  const models = createMemo(() => state().details?.models ?? []);
  const sources = createMemo(() => state().details?.sources);
  // The host gives this dialog a fixed width; keep every row inside that content box.
  const width = createMemo(() => Math.max(24, Math.min(88, dimensions().width - 2) - 4));
  const windowBar = createMemo(() => Math.max(8, Math.min(48, width() - 16)));
  const breakdownBar = createMemo(() => Math.max(6, Math.min(20, width() - 46)));
  const pairColumns = createMemo(() => width() >= 44);
  const compact = () => !detailed();
  const number = (value: number) => compact() ? formatCompact(value) : formatTokens(value);  const status = () => ({ loading: "Loading…", ready: "", stale: "Not updated · retrying…", unavailable: "Unavailable · retrying…" })[state().status];

  // The body never repeats the model name: one identity line carries the session and models.
  const identity = createMemo(() => {
    const title = state().details?.sessionTitle;
    const active = models().length > 1 ? `${models().length} models` : state().model;
    return [title, active].filter(Boolean).join(" · ");
  });

  const requestRowsList = (rows: readonly (readonly [string, string])[]) => {
    const half = Math.ceil(rows.length / 2);
    const columns = [rows.slice(0, half), rows.slice(half)];
    const cell = ([label, value]: readonly [string, string]) => (
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme().muted} flexShrink={0}>{label}</text>
        <text fg={theme().base}>{value}</text>
      </box>
    );
    return pairColumns()
      ? <box flexDirection="row" gap={2}>{columns.map(column => <box flexDirection="column" flexGrow={1} minWidth={0}>{column.map(cell)}</box>)}</box>
      : <box flexDirection="column">{rows.map(cell)}</box>;
  };

  const barRow = (percent: number, size: number) => {
    const cells = bar(percent, size);
    return (
      <box flexDirection="row">
        <text fg={theme().base}>{"█".repeat(cells.filled)}</text>
        <text fg={theme().muted}>{"░".repeat(cells.empty)}</text>
      </box>
    );
  };

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme().base}><b>Token Usage</b></text>
        <text fg={theme().muted} onMouseUp={() => props.context.ui.dialog.clear()}>esc</text>
      </box>
      <Show when={identity()}>
        <text fg={theme().muted} wrapMode="word">{identity()}</text>
      </Show>
      <Show when={state().status !== "ready"}>
        <text fg={theme().muted}>{status()}</text>
      </Show>
      <Show when={state().summary}>
        <scrollbox
          ref={(value: ScrollBoxRenderable) => { scroll = value; }}
          maxHeight={Math.max(3, dimensions().height - Math.floor(dimensions().height / 4) - 8)}
          contentOptions={{ minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
        >
          <box gap={1}>
            <box>
              <text fg={theme().base}><b>Context Window</b></text>
              <Show when={context()} fallback={<text fg={theme().muted}>Context usage unavailable</text>}>
                {(details) => (
                  <box>
                    <box flexDirection="row" justifyContent="space-between" gap={2}>
                      <text fg={theme().muted} flexShrink={0}>Used / Limit</text>
                      <text fg={theme().base} wrapMode="word" minWidth={0}>
                        {number(details().usage.used)} / {number(details().usage.limit)} ({details().usage.percent.toFixed(1)}%)
                      </text>
                    </box>
                    {barRow(details().usage.percent, windowBar())}
                  </box>
                )}
              </Show>
            </box>
            <box>
              <box flexDirection="row" justifyContent="space-between" gap={2}>
                <text fg={theme().base}><b>Last Request</b></text>
                <Show when={sources()}>{(captured) => (
                  <text fg={theme().muted}>{new Date(captured().capturedAt).toLocaleTimeString()}</text>
                )}</Show>
              </box>
              <Show when={context()} fallback={<text fg={theme().muted}>Request composition unavailable</text>}>
                {(details) => <box>{requestRowsList(requestRows(details(), compact()))}</box>}
              </Show>
            </box>
            <box>
              <text fg={theme().base}><b>Context Breakdown</b></text>
              <Show when={sources()} fallback={<text fg={theme().muted}>Source estimates unavailable (no request snapshot or RPC)</text>}>
                {(captured) => <For each={breakdownRows(captured(), detailed())}>{(row) => (
                  <box flexDirection="row" gap={1}>
                    <box width={14} flexShrink={0}><text fg={theme().muted}>{row.label}</text></box>
                    <box flexShrink={0} width={breakdownBar()}>{barRow(row.percent, breakdownBar())}</box>
                    <text fg={theme().base} flexShrink={0}>{number(row.tokens)}</text>
                    <text fg={theme().muted} flexShrink={0}>{row.percent.toFixed(1)}%</text>
                  </box>
                )}</For>}
              </Show>
            </box>
            <box>
              <text fg={theme().base}><b>Session</b></text>
              <Show when={state().summary} fallback={<text fg={theme().muted}>Session usage unavailable</text>}>
                {(summary) => (
                  <Show when={detailed()} fallback={
                    <text fg={theme().base} wrapMode="word">
                      {countLabel(summary().steps, "step")} · {countLabel(summary().calls, "call")} · {formatCompact(summary().total)} tokens · {(summary().cacheRate * 100).toFixed(1)}% cached{formatEstimatedCost(summary().cost, summary().costStatus) ? ` · ${formatEstimatedCost(summary().cost, summary().costStatus)}` : ""}
                    </text>
                  }>
                    <For each={summaryRows(summary())}>{([label, value]) => (
                      <box flexDirection="row" justifyContent="space-between" gap={2}>
                        <text fg={theme().muted} flexShrink={0}>{label}</text>
                        <text fg={theme().base}>{value}</text>
                      </box>
                    )}</For>
                  </Show>
                )}
              </Show>
            </box>
            <box>
              <text fg={theme().base}><b>By Model</b></text>
              <Show when={models().length} fallback={<text fg={theme().muted}>No model usage yet</text>}>
                <For each={models()}>{(model) => (
                  <box>
                    <box flexDirection="row" justifyContent="space-between" gap={2}>
                      <text fg={theme().base} wrapMode="word" minWidth={0} flexGrow={1}>{model.model}</text>
                      <text fg={theme().base} flexShrink={0}>{formatEstimatedCost(model.cost, model.costStatus) ?? ""}</text>
                    </box>
                    <text fg={theme().muted}>{number(model.tokens)} tokens · {countLabel(model.calls, "call")}</text>
                  </box>
                )}</For>
              </Show>
            </box>
          </box>
        </scrollbox>
      </Show>
      <text fg={theme().muted}>↑/↓ scroll · d details · esc close</text>
    </box>
  );
}

export default Plugin.define({
  id: "opencode-token-usage.tui",
  setup(context) {
    const performance = new PerformanceMonitor(
      listener => context.data.listen(({ details }) => listener(details)),
    );
    const controllers = new Set<UsageController>();
    const register = (controller: UsageController) => {
      controllers.add(controller);
      return () => { controllers.delete(controller); };
    };
    const remove = context.ui.slot({
      append: "sidebar.content",
      render: props => <UsagePanel context={context} sessionID={props.sessionID} performance={performance} register={register} />,
    });
    // 2.0.9 SessionFrame never mounts the sidebar for a child session.
    // Keep the same full panel visible through the supported composer slot.
    const removeChild = context.ui.slot({
      append: "session.composer.top",
      render: props => (
        <Show when={context.data.session.get(props.sessionID)?.parentID}>
          <box flexDirection="row" justifyContent="flex-end" paddingRight={2} flexShrink={0}>
            <box width={36} maxWidth="100%" flexDirection="column">
              <UsagePanel context={context} sessionID={props.sessionID} performance={performance} register={register} />
            </box>
          </box>
        </Show>
      ),
    });
    const removeCommand = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-token-usage.show",
            title: "Token usage",
            group: "Session",
            palette: true,
            slash: { name: "usage" },
            enabled: () => context.ui.router.current().type === "session",
            run: () => {
              const route = context.ui.router.current();
              if (route.type !== "session") return;
              context.ui.dialog.show(() => <UsageDialog context={context} sessionID={route.sessionID} performance={performance} register={register} />);
              context.ui.dialog.set({ size: "large", centered: true });
            },
          }],
        }));
        return null;
      },
    });
    return () => {
      for (const controller of controllers) controller.dispose();
      controllers.clear();
      remove();
      removeChild();
      removeCommand();
      performance.dispose();
    };
  },
});
