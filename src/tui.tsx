import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { UsageController } from "./controller.js";
import type { UsageState } from "./controller.js";
import { createSource } from "./source.js";
import { usageRows } from "./usage.js";

function UsagePanel(props: { context: Plugin.Context; sessionID: string; register: (controller: UsageController) => () => void }) {
  const [state, setState] = createSignal<UsageState>({ status: "loading" });
  const controller = new UsageController(
    createSource(props.context.client),
    listener => props.context.data.listen(({ details }) => listener(details)),
    setState,
  );
  const unregister = props.register(controller);
  createEffect(() => controller.select(props.sessionID));
  onCleanup(() => { controller.dispose(); unregister(); });
  const rows = createMemo(() => usageRows(state().summary, state().context, state().performance));
  const status = () => ({ loading: "Loading…", ready: "", stale: "Not updated · retrying…", unavailable: "Unavailable · retrying…" })[state().status];

  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text fg={props.context.theme.text.base}><b>Token Usage</b></text>
      <Show when={state().status !== "ready"}>
        <text fg={props.context.theme.text.muted}>{status()}</text>
      </Show>
      <For each={rows()}>{row => (
        <box flexDirection="row" justifyContent="space-between">
          <text fg={props.context.theme.text.muted}>{row[0]}</text>
          <text fg={props.context.theme.text.muted}>{row[1]}</text>
        </box>
      )}</For>
    </box>
  );
}

export default Plugin.define({
  id: "opencode-token-usage.tui",
  setup(context) {
    const controllers = new Set<UsageController>();
    const register = (controller: UsageController) => {
      controllers.add(controller);
      return () => { controllers.delete(controller); };
    };
    const remove = context.ui.slot({
      append: "sidebar.content",
      render: props => <UsagePanel context={context} sessionID={props.sessionID} register={register} />,
    });
    // 2.0.9 SessionFrame never mounts the sidebar for a child session.
    // Keep the same full panel visible through the supported composer slot.
    const removeChild = context.ui.slot({
      append: "session.composer.top",
      render: props => (
        <Show when={context.data.session.get(props.sessionID)?.parentID}>
          <box flexDirection="row" justifyContent="flex-end" paddingRight={2} flexShrink={0}>
            <box width={36} maxWidth="100%" flexDirection="column">
              <UsagePanel context={context} sessionID={props.sessionID} register={register} />
            </box>
          </box>
        </Show>
      ),
    });
    return () => {
      for (const controller of controllers) controller.dispose();
      controllers.clear();
      remove();
      removeChild();
    };
  },
});
