import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageController } from "../src/controller.js";
import type { UsageState } from "../src/controller.js";
import { RuntimeMonitor } from "../src/runtime-monitor.js";
import type { UsageMessage } from "../src/usage.js";
import { Events, FakeSource, deferred, page, session, until } from "./helpers.js";

const live = (id = "a", started = 1_000): UsageMessage[] => [
  { id: `${id}-u`, type: "user", time: { created: started } },
  { id, type: "assistant", time: { created: started + 100 } },
];
const completed = (id = "a", started = 1_000, end = 3_000): UsageMessage[] => [
  live(id, started)[0]!,
  { id, type: "assistant", finish: "stop", time: { created: started + 100, completed: end } },
  { id: `${id}-idle`, type: "idle", time: { created: end + 100 } },
];

test("first-turn runtime advances every 500ms in memory and returns to native completion timing", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.history.set("root", live());
  let mono = 0;
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  runtime.handle({ type: "server.connected", created: 2_000, data: {} });
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 1_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  const reads = source.reads;
  for (const elapsed of [500, 1_000, 1_500]) {
    mono = elapsed;
    t.mock.timers.tick(500);
    assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0, estimatedMilliseconds: 1_000 + elapsed });
    assert.equal(source.reads, reads, "display ticks don't read messages or the tree");
  }
  source.history.set("root", completed("a", 1_000, 3_200));
  events.emit({ type: "session.step.ended", created: 3_500, data: { sessionID: "root", assistantMessageID: "a", finish: "stop" } });
  controller.setRunning(false);
  await until(() => state.runtime?.milliseconds === 2_200 && state.runtime.estimatedMilliseconds === undefined);
  const settled = state.runtime;
  mono += 10_000;
  t.mock.timers.tick(10_000);
  assert.deepEqual(state.runtime, settled, "idle remains exact even if the projection was larger");
});

test("live steering replaces the same-turn subtotal and tools keep advancing until the final footer", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  const history: UsageMessage[] = [
    ...completed("first", 0, 500),
    { id: "u", type: "user", time: { created: 1_000 } },
    { id: "a1", type: "assistant", finish: "stop", time: { created: 2_000, completed: 4_000 } },
    { id: "steer", type: "user", time: { created: 5_000 } },
    { id: "a2", type: "assistant", time: { created: 6_000 } },
  ];
  source.history.set("root", history);
  let mono = 0, state: UsageState = { status: "loading" };
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  runtime.handle({ type: "server.connected", created: 8_000, data: {} });
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 7_500);
  assert.equal(state.runtime?.milliseconds, 3_500);
  source.history.set("root", [...history.slice(0, -1), {
    id: "a2", type: "assistant", finish: "tool-calls", time: { created: 6_000, completed: 8_000 },
  }]);
  events.emit({ type: "session.step.ended", created: 8_000, data: { sessionID: "root", assistantMessageID: "a2", finish: "tool-calls" } });
  await new Promise(resolve => setTimeout(resolve, 10));
  mono = 2_000;
  t.mock.timers.tick(500);
  assert.equal(state.runtime?.estimatedMilliseconds, 9_500, "tool/foreground waits stay in the turn");
  source.history.set("root", [...source.history.get("root")!, {
    id: "a3", type: "assistant", finish: "stop", time: { created: 10_000, completed: 12_000 },
  }]);
  events.emit({ type: "session.step.started", created: 10_000, data: { sessionID: "root", assistantMessageID: "a3" } });
  events.emit({ type: "session.step.ended", created: 12_000, data: { sessionID: "root", assistantMessageID: "a3", finish: "stop" } });
  await until(() => state.runtime?.milliseconds === 11_500 && state.runtime.estimatedMilliseconds === undefined);
});

