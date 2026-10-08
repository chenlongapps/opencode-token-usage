import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import plugin from "../src/index.js";
import { ContextCapture } from "../src/context-capture.js";
import { estimateContextSources } from "../src/context-sources.js";
import { deferred, until } from "./helpers.js";

const request = (sessionID = "root", text = "hello") => ({
  sessionID, model: { providerID: "test", id: "small" },
  system: [{ type: "text", text: "instructions" }], tools: {},
  messages: [{ role: "user", content: [{ type: "text", text }] }],
}) as unknown as SessionContext;

const memoryStorage = (stored = new Map<string, unknown>()) => ({
  get: async (key: string) => stored.get(key) as never,
  set: async (key: string, value: unknown) => { stored.set(key, value); },
  remove: async (key: string) => { stored.delete(key); },
});

const toolRequest = (name: string, sessionID = "root", text = "hello") => {
  const value = request(sessionID, text);
  value.tools[name] = { description: "Read an issue", input: { type: "object" } };
  return value;
};

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

test("hanging MCP reads share a 100 ms deadline, preserve old estimates, and allow retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = estimateContextSources(request(), [], 1234);
  const stored = new Map<string, unknown>([["context/root", previous]]);
  const signals: AbortSignal[] = [];
  let lists = 0, clock = 0, completed = false;
  const capture = new ContextCapture(
    { list: (_input, options) => {
      assert.ok(options?.signal);
      signals.push(options.signal);
      lists++;
      return lists === 1 ? new Promise(() => {}) : Promise.resolve({ data: [] });
    } },
    memoryStorage(stored), undefined, undefined, () => clock,
  );
  const pending = Promise.all([capture.capture(request()), capture.capture(request("child"))])
    .then(() => { completed = true; });
  assert.equal(lists, 1, "concurrent captures share one metadata read");
  clock = 99;
  t.mock.timers.tick(99);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(signals[0]!.aborted, false);
  clock = 100;
  t.mock.timers.tick(1);
  await pending;
  await capture.flush();
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[0]!.reason.name, "TimeoutError");
  assert.equal(capture.timings.requests, 2);
  assert.equal(capture.timings.mcpWaitMs, 200);
  assert.equal(capture.timings.storageWrites, 0, "unknown metadata must not produce an estimate");
  assert.deepEqual(await capture.latest("root"), previous, "skipping does not renew the old timestamp");
  assert.equal(await capture.latest("child"), undefined);
  assert.equal(stored.size, 1);

  await capture.capture(request());
  await capture.capture(request("child"));
  await capture.flush();
  assert.equal(lists, 2, "timeout releases the read; a successful empty catalog is cached");
  assert.equal(capture.timings.storageWrites, 2);
  t.mock.timers.tick(1000);
  assert.equal(signals[1]!.aborted, false, "successful reads clear their deadline timer");
});

for (const invalidation of ["expiry", "event"] as const) {
  test(`MCP ${invalidation} timeout reuses stale names without delaying the next refresh`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const hanging = deferred<{ data: { name: string }[] }>();
    let lists = 0, now = 0;
    const capture = new ContextCapture(
      { list: () => {
        lists++;
        if (lists === 2) return hanging.promise;
        return Promise.resolve({ data: [{ name: lists === 1 ? "github" : "gitlab" }] });
      } },
      memoryStorage(), 30_000, () => now, undefined, 25,
    );
    await capture.capture(toolRequest("github_issue"));
    if (invalidation === "expiry") now = 30_001;
    else capture.invalidateMcp();
    const pending = capture.capture(toolRequest("github_issue", "root", "second longer message"));
    t.mock.timers.tick(25);
    await pending;
    await capture.flush();
    const stale = await capture.latest("root");
    assert.equal(stale?.tokens.Messages, 6, "the current request is estimated using stale metadata");
    assert.ok(stale!.tokens["MCP Tools"] > 0);
    assert.equal(stale!.tokens["System Tools"], 0);

    await capture.capture(toolRequest("gitlab_issue"));
    assert.equal(lists, 3, "stale fallback does not renew the cache TTL");
    assert.ok((await capture.latest("root"))!.tokens["MCP Tools"] > 0);
    await capture.capture(toolRequest("github_issue"));
    await capture.flush();
    assert.equal(lists, 3);
    assert.equal((await capture.latest("root"))!.tokens["MCP Tools"], 0);
    assert.ok((await capture.latest("root"))!.tokens["System Tools"] > 0);
  });
}

test("a cached empty MCP catalog remains a valid fallback after timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let lists = 0;
  const capture = new ContextCapture(
    { list: () => ++lists === 1 ? Promise.resolve({ data: [] }) : new Promise(() => {}) },
    memoryStorage(), undefined, undefined, undefined, 10,
  );
  await capture.capture(request());
  capture.invalidateMcp();
  const pending = capture.capture(request("root", "second longer message"));
  t.mock.timers.tick(10);
  await pending;
  await capture.flush();
  assert.equal((await capture.latest("root"))?.tokens.Messages, 6);
  assert.equal(capture.timings.storageWrites, 2, "empty metadata is not missing metadata");
});

