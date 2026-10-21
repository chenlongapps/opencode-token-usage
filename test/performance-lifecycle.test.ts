import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { ACTIVITY_CHECK_MS, PerformanceMonitor } from "../src/performance.js";
import type { ReadActiveSessions } from "../src/performance.js";
import { Events, deferred } from "./helpers.js";

const remote = 1_800_000_000_000;
const retention = 1_000;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(t: TestContext, active?: ReadActiveSessions) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let monotonic = 0, sequence = 0;
  const events = new Events();
  const monitor = new PerformanceMonitor(events.subscribe, { retention, monotonic: () => monotonic, active });
  t.after(() => monitor.dispose());
  const send = (type: string, sessionID: string, data: Record<string, unknown> = {}, created = remote + monotonic + 1_000) => {
    events.emit({ type, created, id: `event-${sequence++}`, data: { sessionID, ...data } });
  };
  const start = (sessionID: string, messageID = sessionID, started = remote + monotonic) => {
    send("session.step.started", sessionID, { assistantMessageID: messageID, started }, started);
  };
  const stream = (sessionID: string, messageID = sessionID) => {
    start(sessionID, messageID);
    for (const offset of [100, 350, 600]) send("session.text.delta", sessionID, {
      assistantMessageID: messageID, delta: offset === 100 ? "a".repeat(80) : "ab",
    }, remote + monotonic + offset);
  };
  const advance = async (milliseconds: number) => {
    monotonic += milliseconds;
    t.mock.timers.tick(milliseconds);
    await flush();
  };
  return { monitor, events, send, start, stream, advance };
}

test("offscreen streams and TTFT are reclaimed without terminal events, history, readers or further events", async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return new Set(); });
  f.stream("offscreen");
  f.start("no-first-token");
  await f.advance(ACTIVITY_CHECK_MS - 1);
  assert.equal(reads, 0, "quiet-window expiry is still memory-only");
  await f.advance(1);
  assert.equal(reads, 1, "one activity read covers both sessions");
  assert.equal(f.monitor.summary([], ["offscreen"]).ttft, 100, "short retention lets views consume TTFT");
  await f.advance(retention);
  assert.deepEqual(f.monitor.summary([], ["offscreen"]), {});
  assert.equal(f.monitor["active"].size, 0, "also frees the stream and its event-ID set");
  assert.equal(f.monitor["observed"].size, 0);
  assert.equal(f.monitor["cleanupTimer"], undefined);
  await f.advance(ACTIVITY_CHECK_MS * 10);
  assert.equal(reads, 1, "an empty monitor does not poll");
});

for (const terminal of ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.idle", "session.status"]) {
  test(`${terminal} reclaims a lost step ending without touching another session`, async t => {
    const f = fixture(t);
    f.stream("offscreen");
    f.stream("tool-wait");
    f.send(terminal, "offscreen", { status: { type: "idle" } });
    assert.deepEqual(f.monitor.summary([], ["offscreen"]), { ttft: 100 });
    await f.advance(retention);
    assert.deepEqual(f.monitor.summary([], ["offscreen"]), {});
    assert.equal(f.monitor.summary([], ["tool-wait"]).ttft, 100);
    assert.equal(f.monitor["active"].size, 1);
  });
}

test("new serial steps retire superseded streams even while the session remains active", async t => {
  const f = fixture(t, async () => new Set(["root"]));
  f.stream("root", "old");
  await f.advance(1_000);
  f.stream("root", "current");
  // Replayed start and execution ending predate the current step/output.
  f.start("root", "replayed", remote);
  f.send("session.execution.succeeded", "root", {}, remote + 50);
  f.send("session.retry.scheduled", "root", { assistantMessageID: "old" }, remote + 800);
  await f.advance(retention);
  assert.equal(f.monitor["active"].size, 1);
  assert.equal(f.monitor["observed"].size, 1);
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
  await f.advance(ACTIVITY_CHECK_MS);
  f.send("session.text.delta", "root", { assistantMessageID: "current", delta: "resume" });
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
});

