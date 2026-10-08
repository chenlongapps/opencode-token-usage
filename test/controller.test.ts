import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageController } from "../src/controller.js";
import type { UsageState } from "../src/controller.js";
import { PerformanceMonitor } from "../src/performance.js";
import { Events, FakeSource, deferred, message, page, session, until } from "./helpers.js";
import type { UsageMessage } from "../src/usage.js";

test("repeated events coalesce and updated messages replace old totals; model switches keep each message model and resize the window", async t => {
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
  source.label = "test/expensive";
  source.context = 64_000;
  events.emit("session.model.selected");
  await until(() => state.model === "test/expensive");
  assert.equal(state.summary?.cost, 0.00004);
  assert.equal(state.summary?.costStatus, "complete");
  assert.deepEqual(state.context, { used: 20, limit: 64_000, percent: 20 / 64_000 * 100 });
  source.context = undefined;
  events.emit("session.model.selected");
  await until(() => state.context === undefined);
  assert.equal(state.summary?.total, 20);
});

test("last request stays available through unknown and unusable model context limits", async t => {
  const source = new FakeSource(), events = new Events();
  source.context = undefined;
  const reported = {
    ...message("a"),
    tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 60, write: 10 } },
    time: { created: 1_000, streamed: 2_000, completed: 3_000 },
  };
  source.history.set("root", [reported]);
  let state: UsageState = { status: "loading" };
  const latest = () => state;
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, undefined, true);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  const expected = { tokens: reported.tokens, total: 200, time: 2_000 };
  assert.deepEqual(state.details?.request, expected);
  assert.equal(state.context, undefined);
  for (const limit of [128_000, 0, -1, NaN, Infinity, -Infinity, undefined, 64_000]) {
    source.context = limit;
    source.label = `test/context-${limit}`;
    events.emit("session.model.selected");
    await until(() => state.model === source.label);
    assert.deepEqual(state.details?.request, expected, `request survives context limit ${limit}`);
    assert.equal(latest().context?.limit, limit && Number.isFinite(limit) && limit > 0 ? limit : undefined);
    assert.equal(state.summary?.total, 200);
  }
});

test("new unopened children trigger discovery; token text deltas and unrelated sessions do not", async t => {
  const source = new FakeSource(), events = new Events();
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, s => { state = s; }, 5);
  t.after(() => controller.dispose());
  controller.select("root"); await until(() => state.status === "ready");
  const reads = source.reads;
  events.emit("session.text.delta"); events.emit("session.step.ended", "unrelated");
  events.emit({ type: "session.created", data: { sessionID: "other-child", parentID: "other" } });
  events.emit({ type: "session.forked", data: { sessionID: "fork", parentID: "root" } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(source.reads, reads);
  source.sessions.set("child", session("child", "root"));
  source.history.set("child", [message("b", 30)]);
  events.emit({ type: "session.created", data: { sessionID: "child", parentID: "root" } });
  await until(() => state.summary?.total === 40);
  source.history.set("child", [message("b", 35)]);
  events.emit("session.step.ended", "child");
  await until(() => state.summary?.total === 45);
});

test("a child update reuses other histories and a session switch discards the old tree cache", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("child", session("child", "root"));
  source.sessions.set("other", session("other"));
  source.history.set("child", [message("child-a", 4)]);
  source.history.set("other", [message("other-a", 7)]);
  const original = source.messages.bind(source);
  const reads: string[] = [];
  source.messages = async (id, cursor) => { reads.push(id); return original(id, cursor); };
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  reads.length = 0;
  source.history.set("child", [message("child-a", 9)]);
  events.emit("session.usage.updated", "child");
  await until(() => state.summary?.total === 19);
  assert.deepEqual(reads, ["child"]);
  controller.select("other");
  await until(() => state.status === "ready" && state.summary?.total === 7);
  assert.equal(state.context?.used, 7);
  assert.deepEqual(reads, ["child", "other"]);
});