for (const outcome of ["success", "failure"] as const) {
  for (const phase of ["during", "after"] as const) {
    test(`late MCP ${outcome} ${phase} a retry cannot change its cache or shared read`, async t => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const old = deferred<{ data: { name: string }[] }>();
      const fresh = deferred<{ data: { name: string }[] }>();
      const oldRead = outcome === "success" ? old.promise : old.promise.then(() => {
        throw new Error("late metadata failure");
      });
      let lists = 0;
      const capture = new ContextCapture(
        { list: () => ++lists === 1 ? oldRead : fresh.promise },
        memoryStorage(), undefined, undefined, undefined, 10,
      );
      const first = capture.capture(request());
      t.mock.timers.tick(10);
      await first;
      assert.equal(await capture.latest("root"), undefined);
      const second = capture.capture(toolRequest("fresh_issue", "child"));
      if (phase === "during") {
        old.resolve({ data: [{ name: "old" }] });
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const third = capture.capture(toolRequest("fresh_issue"));
      assert.equal(lists, 2, "the late read must not clear the retry's in-flight promise");
      fresh.resolve({ data: [{ name: "fresh" }] });
      await Promise.all([second, third]);
      assert.ok((await capture.latest("root"))!.tokens["MCP Tools"] > 0);
      assert.equal((await capture.latest("root"))!.tokens["System Tools"], 0);
      if (phase === "after") {
        old.resolve({ data: [{ name: "old" }] });
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      await capture.capture(toolRequest("fresh_issue"));
      await capture.flush();
      assert.equal(lists, 2);
      assert.equal(capture.timings.mcpReads, 2);
      assert.ok((await capture.latest("root"))!.tokens["MCP Tools"] > 0);
      assert.equal((await capture.latest("root"))!.tokens["System Tools"], 0);
    });
  }
}

test("MCP errors reuse stale names, release the shared read, and clear deadline timers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  let lists = 0;
  const capture = new ContextCapture(
    { list: (_input, options) => {
      assert.ok(options?.signal);
      signals.push(options.signal);
      lists++;
      if (lists === 2) throw new Error("synchronous metadata failure");
      if (lists === 3) return Promise.reject(new Error("asynchronous metadata failure"));
      return Promise.resolve({ data: [{ name: "github" }] });
    } },
    memoryStorage(),
  );
  await capture.capture(toolRequest("github_issue"));
  capture.invalidateMcp();
  await capture.capture(toolRequest("github_issue"));
  await capture.capture(toolRequest("github_issue"));
  await capture.capture(toolRequest("github_issue"));
  await capture.flush();
  assert.equal(lists, 4);
  assert.ok((await capture.latest("root"))!.tokens["MCP Tools"] > 0);
  t.mock.timers.tick(1000);
  assert.ok(signals.every(signal => !signal.aborted));
});

test("session removal and flush do not wait indefinitely for MCP metadata", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const metadata = deferred<{ data: { name: string }[] }>();
  const stored = new Map<string, unknown>([["context/root", estimateContextSources(request(), [], 1234)]]);
  const capture = new ContextCapture({ list: () => metadata.promise }, memoryStorage(stored));
  const pending = capture.capture(request());
  const removal = capture.remove("root");
  const flushing = capture.flush();
  t.mock.timers.tick(100);
  await Promise.all([pending, removal, flushing]);
  assert.equal(stored.has("context/root"), false);
  assert.equal(await capture.latest("root"), undefined);
  metadata.resolve({ data: [] });
  await new Promise<void>(resolve => setImmediate(resolve));
  await capture.flush();
  assert.equal(capture.timings.storageWrites, 0);
  assert.equal(stored.has("context/root"), false, "late metadata must not resurrect deleted estimates");
});

test("the server context hook returns after its MCP deadline and cleanup still completes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stored = new Map<string, unknown>();
  let signal: AbortSignal | undefined;
  let hook: ((request: SessionContext) => Promise<void>) | undefined;
  let disposed = 0;
  const context = {
    mcp: { list: (_input: unknown, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {});
    } },
    storage: memoryStorage(stored),
    rpc: { register: async () => ({ dispose: async () => { disposed++; } }) },
    session: { hook: async (_name: string, callback: (request: SessionContext) => Promise<void>) => {
      hook = callback;
      return { dispose: async () => { disposed++; } };
    } },
    event: { subscribe: async function* () {} },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(context);
  assert.ok(hook && cleanup);
  const pending = hook!(request());
  t.mock.timers.tick(100);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(stored.size, 0);
  await cleanup!();
  assert.equal(disposed, 2);
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
