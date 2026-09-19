import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageController } from "../src/controller.js";
import type { UsageState } from "../src/controller.js";
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