test("a terminal event freezes a live projection before a delayed final snapshot arrives", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.history.set("root", live());
  let mono = 0, state: UsageState = { status: "loading" };
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  runtime.handle({ type: "server.connected", created: 2_000, data: {} });
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 1_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  const gate = deferred<void>();
  source.messages = async () => { await gate.promise; return page(completed("a", 1_000, 2_900)); };
  const before = state.runtime;
  events.emit({ type: "session.step.failed", created: 3_000, data: { sessionID: "root", assistantMessageID: "a" } });
  mono = 5_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(state.runtime, before, "completion-to-idle cleanup time is not estimated");
  gate.resolve();
  await until(() => state.runtime?.milliseconds === 1_900 && state.runtime.estimatedMilliseconds === undefined);
});

test("read failure freezes the projected value with stale status and recovery resumes from history", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.history.set("root", live());
  let mono = 0, state: UsageState = { status: "loading" };
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  runtime.handle({ type: "server.connected", created: 2_000, data: {} });
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 1_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  source.fail = true;
  controller.refresh();
  await until(() => state.status === "stale");
  mono = 5_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(state.runtime, { status: "stale", milliseconds: 0, estimatedMilliseconds: 1_000 });
  source.fail = false;
  controller.refresh();
  await until(() => state.runtime?.estimatedMilliseconds === 6_000 && state.runtime.status === "ready");
});

test("all views share the live clock; a quiet running child restores elapsed time without adding it to an idle parent", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.history.set("root", completed("parent", 0, 500));
  source.sessions.set("child", session("child", "root"));
  source.history.set("child", live("child-a", 1_000));
  let mono = 0;
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  runtime.handle({ type: "server.connected", created: 10_000, data: {} });
  let parentState: UsageState = { status: "loading" }, childState: UsageState = { status: "loading" }, dialogState: UsageState = { status: "loading" };
  const parent = new UsageController(source, events.subscribe, value => { parentState = value; }, 2, 3_000, 2, undefined, false, runtime);
  const child = new UsageController(source, events.subscribe, value => { childState = value; }, 2, 3_000, 2, undefined, false, runtime);
  const dialog = new UsageController(source, events.subscribe, value => { dialogState = value; }, 2, 3_000, 2, undefined, true, runtime);
  t.after(() => { parent.dispose(); child.dispose(); dialog.dispose(); runtime.dispose(); });
  parent.select("root"); child.select("child"); child.setRunning(true);
  await until(() => parentState.status === "ready" && childState.runtime?.estimatedMilliseconds === 9_000);
  mono = 1_000;
  dialog.select("child"); dialog.setRunning(true);
  await until(() => dialogState.runtime?.estimatedMilliseconds === 10_000);
  t.mock.timers.tick(500);
  assert.deepEqual(dialogState.runtime, childState.runtime);
  assert.deepEqual(parentState.runtime, { status: "ready", milliseconds: 500 });
  child.dispose();
  mono = 1_500;
  t.mock.timers.tick(500);
  assert.equal(dialogState.runtime?.estimatedMilliseconds, 10_500, "closing one view doesn't stop the shared clock");
});

test("switching sessions clears projections immediately; idle/unknown timing cannot start a live clock", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.history.set("root", live());
  source.sessions.set("other", session("other"));
  source.history.set("other", completed("other-a", 0, 500));
  let mono = 0, state: UsageState = { status: "loading" };
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.status === "ready");
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0 }, "no client-clock fabrication without a server anchor");
  events.emit({ type: "session.text.delta", created: 2_000, data: { sessionID: "root", assistantMessageID: "a", delta: "hi" } });
  assert.equal(state.runtime?.estimatedMilliseconds, 1_000);
  controller.select("other");
  assert.deepEqual(state.runtime, { status: "loading" });
  await until(() => state.status === "ready" && state.runtime?.milliseconds === 500);
  mono = 10_000;
  t.mock.timers.tick(10_000);
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 500 });
  controller.select("root");
  await until(() => state.status === "ready");
  assert.equal(state.runtime?.estimatedMilliseconds, undefined, "a retained unfinished message alone doesn't imply native activity");
});

