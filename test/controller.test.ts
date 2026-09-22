import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageController } from "../src/controller.js";
import type { UsageState } from "../src/controller.js";
import { PerformanceMonitor } from "../src/performance.js";
import { Events, FakeSource, deferred, message, page, session, until } from "./helpers.js";
import type { UsageMessage } from "../src/usage.js";

test("repeated events coalesce and updated messages replace old totals; model switches reprice and resize the window", async t => {
  const source = new FakeSource(), events = new Events();
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 5);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  assert.equal(state.summary?.total, 10);
  assert.deepEqual(state.context, { used: 10, limit: 128000, percent: 10 / 128000 * 100 });
  const reads = source.reads;
  source.history.set("root", [message("a", 20)]);
  for (let i = 0; i < 20; i++) events.emit();
  await until(() => state.summary?.total === 20);
  assert.equal(source.reads, reads + 1);
  source.prices = [{ input: 10, output: 0, cache: { read: 0, write: 0 } }];
  source.label = "test/expensive";
  source.context = 64_000;
  events.emit("session.model.selected");
  await until(() => state.model === "test/expensive");
  assert.equal(state.summary?.cost, 0.0002);
  assert.deepEqual(state.context, { used: 20, limit: 64_000, percent: 20 / 64_000 * 100 });
  source.context = undefined;
  events.emit("session.model.selected");
  await until(() => state.context === undefined);
  assert.equal(state.summary?.total, 20);
});

test("new unopened children trigger discovery; token text deltas and unrelated sessions do not", async t => {
  const source = new FakeSource(), events = new Events();
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, s => { state = s; }, 5);
  t.after(() => controller.dispose());
  controller.select("root"); await until(() => state.status === "ready");
  const reads = source.reads;
  events.emit("session.text.delta"); events.emit("session.step.ended", "unrelated");
  await new Promise(r => setTimeout(r, 20));
  assert.equal(source.reads, reads);
  source.sessions.set("child", session("child", "root"));
  source.history.set("child", [message("b", 30)]);
  events.emit("session.created", "child");
  await until(() => state.summary?.total === 40);
  source.history.set("child", [message("b", 35)]);
  events.emit("session.step.ended", "child");
  await until(() => state.summary?.total === 45);
});

test("failed refresh retains last complete data and automatically recovers; first failure is unavailable", async t => {
  const source = new FakeSource(), events = new Events();
  source.fail = true;
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, s => { state = s; }, 2, 30);
  t.after(() => controller.dispose());
  controller.select("root"); await until(() => state.status === "unavailable");
  assert.equal({ ...state }.summary, undefined);
  source.fail = false;
  await until(() => state.status === "ready");
  source.fail = true; events.emit();
  await until(() => state.status === "stale");
  assert.equal(state.summary?.total, 10);
  assert.equal(state.context?.used, 10);
  source.fail = false; source.history.set("root", [message("a", 99)]);
  await until(() => state.status === "ready" && state.summary?.total === 99);
});

test("switching sessions discards old responses even if the source ignores cancellation; dispose unsubscribes", async () => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("other", session("other"));
  const slow = deferred<UsageMessage[]>();
  source.messages = async id => page(id === "root" ? await slow.promise : [message("other-a", 7)]);
  let state: UsageState = { status: "loading" };
  let publications = 0;
  const controller = new UsageController(source, events.subscribe, s => { state = s; publications++; }, 2);
  controller.select("root"); controller.select("other");
  await until(() => state.status === "ready");
  assert.equal(state.summary?.total, 7);
  slow.resolve([message("old", 999)]);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(state.summary?.total, 7);
  controller.dispose();
  const before = publications;
  events.emit(); controller.select("root"); controller.refresh();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(publications, before);
  assert.equal(events.listeners.size, 0);
});

test("events arriving during a fetch schedule one subsequent refresh", async t => {
  const source = new FakeSource(), events = new Events();
  const slow = deferred<UsageMessage[]>();
  let fetches = 0;
  source.messages = async () => page(++fetches === 1 ? await slow.promise : [message("a", 22)]);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, s => { state = s; }, 2);
  t.after(() => controller.dispose());
  controller.select("root"); await until(() => fetches === 1);
  events.emit(); events.emit(); slow.resolve([message("a", 1)]);
  await until(() => state.summary?.total === 22);
  assert.equal(fetches, 2);
});

