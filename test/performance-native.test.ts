import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageController } from "../src/controller.js";
import type { UsageState } from "../src/controller.js";
import { historicalPerformance, PerformanceMonitor } from "../src/performance.js";
import { usageRows, summarize } from "../src/usage.js";
import type { UsageMessage } from "../src/usage.js";
import { Events, FakeSource, until } from "./helpers.js";

const greeting: UsageMessage = {
  id: "greeting", type: "assistant",
  time: { created: 1_794_759_595_530, firstToken: 1_794_759_597_456, streamed: 1_794_759_598_145, completed: 1_794_759_598_223 },
  tokens: { output: 69 }, content: [{ type: "text", text: "hello" }],
};
const concentrated: UsageMessage = {
  id: "concentrated", type: "assistant",
  time: { created: 1_000, firstToken: 5_800, streamed: 5_828, completed: 9_100 },
  tokens: { output: 115, reasoning: 0 },
};
const payload = { sessionID: "root", assistantMessageID: "a" };
const send = (monitor: PerformanceMonitor, type: string, created: number, data = {}) =>
  monitor.handle({ type, created, data: { ...payload, ...data } });

test("native greeting timestamps reproduce the host's 1.9s TTFT and 100.1 tok/s", () => {
  const performance = historicalPerformance([greeting]);
  assert.equal(performance.ttft, 1_926);
  assert.equal(performance.tps, 69 / 0.689);
  const rows = usageRows(summarize([greeting]), undefined, performance);
  assert.deepEqual(rows.slice(-2), [["TPS", "100.1 tok/s"], ["TTFT", "1.9s"]]);
});

test("native history wins over buffered observations and survives reopening", () => {
  const observation = { messageID: greeting.id, sessionID: "root", started: greeting.time!.created, first: greeting.time!.firstToken! + 100 };
  const expected = historicalPerformance([greeting]);
  assert.deepEqual(historicalPerformance([greeting], [observation]), expected);
  assert.deepEqual(new PerformanceMonitor().summary([greeting], ["root"]), expected);
});

test("tree averages weight measured and estimated history by their spans, and TTFT by measurable steps", () => {
  const messages: UsageMessage[] = [
    { id: "a", type: "assistant", time: { created: 0, firstToken: 1_000, streamed: 2_000 }, tokens: { output: 100 } },
    { id: "b", type: "assistant", time: { created: 0, firstToken: 2_000, streamed: 4_000 }, tokens: { output: 20, reasoning: 80 } },
    { id: "legacy", type: "assistant", time: { created: 0, streamed: 1_000 }, tokens: { output: 20 } },
    { ...greeting, id: "compaction", type: "compaction" },
  ];
  assert.deepEqual(historicalPerformance(messages), { tps: 55, tpsEstimated: true, ttft: 1_500 });
  assert.deepEqual(historicalPerformance([...messages, concentrated, {
    id: "unmeasurable", type: "assistant", time: { created: 1_000, streamed: 1_020 }, tokens: { output: 5_000 },
  }]), { tps: 335 / 8.828, tpsEstimated: true, ttft: 2_600 });
});

test("invalid or missing first-token clocks fall back to an estimated request rate", () => {
  for (const firstToken of [undefined, NaN, Infinity, -1, 999, 2_001]) {
    const message: UsageMessage = { id: "a", type: "assistant",
      time: { created: 1_000, ...(firstToken === undefined ? {} : { firstToken }), streamed: 2_000, completed: 2_100 },
      tokens: { output: 10 } };
    assert.deepEqual(historicalPerformance([message]), { tps: 10, tpsEstimated: true });
  }
  assert.deepEqual(historicalPerformance([{ id: "a", type: "assistant",
    time: { created: 1_000, firstToken: 1_000, streamed: 2_000 }, tokens: { output: 10 } }]), { tps: 10, ttft: 0 });
});

test("a 28 ms historical delivery uses request throughput and leaves tokens and TTFT intact", () => {
  assert.equal((115 / 0.028).toFixed(1), "4107.1");
  const performance = historicalPerformance([concentrated]);
  assert.deepEqual(performance, { tps: 115 / 4.828, tpsEstimated: true, ttft: 4_800 });
  const usage = summarize([concentrated]);
  assert.equal(usage.total, 115);
  assert.deepEqual(usageRows(usage, undefined, performance).slice(-2), [["TPS", "~23.8 tok/s"], ["TTFT", "4.8s"]]);
});

