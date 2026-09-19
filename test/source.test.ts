import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenCodeClient } from "@opencode/client";
import { createSource, loadSnapshot, pages, uniqueMessages } from "../src/source.js";
import { summarize } from "../src/usage.js";
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
  assert.equal(child.sessions.size, 5);
  assert.equal(summarize(uniqueMessages(root)).total, 190);
  assert.equal(summarize(uniqueMessages(child)).total, 190);
});

test("latest snapshots replace repeated message IDs; inherited history is counted at origin", async () => {
  const source = new FakeSource();
  source.sessions.set("child", { ...session("child", "root"), fork: { sessionID: "root", boundary: { type: "through", messageID: "a" } } });
  source.history.set("root", [message("a", 10), message("a", 50)]);
  source.history.set("child", [message("a", 50), message("msg_fork_12", 50), message("new-child", 20)]);
  const snapshot = await loadSnapshot(source, "child", new AbortController().signal);
  assert.equal(snapshot.messages.get("root")?.size, 1);
  assert.equal(summarize(uniqueMessages(snapshot)).total, 70);
});

test("fork is a separate root; copied history is charged only to its original source", async () => {
  const source = new FakeSource();
  source.sessions.set("fork", { ...session("fork"), fork: { sessionID: "root", boundary: { type: "before", messageID: "b" } } });
  source.history.set("fork", [message("msg_fork_1", 1000), message("own", 3)]);
  const snapshot = await loadSnapshot(source, "fork", new AbortController().signal);
  assert.equal(snapshot.rootID, "fork");
  assert.equal(summarize(uniqueMessages(snapshot)).total, 3);
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
  const model = { id: "m", providerID: "p", cost: [{ input: 9 }] };
  const client = { model: {
    list: async (input: unknown) => { requests.push(["list", input]); return { data: [model] }; },
    default: async (input: unknown) => { requests.push(["default", input]); return { data: model }; },
  } } as unknown as OpenCodeClient;
  const source = createSource(client);
  const selected = { ...session("child"), model: { id: "m", providerID: "p" } };
  assert.equal((await source.pricing(selected, new AbortController().signal)).prices[0]?.input, 9);
  await source.pricing(session("root"), new AbortController().signal);
  const missing = await source.pricing({ ...selected, model: { id: "missing", providerID: "p" } }, new AbortController().signal);
  assert.deepEqual(missing.prices, []);
  assert.deepEqual(requests, [["list", { location: selected.location }], ["default", { location: selected.location }], ["list", { location: selected.location }]]);
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
