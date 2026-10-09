import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeMonitor } from "../src/runtime-monitor.js";
import type { RuntimeEvent } from "../src/runtime-monitor.js";
import plugin from "../src/index.js";
import { ContextSourceRpc } from "../src/context-rpc.js";
import type { Plugin } from "@opencode/plugin";
import { Events, deferred } from "./helpers.js";

const event = (type: string, created: number, assistantMessageID = "a", finish = "stop"): RuntimeEvent => ({
  type, created, data: { sessionID: "root", assistantMessageID, finish },
});

test("runtime clock uses server timestamps and a monotonic clock, not client epoch time", t => {
  let mono = 50;
  const monitor = new RuntimeMonitor(undefined, () => mono);
  t.after(() => monitor.dispose());
  assert.equal(monitor.now(), undefined);
  monitor.handle(event("session.step.started", 1_000));
  mono += 500;
  assert.equal(monitor.now(), 1_500);
  t.mock.method(Date, "now", () => 8e15);
  mono += 500;
  assert.equal(monitor.now(), 2_000, "epoch clock changes are irrelevant");
  monitor.handle(event("session.text.delta", 1_100));
  assert.equal(monitor.now(), 2_000, "old/duplicated timestamps do not move the projection backwards");
  mono += 500;
  assert.equal(monitor.now(), 2_500);
  monitor.handle(event("session.text.delta", 3_000));
  assert.equal(monitor.now(), 3_000, "a newer server observation can advance the anchor");
});

test("one read-only clock synchronization restores a quiet active session and releases its request", async t => {
  let mono = 0, signal: AbortSignal | undefined, reads = 0;
  const monitor = new RuntimeMonitor(undefined, () => mono);
  t.after(() => monitor.dispose());
  let publications = 0;
  monitor.listen(() => { publications++; });
  await monitor.synchronize(async input => {
    signal = input;
    reads++;
    mono = 40;
    return 100_000;
  });
  assert.equal(monitor.now(), 100_020);
  assert.equal(signal?.aborted, true);
  assert.equal(publications, 1);
  mono += 1_000;
  assert.equal(monitor.now(), 101_020);
  assert.equal(reads, 1, "ticks never repeat the RPC");
});

test("failed or invalid clock synchronization preserves unavailable clock until a live event", async t => {
  const monitor = new RuntimeMonitor(undefined, () => 0);
  t.after(() => monitor.dispose());
  await monitor.synchronize(async () => { throw new Error("RPC absent"); });
  await monitor.synchronize(async () => NaN);
  assert.equal(monitor.now(), undefined);
  for (const created of [NaN, Infinity, -1, 9e15]) monitor.handle(event("session.text.delta", created));
  assert.equal(monitor.now(), undefined);
  monitor.handle(event("session.text.delta", 10_000));
  assert.equal(monitor.now(), 10_000);
});

test("a synthetic connected envelope without created cannot fabricate a client-clock anchor", t => {
  const monitor = new RuntimeMonitor(undefined, () => 1234);
  t.after(() => monitor.dispose());
  monitor.handle({ type: "server.connected", data: {} });
  assert.equal(monitor.now(), undefined, "matches the real OpenCode 2.0.26 handshake");
  monitor.handle(event("session.text.delta", 10_000));
  assert.equal(monitor.now(), 10_000);
  monitor.handle({ type: "server.connected", data: {} });
  assert.equal(monitor.now(), undefined, "reconnection requires a fresh server anchor");
});

test("reconnection cancels an older clock read and ignores late replies after cancellation or disposal", async () => {
  const monitor = new RuntimeMonitor(undefined, () => 0);
  const old = deferred<number>();
  let signal: AbortSignal | undefined;
  const pending = monitor.synchronize(input => { signal = input; return old.promise; });
  await monitor.synchronize(async () => 10_000);
  assert.equal(signal?.aborted, true);
  old.resolve(100_000);
  await pending;
  assert.equal(monitor.now(), 10_000);
  const late = deferred<number>();
  const disposed = monitor.synchronize(() => late.promise);
  monitor.dispose();
  late.resolve(200_000);
  await disposed;
  assert.equal(monitor.now(), undefined);
});