test("normal long tool waits retain streams and original TTFT, including streamed-only historical reconciliation", async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return new Set(["tool-wait"]); });
  f.stream("tool-wait");
  f.send("session.tool.called", "tool-wait", { assistantMessageID: "tool-wait" });
  f.send("session.step.streamed", "tool-wait", { assistantMessageID: "tool-wait" });
  const history = [{ id: "tool-wait", type: "assistant", time: { created: remote, streamed: remote + 1_000 }, tokens: { output: 20 } }];
  f.monitor.reconcile(history, ["tool-wait"]);
  for (const wait of [5 * 60_000, 60 * 60_000, 24 * 60 * 60_000]) {
    await f.advance(wait);
    assert.deepEqual(f.monitor.summary(history, ["tool-wait"]), { tps: 20, ttft: 100 });
    assert.equal(f.monitor["active"].size, 1);
    f.monitor.reconcile(history, ["tool-wait"]);
  }
  assert.equal(reads, 3);
  f.send("session.tool.success", "tool-wait", { assistantMessageID: "tool-wait" });
  f.send("session.step.ended", "tool-wait", { assistantMessageID: "tool-wait", finish: "tool-calls" });
  await f.advance(retention);
  assert.deepEqual(f.monitor.summary(history, ["tool-wait"]), { tps: 20 });
  assert.equal(f.monitor["active"].size, 0);
  assert.equal(f.monitor["cleanupTimer"], undefined);
});

test("long pre-first-token and retry waits have no hard stream lifetime", async t => {
  const f = fixture(t, async () => new Set(["slow-provider"]));
  f.start("slow-provider");
  f.send("session.retry.scheduled", "slow-provider", { assistantMessageID: "slow-provider" });
  await f.advance(24 * 60 * 60_000);
  assert.equal(f.monitor["active"].size, 1);
  assert.deepEqual(f.monitor.summary([], ["slow-provider"]), {});
  f.send("session.text.delta", "slow-provider", { assistantMessageID: "slow-provider", delta: "first" });
  assert.equal(f.monitor.summary([], ["slow-provider"]).ttft, 24 * 60 * 60_000 + 1_000);
});

test("a scheduled retry cancels failure retention and rejects stale completion history", async t => {
  const f = fixture(t, async () => new Set(["retry"]));
  f.stream("retry");
  f.send("session.step.failed", "retry", { assistantMessageID: "retry" });
  const history = [{ id: "retry", type: "assistant", time: { created: remote, completed: remote + 1_000 } }];
  f.monitor.reconcile(history, ["retry"]);
  await f.advance(100);
  f.send("session.retry.scheduled", "retry", { assistantMessageID: "retry" });
  f.monitor.reconcile(history, ["retry"]);
  await f.advance(24 * 60 * 60_000);
  assert.equal(f.monitor["active"].size, 1);
  assert.equal(f.monitor.summary([], ["retry"]).ttft, 100);
  f.send("session.text.delta", "retry", { assistantMessageID: "retry", delta: "retry output" });
  assert.equal(f.monitor.summary([], ["retry"]).ttft, 100);
});

test("one activity read reconciles staggered sessions instead of polling each deadline", async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return new Set(["root", "child"]); });
  f.stream("root");
  await f.advance(ACTIVITY_CHECK_MS / 2);
  f.stream("child");
  await f.advance(ACTIVITY_CHECK_MS / 2);
  assert.equal(reads, 1);
  await f.advance(ACTIVITY_CHECK_MS / 2);
  assert.equal(reads, 1, "the previous complete snapshot also renewed the child's check");
  await f.advance(ACTIVITY_CHECK_MS / 2);
  assert.equal(reads, 2);
});