test("a zero or sub-100 ms native span is an estimate when the request has usable timing", () => {
  for (const span of [0, 99]) {
    assert.deepEqual(historicalPerformance([{ ...concentrated,
      time: { created: 1_000, firstToken: 5_800, streamed: 5_800 + span },
    }]), { tps: 115 / ((4_800 + span) / 1_000), tpsEstimated: true, ttft: 4_800 });
  }
});

test("the 100 ms timing boundary does not impose a TPS cap", () => {
  for (const span of [100, 700]) {
    assert.deepEqual(historicalPerformance([{ ...concentrated, tokens: { output: 3_500, reasoning: 0 },
      time: { created: 1_000, firstToken: 5_800, streamed: 5_800 + span },
    }]), { tps: 3_500 / (span / 1_000), ttft: 4_800 });
  }
});

test("steady high-speed output keeps its historical delivery rate after reopening", t => {
  const monitor = new PerformanceMonitor();
  t.after(() => monitor.dispose());
  send(monitor, "session.step.started", 1_000, { started: 1_000 });
  send(monitor, "session.step.first-token", 5_800);
  for (const time of [5_900, 6_150, 6_400]) {
    send(monitor, "session.text.delta", time, { delta: "text ".repeat(4_000) });
  }
  assert.deepEqual(monitor.summary([], ["root"]), { tps: 20_000, tpsEstimated: true, ttft: 4_800 });
  const history: UsageMessage = { ...concentrated, id: "a", tokens: { output: 15_000 },
    time: { created: 1_000, firstToken: 5_800, streamed: 6_500, completed: 6_550 } };
  monitor.reconcile([history], ["root"]);
  const expected = { tps: 15_000 / 0.7, ttft: 4_800 };
  assert.deepEqual(monitor.summary([history], ["root"]), expected);
  assert.deepEqual(historicalPerformance([history]), expected);
});

test("missing, reversed or wholly short request timings do not manufacture historical TPS", () => {
  for (const [time, expected] of [
    [{ created: 1_000, firstToken: 1_020, completed: 5_000 }, { ttft: 20 }],
    [{ created: 1_000, firstToken: 1_020, streamed: 1_099, completed: 5_000 }, { ttft: 20 }],
    [{ created: 1_000, firstToken: 1_020, streamed: 1_500, completed: 1_400 }, { ttft: 20 }],
    [{ created: 1_000, streamed: 999 }, {}],
    [{ created: 1_000, firstToken: 1_500, completed: 1_400 }, {}],
  ] as const) {
    assert.deepEqual(historicalPerformance([{ ...concentrated, time }]), expected);
  }
});

for (const nativeFirst of [true, false]) {
  test(`native event replaces delta timing (${nativeFirst ? "native" : "delta"} arrives first)`, t => {
    const monitor = new PerformanceMonitor();
    t.after(() => monitor.dispose());
    send(monitor, "session.step.started", 1_000, { started: 1_000 });
    const native = () => send(monitor, "session.step.first-token", 2_926);
    if (nativeFirst) {
      assert.equal(native(), true);
      assert.deepEqual(monitor.summary([], ["root"]), { ttft: 1_926 }, "no bytes or TPS are invented");
    }
    send(monitor, "session.text.delta", 3_026, { delta: "a".repeat(80) });
    if (!nativeFirst) {
      assert.equal(monitor.summary([], ["root"]).ttft, 2_026);
      assert.equal(native(), true);
    }
    assert.equal(native(), false, "duplicate native event is idempotent");
    send(monitor, "session.text.delta", 3_276, { delta: "ab" });
    send(monitor, "session.text.delta", 3_526, { delta: "cd" });
    assert.deepEqual(monitor.summary([], ["root"]), { tps: 2, tpsEstimated: true, ttft: 1_926 },
      "live TPS still starts at delivered bytes, not the earlier native clock");
  });
}

for (const order of ["history first", "native first", "end first"]) {
  test(`native TTFT survives retention and historical reconciliation: ${order}`, t => {
    let now = 0;
    const monitor = new PerformanceMonitor(undefined, { monotonic: () => now, retention: 100 });
    t.after(() => monitor.dispose());
    const history: UsageMessage[] = [{ id: "a", type: "assistant", tokens: { output: 10 },
      time: { created: 1_000, firstToken: 1_200, streamed: 1_800, completed: 1_900 } }];
    send(monitor, "session.step.started", 1_000, { started: 1_000 });
    send(monitor, "session.text.delta", 1_300, { delta: "hello" });
    if (order === "history first") monitor.reconcile(history, ["root"]);
    if (order === "end first") send(monitor, "session.step.ended", 1_900);
    now = 50;
    send(monitor, "session.step.first-token", 1_200);
    if (order === "native first") send(monitor, "session.step.ended", 1_900);
    monitor.reconcile(history, ["root"]);
    assert.equal(monitor.summary(history, ["root"]).ttft, 200);
    now = order === "native first" ? 151 : 101;
    send(monitor, "noop", 2_000);
    assert.deepEqual(monitor.summary([], ["root"]), {}, "late native events do not extend retention");
    assert.equal(monitor.summary(history, ["root"]).ttft, 200, "native history remains after live state expires");
  });
}

