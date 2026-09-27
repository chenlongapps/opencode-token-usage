import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalPerformance, PerformanceMonitor } from "../src/performance.js";
import type { PerformanceEvent } from "../src/performance.js";
import type { UsageMessage } from "../src/usage.js";

const event = (type: string, id: string, created: number, data: Record<string, unknown>): PerformanceEvent => ({
  type, id, created, data,
});

test("completed TPS weights generated tokens by total provider streaming duration", () => {
  const messages: UsageMessage[] = [
    { id: "a", type: "assistant", time: { created: 1_000, streamed: 3_000 }, tokens: { output: 80, reasoning: 20 } },
    { id: "b", type: "assistant", time: { created: 4_000, streamed: 5_000 }, tokens: { output: 20, reasoning: 30 } },
    { id: "compaction", type: "compaction", time: { created: 0, streamed: 1_000 }, tokens: { output: 9_999 } },
    { id: "zero", type: "assistant", time: { created: 5_000, streamed: 6_000 }, tokens: { output: 0 } },
    { id: "invalid", type: "assistant", time: { created: 8_000, streamed: 7_000 }, tokens: { output: 100 } },
  ];
  assert.equal(historicalPerformance(messages).tps, 50);
  assert.equal(historicalPerformance([{ id: "missing", type: "assistant", tokens: { output: 10 } }]).tps, undefined);
});

test("TTFT averages only measurable first output and runtime observations override history", () => {
  const messages: UsageMessage[] = [
    { id: "reasoning", type: "assistant", time: { created: 1_000 }, content: [
      { type: "reasoning", text: "thinking", time: { created: 1_300 } },
    ] },
    { id: "tool", type: "assistant", time: { created: 2_000 }, content: [
      { type: "tool", time: { created: 2_700 } },
    ] },
    { id: "plain-text", type: "assistant", time: { created: 3_000 }, content: [
      { type: "text", text: "answer" },
      { type: "reasoning", text: "later", time: { created: 3_900 } },
    ] },
    { id: "bad-clock", type: "assistant", time: { created: 5_000 }, content: [
      { type: "reasoning", text: "bad", time: { created: 4_000 } },
    ] },
  ];
  assert.equal(historicalPerformance(messages).ttft, 500);
  assert.equal(historicalPerformance(messages, [
    { messageID: "reasoning", sessionID: "root", started: 1_000, first: 1_100 },
    { messageID: "live", sessionID: "root", started: 6_000, first: 6_400 },
  ]).ttft, 400);
  assert.equal(historicalPerformance([{ id: "text", type: "assistant", time: { created: 0 }, content: [{ type: "text", text: "x" }] }]).ttft, undefined);
});

test("streaming tracker estimates UTF-8 deltas, de-duplicates events and aggregates active steps", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start-a", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  assert.equal(tracker.handle(event("session.text.delta", "delta-a", 1_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), true);
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 2, tpsEstimated: true, ttft: 500 });
  assert.equal(tracker.handle(event("session.text.delta", "delta-a", 1_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), false);
  tracker.handle(event("session.reasoning.delta", "delta-a2", 2_000, { assistantMessageID: "a", sessionID: "root", delta: "😀" }));

  tracker.handle(event("session.step.started", "start-b", 1_000, { assistantMessageID: "b", sessionID: "child", started: 1_000 }));
  tracker.handle(event("session.tool.input.delta", "delta-b", 2_000, { assistantMessageID: "b", sessionID: "child", delta: "abcdefgh" }));
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 2, tpsEstimated: true, ttft: 750 });

  tracker.handle(event("session.step.streamed", "stream-a", 2_500, { assistantMessageID: "a", sessionID: "root" }));
  assert.equal(tracker.summary([], ["root", "child"]).tps, 1.6);
  tracker.handle(event("session.step.ended", "end-a", 2_600, { assistantMessageID: "a", sessionID: "root" }));
  tracker.reconcile([{ id: "a", type: "assistant", time: { created: 1_000, streamed: 2_500 }, tokens: { output: 15 } }], ["root", "child"]);
  assert.deepEqual(tracker.summary([{ id: "a", type: "assistant", time: { created: 1_000, streamed: 2_500 }, tokens: { output: 15 } }], ["root", "child"]), {
    tps: 2, tpsEstimated: true, ttft: 750,
  });
  tracker.dispose();
});