test("server clock RPC only reads current time, without MCP reads or durable writes", async t => {
  t.mock.method(Date, "now", () => 10_000);
  let reads = 0, writes = 0;
  let methods: { clock?: () => Promise<number> } | undefined;
  const context = {
    mcp: { list: async () => { reads++; return { data: [] }; } },
    storage: { get: async () => undefined, set: async () => { writes++; }, remove: async () => {} },
    rpc: { register: async (contract: unknown, handlers: typeof methods) => {
      assert.equal(contract, ContextSourceRpc);
      methods = handlers;
      return { dispose: async () => {} };
    } },
    session: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: async function* () {} },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(context);
  assert.equal(await methods?.clock?.(), 10_000);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  await cleanup?.();
});

test("views share one 500ms ticker and releasing the final view cancels it", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let mono = 0;
  const monitor = new RuntimeMonitor(undefined, () => mono);
  t.after(() => monitor.dispose());
  monitor.handle(event("session.step.started", 1_000));
  const first: Array<number | undefined> = [], second: Array<number | undefined> = [];
  const stopFirst = monitor.tick(now => first.push(now));
  const stopSecond = monitor.tick(now => second.push(now));
  mono = 500;
  t.mock.timers.tick(500);
  assert.deepEqual(first, [1_500]);
  assert.deepEqual(second, first);
  stopFirst();
  mono = 1_000;
  t.mock.timers.tick(500);
  assert.deepEqual(first, [1_500]);
  assert.deepEqual(second, [1_500, 2_000]);
  stopSecond(); stopSecond();
  t.mock.timers.tick(10_000);
  assert.equal(second.length, 2);
});

test("terminal events suppress an outdated live snapshot but tools, retries and newer steers continue", t => {
  const monitor = new RuntimeMonitor(undefined, () => 0);
  t.after(() => monitor.dispose());
  monitor.handle(event("session.step.started", 1_000));
  monitor.handle(event("session.step.ended", 2_000, "a", "tool-calls"));
  assert.equal(monitor.canEstimate("root", "a"), true);
  monitor.handle(event("session.step.failed", 3_000));
  assert.equal(monitor.canEstimate("root", "a"), false);
  monitor.handle(event("session.retry.scheduled", 3_100));
  assert.equal(monitor.canEstimate("root", "a"), true);
  monitor.handle(event("session.step.ended", 4_000));
  assert.equal(monitor.canEstimate("root", "a"), false);
  monitor.handle(event("session.step.started", 5_000, "steer"));
  assert.equal(monitor.canEstimate("root", "a"), false, "old history waits for the new snapshot");
  assert.equal(monitor.canEstimate("root", "steer"), true);
  monitor.handle(event("session.step.ended", 4_000));
  monitor.handle(event("session.execution.succeeded", 4_100));
  assert.equal(monitor.canEstimate("root", "steer"), true, "late endings cannot stop a new step");
  monitor.handle(event("session.execution.interrupted", 6_000));
  assert.equal(monitor.canEstimate("root", "steer"), false);
  assert.equal(monitor.canEstimate("child", "child-a"), true, "parent lifecycle is session-local");
});

test("shutdown invalidates the clock; reconnection and new steps recover without stale lifecycle state", t => {
  const monitor = new RuntimeMonitor(undefined, () => 0);
  t.after(() => monitor.dispose());
  monitor.handle(event("session.step.started", 1_000));
  monitor.handle(event("session.execution.failed", 2_000));
  monitor.handle(event("global.disposed", 3_000));
  assert.equal(monitor.now(), undefined);
  monitor.handle(event("server.connected", 4_000));
  assert.equal(monitor.now(), 4_000);
  assert.equal(monitor.canEstimate("root", "new"), true);
  monitor.handle(event("session.deleted", 5_000));
  assert.equal(monitor.canEstimate("root", "new"), false);
});

test("disposing cancels ticks, unsubscribes and cannot be restarted", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const events = new Events();
  const monitor = new RuntimeMonitor(events.subscribe, () => 0);
  let publications = 0;
  monitor.listen(() => { publications++; });
  monitor.tick(() => { publications++; });
  monitor.dispose(); monitor.dispose();
  assert.equal(events.listeners.size, 0);
  events.emit(event("session.step.started", 1_000));
  monitor.handle(event("session.step.started", 1_000));
  monitor.tick(() => { publications++; });
  t.mock.timers.tick(1_000);
  assert.equal(publications, 0);
  assert.equal(monitor.now(), undefined);
});
