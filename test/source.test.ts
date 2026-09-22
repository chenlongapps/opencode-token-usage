import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenCodeClient } from "@opencode/client";
import { createSource, loadSnapshot, pages, uniqueMessages, viewedMessages } from "../src/source.js";
import { modelKey, summarize } from "../src/usage.js";
import { FakeSource, message, page, session } from "./helpers.js";

test("paginated history and all descendants, same tree when viewing a grandchild", async () => {
  const source = new FakeSource();
  for (const [id, parent] of [["c1", "root"], ["c2", "root"], ["c3", "root"], ["grandchild", "c1"]]) {
    source.sessions.set(id!, session(id!, parent));
    source.history.set(id!, [message(`${id}-a`)]);
  }
  source.history.set("root", [message("before-compaction", 100), message("compaction", 20, "compaction"), message("after-compaction", 30)]);
  const root = await loadSnapshot(source, "root", new AbortController().signal);
  const child = await loadSnapshot(source, "grandchild", new AbortController().signal);
  assert.equal(child.rootID, "root");
  assert.equal(child.viewedID, "grandchild");
  assert.equal(child.sessions.size, 5);
  assert.equal(summarize(uniqueMessages(root), root.model.catalog).total, 190);
  assert.equal(summarize(uniqueMessages(child), child.model.catalog).total, 190);
  // Two root assistants plus one assistant per descendant session; compaction is not a step.
  assert.equal(summarize(uniqueMessages(root), root.model.catalog).steps, 6);
  assert.equal(summarize(uniqueMessages(child), child.model.catalog).steps, 6);
});

test("viewed messages keep API order and never include the rest of the tree", async () => {
  const source = new FakeSource();
  source.sessions.set("child", session("child", "root"));
  source.history.set("root", [message("a", 1), message("b", 2)]);
  source.history.set("child", [message("c", 3), message("d", 4)]);
  const snapshot = await loadSnapshot(source, "child", new AbortController().signal);
  assert.deepEqual(viewedMessages(snapshot).map(value => value.id), ["c", "d"]);
  assert.deepEqual(viewedMessages(await loadSnapshot(source, "root", new AbortController().signal)).map(value => value.id), ["a", "b"]);
});

test("latest snapshots replace repeated message IDs; inherited history is counted at origin", async () => {
  const source = new FakeSource();
  source.sessions.set("child", { ...session("child", "root"), fork: { sessionID: "root", boundary: { type: "through", messageID: "a" } } });
  source.history.set("root", [message("a", 10), message("a", 50)]);
  source.history.set("child", [message("a", 50), message("msg_fork_12", 50), message("new-child", 20)]);
  const snapshot = await loadSnapshot(source, "child", new AbortController().signal);
  assert.equal(snapshot.messages.get("root")?.size, 1);
  const summary = summarize(uniqueMessages(snapshot), snapshot.model.catalog);
  assert.equal(summary.total, 70);
  assert.ok(Math.abs(summary.cost - 0.00014) < 1e-12);
  // The inherited copy `msg_fork_12` is skipped, so its step stays with its origin.
  assert.equal(summary.steps, 2);
});

test("fork is a separate root; copied history is charged only to its original source", async () => {
  const source = new FakeSource();
  source.sessions.set("fork", { ...session("fork"), fork: { sessionID: "root", boundary: { type: "before", messageID: "b" } } });
  source.history.set("fork", [message("msg_fork_1", 1000), message("own", 3)]);
  const snapshot = await loadSnapshot(source, "fork", new AbortController().signal);
  assert.equal(snapshot.rootID, "fork");
  const summary = summarize(uniqueMessages(snapshot), snapshot.model.catalog);
  assert.equal(summary.total, 3);
  assert.equal(summary.cost, 0.000006);
  assert.equal(summary.steps, 1);
});

test("pagination loops, cycles, cancellation and partial page failures reject the snapshot", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(pages(async () => page([1], "same"), signal), /Repeated/);
  const source = new FakeSource();
  source.sessions.set("root", session("root", "child"));
  source.sessions.set("child", session("child", "root"));
  await assert.rejects(loadSnapshot(source, "root", signal), /Cyclic/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(pages(async () => page([1]), aborted.signal), { name: "AbortError" });
  await assert.rejects(pages(async cursor => { if (cursor) throw new Error("page failed"); return page([1], "2"); }, signal), /page failed/);
});

test("adapter uses the viewed session model/location and falls back to location default only when unselected", async () => {
  const requests: unknown[] = [];
  const model = { id: "m", providerID: "p", cost: [{ input: 9 }], limit: { context: 128_000, output: 4096 } };
  const client = { model: {
    list: async (input: unknown) => { requests.push(["list", input]); return { data: [model] }; },
    default: async (input: unknown) => { requests.push(["default", input]); return { data: model }; },
  } } as unknown as OpenCodeClient;
  const source = createSource(client);
  const signal = new AbortController().signal;
  const selected = { ...session("child"), model: { id: "m", providerID: "p" } };
  const active = await source.model(selected, signal);
  assert.equal(active.catalog.get(modelKey({ providerID: "p", id: "m" }))?.[0]?.input, 9);
  assert.equal(active.context, 128_000);
  assert.equal(active.label, "p/m");
  assert.equal((await source.model(session("root"), signal)).context, 128_000);
  const missing = await source.model({ ...selected, model: { id: "missing", providerID: "p" } }, signal);
  assert.equal(missing.catalog.get(modelKey({ providerID: "p", id: "missing" })), undefined);
  assert.equal(missing.context, undefined);
  assert.equal(missing.label, "p/missing");
  assert.deepEqual(requests, [
    ["list", { location: selected.location }],
    ["list", { location: selected.location }], ["default", { location: selected.location }],
    ["list", { location: selected.location }],
  ]);
  // Models without a runtime context limit must not break the panel.
  const unlimited = { id: "n", providerID: "p", cost: [] };
  const fallback = { model: { list: async () => ({ data: [unlimited] }) } } as unknown as OpenCodeClient;
  assert.equal((await createSource(fallback).model(selected, signal)).context, undefined);
});

test("v2 cursors carry pagination options; subsequent requests must not repeat order or filters", async () => {
  const requests: unknown[] = [];
  const client = {
    session: { list: async (input: unknown) => { requests.push(input); return page([]); } },
    message: { list: async (input: unknown) => { requests.push(input); return page([]); } },
  } as unknown as OpenCodeClient;
  const source = createSource(client), signal = new AbortController().signal;
  await source.children("root", undefined, signal);
  await source.children("root", "children-cursor", signal);
  await source.messages("root", undefined, signal);
  await source.messages("root", "messages-cursor", signal);
  assert.deepEqual(requests, [
    { parentID: "root", order: "asc", limit: 100 }, { cursor: "children-cursor" },
    { sessionID: "root", order: "asc", limit: 100 }, { sessionID: "root", cursor: "messages-cursor" },
  ]);
});