test("a slow optional clock RPC cannot delay measured usage or overwrite a disposed controller", async t => {
  const source = new FakeSource(), events = new Events();
  source.history.set("root", [...completed("first", 0, 500), ...live("next", 1_000)]);
  let mono = 0, state: UsageState = { status: "loading" }, publications = 0;
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  const gate = deferred<number>();
  const synchronization = runtime.synchronize(() => gate.promise);
  const controller = new UsageController(source, events.subscribe, value => { state = value; publications++; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.status === "ready");
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 500 });
  assert.ok(state.summary);
  events.emit({ type: "session.text.delta", created: 2_000, data: { sessionID: "root", assistantMessageID: "next", delta: "hi" } });
  assert.equal(state.runtime?.estimatedMilliseconds, 1_500, "live events are sufficient when the RPC is unavailable or slow");
  controller.dispose();
  const before = publications;
  mono = 1_000;
  gate.resolve(3_000);
  await synchronization;
  assert.equal(publications, before);
});

test("first-turn refreshes retain the original start after synthetic deliveries without idle markers", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 10_000 } });
  const history: UsageMessage[] = [live()[0]!,
    { id: "tool", type: "assistant", finish: "tool-calls", time: { created: 2_000, completed: 3_000 } }];
  source.history.set("root", history);
  const runtime = new RuntimeMonitor(events.subscribe, () => 0);
  runtime.handle({ type: "session.step.started", created: 2_000, data: { sessionID: "root", assistantMessageID: "tool" } });
  await runtime.synchronize(async () => 10_000);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 9_000);
  source.history.set("root", [...history,
    { id: "synthetic1", type: "synthetic", time: { created: 8_000 } },
    { id: "synthetic2", type: "synthetic", time: { created: 8_500 } },
    { id: "next", type: "assistant", time: { created: 9_000 } }]);
  events.emit({ type: "session.step.started", created: 9_000, data: { sessionID: "root", assistantMessageID: "next" } });
  await until(() => state.summary?.steps === 2);
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0, estimatedMilliseconds: 9_000 });
});

test("recreating views and pausing callbacks do not lose a first turn's elapsed time", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 10_000 } });
  source.history.set("root", [live()[0]!,
    { id: "tool", type: "assistant", finish: "tool-calls", time: { created: 2_000, completed: 3_000 } },
    { id: "synthetic", type: "synthetic", time: { created: 8_000 } },
    { id: "next", type: "assistant", time: { created: 9_000 } }]);
  let mono = 0;
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  await runtime.synchronize(async () => 10_000);
  let state: UsageState = { status: "loading" }, dialogState: UsageState = { status: "loading" };
  const first = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  first.select("root"); first.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 9_000);
  first.dispose();
  mono = 5_000;
  const rebuilt = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  const dialog = new UsageController(source, events.subscribe, value => { dialogState = value; }, 2, 3_000, 2, undefined, true, runtime);
  t.after(() => { first.dispose(); rebuilt.dispose(); dialog.dispose(); runtime.dispose(); });
  rebuilt.select("root"); rebuilt.setRunning(true); dialog.select("root"); dialog.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 14_000 && dialogState.runtime?.estimatedMilliseconds === 14_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  const reads = source.reads;
  mono += 120_000;
  t.mock.timers.tick(500);
  assert.equal(state.runtime?.estimatedMilliseconds, 134_000, "one resumed callback catches up two minutes, not just one tick");
  assert.deepEqual(dialogState.runtime, state.runtime);
  assert.equal(source.reads, reads, "catch-up does not poll history");
});