test("staged revert changes viewed context without subtracting historical tree cost", async t => {
  const source = new FakeSource(), events = new Events();
  source.history.set("root", [
    { ...message("a", 20), id: "a" },
    { id: "b", type: "user" },
    { ...message("c", 40), id: "c" },
  ]);
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, undefined, true);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  assert.equal(state.context?.used, 40);
  assert.equal(state.details?.request?.total, 40);
  const total = state.summary?.total, cost = state.summary?.cost;
  source.sessions.set("root", { ...session("root"), revert: { messageID: "b" } as NonNullable<ReturnType<typeof session>["revert"]> });
  events.emit("session.revert.staged");
  await until(() => state.context?.used === 20);
  assert.equal(state.details?.request?.total, 20);
  assert.equal(state.summary?.total, total);
  assert.equal(state.summary?.cost, cost);
  source.sessions.set("root", session("root"));
  events.emit("session.revert.cleared");
  await until(() => state.context?.used === 40);
  assert.equal(state.details?.request?.total, 40);
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

test("detailed view shares tree totals with the sidebar and retains a complete report on refresh failure", async t => {
  const source = new FakeSource(), events = new Events();
  source.sessions.set("child", session("child", "root"));
  source.history.set("child", [{ ...message("child-a", 30), time: { created: 1_000, streamed: 2_000 } }]);
  let state: UsageState = { status: "loading" };
  const latest = () => state;
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, undefined, true);
  t.after(() => controller.dispose());
  controller.select("child");
  await until(() => state.status === "ready");
  assert.equal(state.summary?.total, 40);
  assert.equal(state.details?.models[0]?.tokens, 40);
  assert.equal(state.details?.models[0]?.cost, state.summary?.cost);
  assert.equal(state.details?.models[0]?.appliedRates[0]?.source, "OpenCode");
  assert.equal(state.details?.models[0]?.appliedRates[0]?.calls, 2);
  assert.equal(state.details?.request?.total, 30);
  assert.equal(state.details?.request?.time, 2_000);
  assert.equal(state.context?.used, 30);

  source.fail = true;
  events.emit("session.step.ended", "child");
  await until(() => state.status === "stale");
  assert.equal(state.details?.models[0]?.tokens, 40);
  assert.equal(state.details?.models[0]?.appliedRates[0]?.calls, 2);
  assert.equal(state.details?.request?.total, 30);
  assert.equal(state.details?.request?.time, 2_000);
  source.fail = false;
  source.history.set("child", [message("child-a", 50)]);
  await until(() => state.status === "ready" && state.summary?.total === 60);
  assert.equal(state.details?.models[0]?.tokens, 60);
  controller.select("root");
  assert.equal(state.status, "loading");
  assert.equal(state.details, undefined);
  await until(() => state.status === "ready");
  assert.equal(latest().details?.request?.total, 10);
  assert.equal(latest().details?.request?.time, undefined);
});

test("missing or failed request-source estimation does not turn measured usage into a read failure", async t => {
  const source = new FakeSource(), events = new Events();
  source.context = undefined;
  source.history.set("root", [
    { ...message("a"), time: { created: 1_000, streamed: 2_000 } },
    { id: "pending", type: "assistant", time: { created: 4_000 } },
  ]);
  source.composition = async () => ({
    capturedAt: 4_000, model: "test/model",
    tokens: { Messages: 20, "System Tools": 10, "System Prompt": 10, Skills: 0, "MCP Tools": 0, Other: 0 },
  });
  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, undefined, true);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.details?.sources?.capturedAt === 4_000);
  assert.equal(state.summary?.total, 10);
  assert.equal(state.details?.request?.time, 2_000, "a newer assembled request does not date older reported tokens");
  assert.equal(state.details?.request?.total, 10);
  source.composition = async () => { throw new Error("RPC unavailable"); };
  events.emit();
  await until(() => state.status === "ready" && state.details?.sources === undefined);
  assert.equal(state.summary?.total, 10);
  assert.equal(state.context, undefined);
  assert.equal(state.details?.request?.time, 2_000);
  assert.equal(state.details?.request?.total, 10);
});