test("reconnect reconciles all tracked trees and resets only live windows for still-running sessions", async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return new Set(["root", "offscreen-child"]); });
  for (const id of ["root", "offscreen-child", "lost-ending"]) f.stream(id);
  assert.equal(f.monitor.summary([], ["root"]).tpsEstimated, true);
  f.events.emit({ type: "server.connected", data: {} }); // The real synthetic handshake has no created.
  await flush();
  assert.equal(reads, 1);
  assert.deepEqual(f.monitor.summary([], ["offscreen-child"]), { ttft: 100 });
  await f.advance(retention);
  assert.deepEqual(f.monitor.summary([], ["lost-ending"]), {});
  assert.equal(f.monitor["active"].size, 2);
  assert.equal(f.monitor["observed"].size, 2);
  f.send("session.text.delta", "offscreen-child", { assistantMessageID: "offscreen-child", delta: "a".repeat(40_000) });
  assert.equal(f.monitor.summary([], ["offscreen-child"]).tps, undefined, "resumption needs a fresh baseline");
  await f.advance(250);
  f.send("session.text.delta", "offscreen-child", { assistantMessageID: "offscreen-child", delta: "ab" });
  assert.equal(f.monitor.summary([], ["offscreen-child"]).tps, undefined, "two batches cannot restore live TPS");
  await f.advance(250);
  f.send("session.text.delta", "offscreen-child", { assistantMessageID: "offscreen-child", delta: "ab" });
  assert.deepEqual(f.monitor.summary([], ["offscreen-child"]), { tps: 2, tpsEstimated: true, ttft: 100 });
});

test("failed reconciliation preserves quiet tools and retries later, then reclaims confirmed orphans", async t => {
  let fail = true, reads = 0;
  const f = fixture(t, async () => {
    reads++;
    if (fail) throw new Error("offline");
    return new Set();
  });
  f.stream("offscreen");
  f.monitor.reconcile([{ id: "offscreen", type: "assistant", tokens: { output: 2 } }], ["offscreen"]);
  f.events.emit({ type: "server.connected", data: {} });
  await flush();
  await f.advance(ACTIVITY_CHECK_MS);
  assert.equal(reads, 2);
  assert.equal(f.monitor["active"].size, 1);
  assert.equal(f.monitor.summary([], ["offscreen"]).ttft, 100);
  fail = false;
  await f.advance(ACTIVITY_CHECK_MS);
  await f.advance(retention);
  assert.equal(reads, 3);
  assert.equal(f.monitor["active"].size, 0);
  assert.deepEqual(f.monitor.summary([], ["offscreen"]), {});
});

for (const activity of ["session.text.delta", "session.tool.progress", "session.retry.scheduled", "session.execution.started", "session.status"]) {
  test(`a stale inactive snapshot cannot erase newer ${activity}`, async t => {
    const gate = deferred<ReadonlySet<string>>();
    const f = fixture(t, () => gate.promise);
    f.stream("root");
    f.events.emit({ type: "server.connected", data: {} });
    f.send(activity, "root", { assistantMessageID: "root", delta: "progress", status: { type: "busy" } });
    gate.resolve(new Set());
    await flush();
    await f.advance(retention);
    assert.equal(f.monitor["active"].size, 1);
    assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
  });
}

test("a step created while reconciliation is in flight is excluded from that snapshot", async t => {
  const gate = deferred<ReadonlySet<string>>();
  const f = fixture(t, () => gate.promise);
  f.stream("root", "old");
  f.events.emit({ type: "server.connected", data: {} });
  await f.advance(100);
  f.stream("root", "new");
  f.stream("new-session");
  gate.resolve(new Set());
  await flush();
  await f.advance(retention);
  assert.equal(f.monitor["active"].size, 2);
  assert.equal(f.monitor["observed"].size, 2);
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
});

test("repeated reconnect aborts previous reads and ignores late responses even if cancellation is ignored", async t => {
  const requests: Array<{ signal: AbortSignal; gate: ReturnType<typeof deferred<ReadonlySet<string>>> }> = [];
  const f = fixture(t, signal => {
    const gate = deferred<ReadonlySet<string>>();
    requests.push({ signal, gate });
    return gate.promise;
  });
  f.stream("root");
  f.events.emit({ type: "server.connected", data: {} });
  f.events.emit({ type: "server.connected", data: {} });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.signal.aborted, true);
  requests[1]!.gate.resolve(new Set(["root"]));
  await flush();
  requests[0]!.gate.resolve(new Set());
  await flush();
  await f.advance(retention);
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
  assert.equal(f.monitor["active"].size, 1);
});