test("retry with the same message ID replaces first-token timing and rejects old events/history", t => {
  const monitor = new PerformanceMonitor();
  t.after(() => monitor.dispose());
  send(monitor, "session.step.started", 1_000, { started: 1_000 });
  send(monitor, "session.step.first-token", 1_200);
  send(monitor, "session.text.delta", 1_300, { delta: "old" });
  send(monitor, "session.step.failed", 1_400);
  send(monitor, "session.retry.scheduled", 1_500);
  send(monitor, "session.step.started", 2_000, { started: 2_000 });
  assert.deepEqual(monitor.summary([], ["root"]), {});
  assert.equal(send(monitor, "session.step.first-token", 1_200), false);
  send(monitor, "session.step.started", 1_000, { started: 1_000 });
  send(monitor, "session.step.first-token", 2_400);
  send(monitor, "session.step.started", 2_000, { started: 2_000 });
  send(monitor, "session.text.delta", 2_500, { delta: "new" });
  const old: UsageMessage = { id: "a", type: "assistant", time: { created: 1_000, firstToken: 1_200 } };
  assert.equal(monitor.summary([old], ["root"]).ttft, 400, "new attempt replaces stale native history once");
  const current: UsageMessage = { id: "a", type: "assistant", time: { created: 2_000, firstToken: 2_400 } };
  assert.equal(historicalPerformance([current], [
    { ...payload, messageID: "a", started: 1_000, first: 1_200 },
  ]).ttft, 400, "new history rejects an observation from the previous attempt");
  assert.deepEqual(historicalPerformance([{ ...current, time: { created: 2_000 } }], [
    { ...payload, messageID: "a", started: 1_000, first: 1_200 },
  ]), {}, "old observation cannot fill missing timing in a new attempt");
});

test("native event clocks must belong to the tracked attempt", t => {
  const monitor = new PerformanceMonitor();
  t.after(() => monitor.dispose());
  assert.equal(send(monitor, "session.step.first-token", 1_200), false, "unknown start is not guessed");
  send(monitor, "session.step.started", 1_000, { started: 1_000 });
  for (const invalid of [NaN, Infinity, 999]) assert.equal(send(monitor, "session.step.first-token", invalid), false);
  send(monitor, "session.step.streamed", 1_800);
  assert.equal(send(monitor, "session.step.first-token", 1_801), false);
  assert.equal(send(monitor, "session.step.first-token", 1_200), true);
  assert.equal(monitor.summary([], ["root"]).ttft, 200);
});

test("native first-token updates the controller in memory and survives controller recreation", async t => {
  const source = new FakeSource(), events = new Events();
  source.history.set("root", []);
  let state: UsageState = { status: "loading" };
  const monitor = new PerformanceMonitor(events.subscribe);
  t.after(() => monitor.dispose());
  const create = () => new UsageController(source, events.subscribe, value => { state = value; }, 2, 100, 2, monitor);
  const controller = create();
  t.after(() => controller.dispose());
  controller.select("root");
  await until(() => state.status === "ready");
  const reads = source.reads;
  events.emit({ type: "session.step.started", created: 1_000, data: { ...payload, started: 1_000 } });
  events.emit({ type: "session.step.first-token", created: 1_200, data: payload });
  await until(() => state.performance?.ttft === 200);
  assert.equal(source.reads, reads, "first-token does not fetch history");
  events.emit({ type: "session.text.delta", created: 1_300, data: { ...payload, delta: "hello" } });
  source.history.set("root", [{ id: "a", type: "assistant", tokens: { output: 10 },
    time: { created: 1_000, firstToken: 1_200, streamed: 1_800, completed: 1_900 } }]);
  events.emit({ type: "session.step.ended", created: 1_900, data: payload });
  await until(() => state.performance?.tps === 10 / 0.6);
  assert.equal(state.performance?.ttft, 200);
  controller.dispose();
  monitor.dispose();
  const reopened = create();
  t.after(() => reopened.dispose());
  reopened.select("root");
  await until(() => state.performance?.tps === 10 / 0.6 && state.status === "ready");
  assert.equal(state.performance?.ttft, 200);
});
