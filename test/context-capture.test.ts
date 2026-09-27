import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import plugin from "../src/index.js";
import { ContextCapture } from "../src/context-capture.js";
import { deferred, until } from "./helpers.js";

const request = (sessionID = "root", text = "hello") => ({
  sessionID, model: { providerID: "test", id: "small" },
  system: [{ type: "text", text: "instructions" }], tools: {},
  messages: [{ role: "user", content: [{ type: "text", text }] }],
}) as unknown as SessionContext;

test("context hook caches MCP metadata, measures both operations, and orders detached writes", async () => {
  const first = deferred<void>();
  const stored = new Map<string, unknown>();
  let lists = 0, writes = 0, now = 0, clock = 0;
  const capture = new ContextCapture(
    { list: async () => { lists++; return { data: [{ name: "github" }] }; } },
    { get: async key => stored.get(key) as never, set: async (key, value) => {
      writes++;
      if (writes === 1) await first.promise;
      stored.set(key, value);
    }, remove: async key => { stored.delete(key); } },
    30_000, () => now, () => ++clock,
  );
  await capture.capture(request("root", "first"));
  await until(() => writes === 1);
  assert.equal(writes, 1);
  await capture.capture(request("root", "second longer message"));
  assert.equal(writes, 1, "the second storage write waits for the first");
  assert.equal((await capture.latest("root"))?.tokens.Messages, 6,
    "the newest estimate is available before persistence completes");
  first.resolve();
  await capture.flush();
  assert.equal(writes, 2);
  assert.equal((stored.get("context/root") as { tokens: { Messages: number } }).tokens.Messages, 6);
  assert.equal(lists, 1, "warm requests reuse the MCP catalog");
  assert.equal(capture.timings.requests, 2);
  assert.equal(capture.timings.mcpReads, 1);
  assert.equal(capture.timings.storageWrites, 2);
  assert.ok(capture.timings.mcpWaitMs > 0 && capture.timings.storageWriteMs > 0);
  now = 30_001;
  await capture.capture(request());
  await capture.flush();
  assert.equal(lists, 2, "expired metadata is refreshed");
});

test("deleting a session waits for an in-flight write and removes its durable context", async () => {
  const gate = deferred<void>();
  const stored = new Map<string, unknown>();
  const capture = new ContextCapture(
    { list: async () => ({ data: [] }) },
    { get: async key => stored.get(key) as never, set: async (key, value) => {
      await gate.promise;
      stored.set(key, value);
    }, remove: async key => { stored.delete(key); } },
  );
  await capture.capture(request());
  const removal = capture.remove("root");
  gate.resolve();
  await removal;
  assert.equal(stored.has("context/root"), false);
  assert.equal(await capture.latest("root"), undefined);
  await capture.capture(request());
  await capture.flush();
  assert.equal(stored.has("context/root"), false);
});

test("server plugin removes context records on session.deleted events", async () => {
  const stored = new Map<string, unknown>();
  let push: ((value: IteratorResult<unknown>) => void) | undefined;
  let hook: ((request: SessionContext) => Promise<void>) | undefined;
  const context = {
    mcp: { list: async () => ({ data: [] }) },
    storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); },
      remove: async (key: string) => { stored.delete(key); } },
    rpc: { register: async () => ({ dispose: async () => {} }) },
    session: { hook: async (_name: string, callback: (request: SessionContext) => Promise<void>) => {
      hook = callback;
      return { dispose: async () => {} };
    } },
    event: { subscribe: ({ signal }: { signal: AbortSignal }) => ({
      [Symbol.asyncIterator]() { return this; },
      next: () => new Promise<IteratorResult<unknown>>(resolve => {
        push = resolve;
        signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true });
      }),
    }) },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(context);
  assert.ok(hook && cleanup);
  await hook!(request());
  await until(() => stored.has("context/root"));
  push?.({ done: false, value: { type: "session.deleted", data: { sessionID: "root" } } });
  await until(() => !stored.has("context/root"));
  await cleanup!();
});