test("query timeout is bounded even for an uncooperative reader and schedules recovery", async t => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 5_000);
    return deadline.signal;
  });
  let reads = 0;
  const f = fixture(t, async () => {
    if (++reads === 1) return new Promise<ReadonlySet<string>>(() => {});
    return new Set();
  });
  f.stream("root");
  f.events.emit({ type: "server.connected", data: {} });
  deadline.abort(new DOMException("Timed out", "TimeoutError"));
  await flush();
  assert.equal(f.monitor["synchronization"], undefined);
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
  t.mock.restoreAll();
  await f.advance(ACTIVITY_CHECK_MS);
  await f.advance(retention);
  assert.equal(reads, 2);
  assert.equal(f.monitor["active"].size, 0);
});

test("fresh progress after an inactive snapshot cancels reclamation, but a real ending remains terminal", async t => {
  const f = fixture(t, async () => new Set());
  f.stream("root");
  f.events.emit({ type: "server.connected", data: {} });
  await flush();
  f.monitor.reconcile([{ id: "root", type: "assistant", tokens: { output: 2 } }], ["root"]);
  f.send("session.tool.progress", "root", { assistantMessageID: "root" });
  await f.advance(retention);
  assert.equal(f.monitor.summary([], ["root"]).ttft, 100);
  assert.equal(f.monitor["active"].size, 1);
  f.events.emit({ type: "server.connected", data: {} });
  await flush();
  f.send("session.step.ended", "root", { assistantMessageID: "root" });
  f.send("session.text.delta", "root", { assistantMessageID: "root", delta: "late" });
  await f.advance(retention);
  assert.equal(f.monitor["active"].size, 0);
  assert.deepEqual(f.monitor.summary([], ["root"]), {});
});

test("terminal events during a read and duplicate endings cannot resurrect or extend retained observations", async t => {
  const gate = deferred<ReadonlySet<string>>();
  const f = fixture(t, () => gate.promise);
  let wall = 8e15;
  t.mock.method(Date, "now", () => wall);
  f.stream("root");
  f.events.emit({ type: "server.connected", data: {} });
  f.send("session.step.ended", "root", { assistantMessageID: "root" });
  gate.resolve(new Set(["root"]));
  await flush();
  await f.advance(retention / 2);
  wall -= 1_000_000;
  f.send("session.step.ended", "root", { assistantMessageID: "root" });
  f.send("session.execution.succeeded", "root");
  await f.advance(retention / 2);
  assert.equal(f.monitor["active"].size, 0);
  assert.deepEqual(f.monitor.summary([], ["root"]), {});
});

for (const dispose of [false, true]) {
  test(`${dispose ? "disposal" : "deletion"} during reconciliation leaves no state or cleanup timer`, async t => {
    const gate = deferred<ReadonlySet<string>>();
    let signal: AbortSignal | undefined, reads = 0, publications = 0;
    const f = fixture(t, current => { signal = current; reads++; return gate.promise; });
    f.monitor.listen(() => publications++);
    f.stream("root");
    f.events.emit({ type: "server.connected", data: {} });
    if (dispose) f.monitor.dispose();
    else f.send("session.deleted", "root");
    const before = publications;
    if (dispose) assert.equal(signal?.aborted, true);
    gate.resolve(new Set(["root"]));
    await flush();
    await f.advance(ACTIVITY_CHECK_MS * 3);
    assert.equal(publications, before);
    assert.equal(reads, 1);
    assert.equal(f.monitor["active"].size, 0);
    assert.equal(f.monitor["observed"].size, 0);
    assert.equal(f.monitor["cleanupTimer"], undefined);
    if (dispose) assert.equal(f.events.listeners.size, 0);
  });
}