test("a reconnect snapshot freezes the same open turn while a delayed clock anchor is unavailable", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const source = new FakeSource(), events = new Events();
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 10_000 } });
  source.history.set("root", [live()[0]!,
    { id: "synthetic", type: "synthetic", time: { created: 8_000 } },
    { id: "next", type: "assistant", time: { created: 9_000 } }]);
  let mono = 0, publications = 0;
  const runtime = new RuntimeMonitor(events.subscribe, () => mono);
  await runtime.synchronize(async () => 10_000);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; publications++; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 9_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  const reads = source.reads;
  events.emit({ type: "server.connected", data: {} });
  await until(() => source.reads > reads);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0, estimatedMilliseconds: 9_000 },
    "a successful history read must not replace a frozen projection with the zero subtotal");
  const frozen = publications;
  mono = 5_000;
  t.mock.timers.tick(5_000);
  assert.equal(publications, frozen, "no untrusted-clock ticker runs while waiting for an anchor");
  await runtime.synchronize(async () => 15_000);
  assert.equal(state.runtime?.estimatedMilliseconds, 14_000);
  mono = 5_500;
  t.mock.timers.tick(500);
  assert.equal(state.runtime?.estimatedMilliseconds, 14_500);
  source.history.set("root", [live()[0]!,
    { id: "synthetic", type: "synthetic", time: { created: 8_000 } },
    { id: "next", type: "assistant", finish: "stop", time: { created: 9_000, completed: 15_400 } }]);
  events.emit({ type: "session.step.ended", created: 15_500, data: { sessionID: "root", assistantMessageID: "next", finish: "stop" } });
  await until(() => state.runtime?.estimatedMilliseconds === undefined && state.runtime?.milliseconds === 14_400);
  assert.equal(state.runtime?.milliseconds, 14_400, "native completion can legitimately correct the estimate downwards");
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 15_500, idle: 15_600 } });
  source.history.get("root")!.push({ id: "idle", type: "idle", time: { created: 15_600 } });
  controller.setRunning(false);
  await until(() => state.runtime?.milliseconds === 14_400);
});

test("a replacement history cannot inherit a frozen projection just because its input timestamp matches", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 10_000 } });
  source.history.set("root", live("old", 1_000));
  const runtime = new RuntimeMonitor(events.subscribe, () => 0);
  await runtime.synchronize(async () => 10_000);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 9_000);
  source.history.set("root", live("replacement", 1_000));
  events.emit({ type: "server.connected", data: {} });
  await until(() => state.runtime?.estimatedMilliseconds === undefined);
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0 }, "deleted or reverted message identity cannot retain old timing");
});

test("a new monitor and controller restore a quiet first turn using one trusted clock read", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("root", { ...session("root"), time: { created: 900, updated: 10_000 } });
  source.history.set("root", [live()[0]!,
    { id: "tool", type: "assistant", finish: "tool-calls", time: { created: 2_000, completed: 3_000 } },
    { id: "synthetic", type: "synthetic", time: { created: 8_000 } },
    { id: "next", type: "assistant", time: { created: 9_000 } }]);
  const runtime = new RuntimeMonitor(events.subscribe, () => 0);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.status === "ready");
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0 }, "a new TUI cannot invent elapsed time without an anchor");
  let clockReads = 0;
  await runtime.synchronize(async () => { clockReads++; return 15_000; });
  assert.equal(state.runtime?.estimatedMilliseconds, 14_000);
  assert.equal(clockReads, 1);
});

test("a changed historical subtotal is not hidden by frozen projection retention", async t => {
  const source = new FakeSource(), events = new Events();
  const current = live("current", 10_000);
  source.history.set("root", [...completed("first", 1_000, 4_000), ...current]);
  const runtime = new RuntimeMonitor(events.subscribe, () => 0);
  await runtime.synchronize(async () => 20_000);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, undefined, false, runtime);
  t.after(() => { controller.dispose(); runtime.dispose(); });
  controller.select("root"); controller.setRunning(true);
  await until(() => state.runtime?.estimatedMilliseconds === 13_000);
  source.history.set("root", current);
  events.emit({ type: "server.connected", data: {} });
  await until(() => state.runtime?.estimatedMilliseconds === undefined);
  assert.deepEqual(state.runtime, { status: "ready", milliseconds: 0 }, "retained current messages do not conceal changed native history");
});