test("slow source RPC does not block measured usage or overwrite a different session", async t => {
  const source = new FakeSource(), events = new Events();
  source.history.set("root", [{ ...message("a"), time: { created: 100 } }]);
  const slow = deferred<NonNullable<UsageState["details"]>["sources"]>();
  source.sessions.set("other", session("other"));
  source.history.set("other", [{ ...message("other-a", 7), time: { created: 200 } }]);
  source.composition = async selected => selected.id === "root" ? slow.promise : {
    capturedAt: 2_000, model: "test/other",
    tokens: { Messages: 7, "System Tools": 0, "System Prompt": 0, Skills: 0, "MCP Tools": 0, Other: 0 },
  };
  let state: UsageState = { status: "loading" };
  const latest = () => state;
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, undefined, true);
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready" && state.summary?.total === 10);
  assert.equal(state.details?.sources, undefined);
  assert.equal(state.details?.request?.time, 100);
  controller.select("other");
  await until(() => state.details?.sources?.capturedAt === 2_000);
  slow.resolve({
    capturedAt: 1_000, model: "test/model",
    tokens: { Messages: 10, "System Tools": 0, "System Prompt": 0, Skills: 0, "MCP Tools": 0, Other: 0 },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.summary?.total, 7);
  assert.equal(latest().details?.sources?.capturedAt, 2_000);
  assert.equal(latest().details?.request?.time, 200);
  assert.equal(latest().details?.request?.total, 7);
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
  events.emit({ type: "session.text.delta", id: "delta-1", created: 1_500, data: {
    assistantMessageID: "live", sessionID: "root", delta: "abcdefgh",
  } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.performance?.tpsEstimated, undefined, "one delta is not a rate yet");
  assert.equal(state.performance?.ttft, 500);
  events.emit({ type: "session.text.delta", id: "delta-2", created: 2_000, data: {
    assistantMessageID: "live", sessionID: "root", delta: "abcdefgh",
  } });
  await until(() => state.performance?.tpsEstimated === true);
  assert.deepEqual(state.performance, { tps: 8, tpsEstimated: true, ttft: 500 });
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
  events.emit({ type: "session.text.delta", id: "other-delta-2", created: 2_000, data: {
    assistantMessageID: "other-live", sessionID: "other", delta: "abcdefghijklmnop",
  } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.performance?.tpsEstimated, undefined, "another tree does not update the current panel");

  controller.select("other");
  await until(() => state.status === "ready" && state.summary?.total === 7);
  assert.deepEqual(state.performance, { tps: 12, tpsEstimated: true, ttft: 500 });

  controller.select("root");
  await until(() => state.status === "ready" && state.summary?.total === 10);
  events.emit({ type: "session.text.delta", id: "other-delta-3", created: 2_500, data: {
    assistantMessageID: "other-live", sessionID: "other", delta: "abcdefgh",
  } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.performance?.tpsEstimated, undefined);

  controller.select("other");
  await until(() => state.status === "ready" && state.summary?.total === 7);
  // Window now holds 8 + 16 + 8 bytes over 1 s => 8 tok/s raw, eased from 12.
  assert.deepEqual(state.performance, { tps: 12 * 0.65 + 8 * 0.35, tpsEstimated: true, ttft: 500 });
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
  events.emit({ type: "session.text.delta", id: "root-delta-1", created: 1_250, data: {
    assistantMessageID: "root-live", sessionID: "root", delta: "abcd",
  } });
  events.emit({ type: "session.text.delta", id: "root-delta-2", created: 1_500, data: {
    assistantMessageID: "root-live", sessionID: "root", delta: "abcd",
  } });
  await until(() => firstState.performance?.tpsEstimated === true);
  first.dispose();

  let state: UsageState = { status: "loading" };
  const controller = new UsageController(source, events.subscribe, value => { state = value; }, 2, 3_000, 2, performance);
  t.after(() => { controller.dispose(); performance.dispose(); });
  controller.select("root");
  await until(() => state.status === "ready");
  assert.deepEqual(state.performance, { tps: 8, tpsEstimated: true, ttft: 250 });

  source.sessions.set("child", session("child", "root"));
  source.history.set("child", []);
  events.emit({ type: "session.created", data: { sessionID: "child", parentID: "root" } });
  events.emit({ type: "session.step.started", id: "child-start", created: 2_000, data: {
    assistantMessageID: "child-live", sessionID: "child", started: 2_000,
  } });
  events.emit({ type: "session.text.delta", id: "child-delta-1", created: 2_500, data: {
    assistantMessageID: "child-live", sessionID: "child", delta: "abcdefgh",
  } });
  events.emit({ type: "session.text.delta", id: "child-delta-2", created: 2_750, data: {
    assistantMessageID: "child-live", sessionID: "child", delta: "abcdefgh",
  } });
  await until(() => state.performance?.ttft === 375);
  // Root: 8 bytes / 0.25 s = 8; child: 16 bytes / 0.25 s = 16; duration-weighted average = 12.
  assert.deepEqual(state.performance, { tps: 12, tpsEstimated: true, ttft: 375 });
});