test("monitor captures every tree while summaries remain scoped to explicit session sets", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "other-start", 0, { assistantMessageID: "other", sessionID: "other", started: 0 }));
  tracker.handle(event("session.text.delta", "other-delta", 100, { assistantMessageID: "other", sessionID: "other", delta: "xxxx" }));
  assert.deepEqual(tracker.summary([], ["root"]), {});
  assert.deepEqual(tracker.summary([], ["other"]), { tps: 10, tpsEstimated: true, ttft: 100 });

  tracker.handle(event("session.step.started", "child-start", 0, { assistantMessageID: "child-message", sessionID: "child", started: 0 }));
  tracker.handle(event("session.text.delta", "child-delta", 250, { assistantMessageID: "child-message", sessionID: "child", delta: "xxxx" }));
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 4, tpsEstimated: true, ttft: 250 });
  assert.deepEqual(tracker.summary([], ["other"]), { tps: 10, tpsEstimated: true, ttft: 100 });

  tracker.handle({ type: "session.deleted", data: { sessionID: "other" } });
  assert.deepEqual(tracker.summary([], ["other"]), {});
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 4, tpsEstimated: true, ttft: 250 });
  tracker.dispose();
});

for (const order of ["snapshot first", "end first"] as const) {
  test(`TTFT expires after ${order} without losing the live sample`, () => {
    let now = 10_000;
    const tracker = new PerformanceMonitor(undefined, 100, () => now);
    const history: UsageMessage[] = [{ id: "live", type: "assistant", time: { created: 1_000, streamed: 1_800 },
      tokens: { output: 8 }, content: [{ type: "text", text: "answer" }] }];
    tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "live", sessionID: "root", started: 1_000 }));
    tracker.handle(event("session.text.delta", "delta", 1_200, { assistantMessageID: "live", sessionID: "root", delta: "answer" }));
    tracker.handle(event("session.step.streamed", "streamed", 1_800, { assistantMessageID: "live", sessionID: "root" }));
    assert.equal(tracker.summary([], ["root"]).ttft, 200);
    if (order === "snapshot first") tracker.reconcile(history, ["root"]);
    tracker.handle(event("session.step.ended", "end", 1_900, { assistantMessageID: "live", sessionID: "root" }));
    if (order === "end first") tracker.reconcile(history, ["root"]);
    assert.deepEqual(tracker.summary(history, ["root"]), { tps: 10, ttft: 200 });
    now += 101;
    tracker.handle({ type: "noop", data: {} });
    assert.deepEqual(tracker.summary(history, ["root"]), { tps: 10 });
    tracker.dispose();
  });
}

test("a represented stream without an end event also expires", () => {
  let now = 10_000;
  const tracker = new PerformanceMonitor(undefined, 100, () => now);
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "live", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "delta", 1_200, { assistantMessageID: "live", sessionID: "root", delta: "abcd" }));
  tracker.handle(event("session.step.streamed", "streamed", 1_800, { assistantMessageID: "live", sessionID: "root" }));
  const history: UsageMessage[] = [{ id: "live", type: "assistant", time: { created: 1_000, streamed: 1_800 }, tokens: { output: 8 } }];
  tracker.reconcile(history, ["root"]);
  assert.deepEqual(tracker.summary(history, ["root"]), { tps: 10, ttft: 200 });
  now += 101;
  tracker.handle({ type: "noop", data: {} });
  assert.deepEqual(tracker.summary(history, ["root"]), { tps: 10 });
  tracker.dispose();
});

test("a delta after an early snapshot restores live TPS and retains TTFT", () => {
  let now = 10_000;
  const tracker = new PerformanceMonitor(undefined, 100, () => now);
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "live", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "first", 1_200, { assistantMessageID: "live", sessionID: "root", delta: "abcd" }));
  const early: UsageMessage[] = [{ id: "live", type: "assistant", tokens: { output: 1 } }];
  tracker.reconcile(early, ["root"]);
  assert.deepEqual(tracker.summary(early, ["root"]), { ttft: 200 });
  now += 50;
  tracker.handle(event("session.text.delta", "second", 1_400, { assistantMessageID: "live", sessionID: "root", delta: "efgh" }));
  assert.deepEqual(tracker.summary(early, ["root"]), { tps: 5, tpsEstimated: true, ttft: 200 });
  now += 60;
  tracker.handle({ type: "noop", data: {} });
  assert.equal(tracker.summary(early, ["root"]).ttft, 200, "the early fallback expiry was cancelled");
  tracker.dispose();
});