test("stream deltas publish estimated TPS and TTFT without source reads, then completion converges to exact TPS", async t => {
  const source = new FakeSource(), events = new Events();
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  const reads = source.reads;

  events.emit({ type: "session.step.started", id: "start", created: 1_000, data: {
    assistantMessageID: "live", sessionID: "root", started: 1_000,
  } });
  events.emit({ type: "session.text.delta", id: "delta", created: 1_500, data: {
    assistantMessageID: "live", sessionID: "root", delta: "abcdefgh",
  } });
  await until(() => state.performance?.tpsEstimated === true);
  assert.deepEqual(state.performance, { tps: 4, tpsEstimated: true, ttft: 500 });
  assert.equal(source.reads, reads);

  source.history.set("root", [message("a"), {
    id: "live", type: "assistant", time: { created: 1_000, streamed: 2_000 },
    content: [{ type: "text", text: "abcdefgh" }], tokens: { output: 20, reasoning: 10 },
  }]);
  events.emit({ type: "session.step.ended", id: "end", created: 2_100, data: {
    assistantMessageID: "live", sessionID: "root",
  } });
  await until(() => state.summary?.total === 40 && state.performance?.tpsEstimated !== true);
  assert.equal(state.performance?.tps, 30);
  assert.equal(state.performance?.ttft, 500);
});

test("a shared monitor restores a stream captured before switching to its session tree", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("other", session("other"));
  source.history.set("other", [message("other-a", 7)]);
  const performance = new PerformanceMonitor(events.subscribe);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, performance);
  t.after(() => { controller.dispose(); performance.dispose(); });

  controller.select("root");
  await until(() => state.status === "ready");
  events.emit({ type: "session.step.started", id: "other-start", created: 1_000, data: {
    assistantMessageID: "other-live", sessionID: "other", started: 1_000,
  } });
  events.emit({ type: "session.text.delta", id: "other-delta-1", created: 1_500, data: {
    assistantMessageID: "other-live", sessionID: "other", delta: "abcdefgh",
  } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.performance?.tpsEstimated, undefined, "another tree does not update the current panel");

  controller.select("other");
  await until(() => state.status === "ready" && state.summary?.total === 7);
  assert.deepEqual(state.performance, { tps: 4, tpsEstimated: true, ttft: 500 });

  controller.select("root");
  await until(() => state.status === "ready" && state.summary?.total === 10);
  events.emit({ type: "session.text.delta", id: "other-delta-2", created: 2_000, data: {
    assistantMessageID: "other-live", sessionID: "other", delta: "abcdefghijklmnop",
  } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.performance?.tpsEstimated, undefined);

  controller.select("other");
  await until(() => state.status === "ready" && state.summary?.total === 7);
  assert.deepEqual(state.performance, { tps: 6, tpsEstimated: true, ttft: 500 });
});

test("a rebuilt controller recovers shared stream state and a new child joins the current tree immediately", async t => {
  const source = new FakeSource(), events = new Events();
  const performance = new PerformanceMonitor(events.subscribe);
  let firstState: UsageState = { status: "loading" };
  const first = new UsageController(source, events.subscribe, value => { firstState = value; }, 2, 3_000, 2, performance);
  first.select("root");
  await until(() => firstState.status === "ready");
  events.emit({ type: "session.step.started", id: "root-start", created: 1_000, data: {
    assistantMessageID: "root-live", sessionID: "root", started: 1_000,
  } });
  events.emit({ type: "session.text.delta", id: "root-delta", created: 1_250, data: {
    assistantMessageID: "root-live", sessionID: "root", delta: "abcd",
  } });
  await until(() => firstState.performance?.tpsEstimated === true);
  first.dispose();

  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, performance);
  t.after(() => { controller.dispose(); performance.dispose(); });
  controller.select("root");
  await until(() => state.status === "ready");
  assert.deepEqual(state.performance, { tps: 4, tpsEstimated: true, ttft: 250 });

  source.sessions.set("child", session("child", "root"));
  source.history.set("child", []);
  events.emit({ type: "session.created", data: { sessionID: "child", parentID: "root" } });
  events.emit({ type: "session.step.started", id: "child-start", created: 2_000, data: {
    assistantMessageID: "child-live", sessionID: "child", started: 2_000,
  } });
  events.emit({ type: "session.text.delta", id: "child-delta", created: 2_500, data: {
    assistantMessageID: "child-live", sessionID: "child", delta: "abcdefgh",
  } });
  await until(() => state.performance?.ttft === 375);
  assert.deepEqual(state.performance, { tps: 4, tpsEstimated: true, ttft: 375 });
});
