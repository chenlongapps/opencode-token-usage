import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estimatedLiveTps,
  historicalPerformance,
  PerformanceMonitor,
  preparePerformance,
  smoothLiveTps,
} from "../src/performance.js";
import type { PerformanceEvent } from "../src/performance.js";
import type { UsageMessage } from "../src/usage.js";

const event = (type: string, id: string, created: number, data: Record<string, unknown>): PerformanceEvent => ({
  type, id, created, data,
});

const text = (bytes: number) => "a".repeat(bytes);

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

test("a single delta exposes TTFT but no estimated TPS yet", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start-a", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  assert.equal(tracker.handle(event("session.text.delta", "delta-a", 1_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), true);
  assert.deepEqual(tracker.summary([], ["root"]), { ttft: 500 });
  tracker.dispose();
});

test("streaming tracker estimates UTF-8 deltas, de-duplicates events and aggregates active steps", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start-a", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  assert.equal(tracker.handle(event("session.text.delta", "delta-a", 1_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), true);
  assert.deepEqual(tracker.summary([], ["root", "child"]), { ttft: 500 });
  assert.equal(tracker.handle(event("session.text.delta", "delta-a", 1_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), false);
  tracker.handle(event("session.reasoning.delta", "delta-a2", 2_000, { assistantMessageID: "a", sessionID: "root", delta: "😀" }));
  // Step A now has two observable deltas: 4 + 4 bytes over 500 ms => 4 tok/s.
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 4, tpsEstimated: true, ttft: 500 });

  tracker.handle(event("session.step.started", "start-b", 1_000, { assistantMessageID: "b", sessionID: "child", started: 1_000 }));
  tracker.handle(event("session.tool.input.delta", "delta-b", 2_000, { assistantMessageID: "b", sessionID: "child", delta: "abcdefgh" }));
  // Step B has a single sample and contributes no rate yet; the tree still shows step A.
  assert.deepEqual(tracker.summary([], ["root", "child"]), { tps: 4, tpsEstimated: true, ttft: 750 });

  tracker.handle(event("session.tool.input.delta", "delta-b2", 2_500, { assistantMessageID: "b", sessionID: "child", delta: "abcdefgh" }));
  // Step B: 16 bytes over 500 ms => 8 tok/s. Weighted with step A: (4*500 + 8*500)/1000 = 6.
  assert.equal(tracker.summary([], ["root", "child"]).tps, 6);

  tracker.handle(event("session.step.streamed", "stream-a", 3_500, { assistantMessageID: "a", sessionID: "root" }));
  // Stream markers without bytes must not stretch the observable window.
  assert.equal(tracker.summary([], ["root", "child"]).tps, 6);
  tracker.handle(event("session.step.ended", "end-a", 3_600, { assistantMessageID: "a", sessionID: "root" }));
  tracker.reconcile([
    { id: "a", type: "assistant", time: { created: 1_000, streamed: 2_500 }, tokens: { output: 15 } },
  ], ["root", "child"]);
  const completed = { id: "a", type: "assistant", time: { created: 1_000, streamed: 2_500 }, tokens: { output: 15 } } as UsageMessage;
  const live = tracker.summary([completed], ["root", "child"]);
  // Step B is still streaming, so its windowed estimate replaces the completed value.
  assert.equal(live.tps, 8);
  assert.equal(live.tpsEstimated, true);
  assert.equal(live.ttft, 750);
  tracker.dispose();
});

test("pre-first-token waiting does not dilute live TPS", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 0, { assistantMessageID: "a", sessionID: "root", started: 0 }));
  tracker.handle(event("session.text.delta", "first", 10_000, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  tracker.handle(event("session.text.delta", "second", 11_000, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  const summary = tracker.summary([], ["root"]);
  // Visible stream only: 800 bytes => 200 tokens over 1 s. The old
  // started-based average would have reported ~18.2 tok/s.
  assert.equal(summary.tps, 200);
  assert.equal(summary.tpsEstimated, true);
  assert.equal(summary.ttft, 10_000);
  tracker.dispose();
});

test("live TPS changes leave TTFT semantics untouched", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "first", 3_500, { assistantMessageID: "a", sessionID: "root", delta: "abcd" }));
  tracker.handle(event("session.text.delta", "second", 4_000, { assistantMessageID: "a", sessionID: "root", delta: "efgh" }));
  const summary = tracker.summary([], ["root"]);
  assert.equal(summary.ttft, 2_500);
  assert.equal(summary.tps, 4);
  tracker.dispose();
});

test("sliding window drops samples older than two seconds", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 0, { assistantMessageID: "a", sessionID: "root", started: 0 }));
  tracker.handle(event("session.text.delta", "t0", 0, { assistantMessageID: "a", sessionID: "root", delta: text(100) }));
  tracker.handle(event("session.text.delta", "t1", 1_000, { assistantMessageID: "a", sessionID: "root", delta: text(100) }));
  assert.equal(tracker.summary([], ["root"]).tps, 50);
  tracker.handle(event("session.text.delta", "t2", 4_000, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  assert.equal(tracker.summary([], ["root"]).tps, undefined, "one remaining sample cannot expose the cached rate");
  tracker.handle(event("session.text.delta", "t3", 5_000, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  // Only the last two samples remain: 800 bytes => 200 tokens over 1 s, eased from 50.
  const summary = tracker.summary([], ["root"]);
  assert.equal(summary.tps, 50 * 0.65 + 200 * 0.35);
  tracker.dispose();
});

test("fast recent output quickly replaces an old slow average", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 0, { assistantMessageID: "a", sessionID: "root", started: 0 }));
  for (let i = 0; i < 5; i++) {
    tracker.handle(event("session.text.delta", `slow-${i}`, i * 1_000, { assistantMessageID: "a", sessionID: "root", delta: "abcd" }));
  }
  tracker.handle(event("session.text.delta", "fast-1", 5_000, { assistantMessageID: "a", sessionID: "root", delta: text(120) }));
  tracker.handle(event("session.text.delta", "fast-2", 6_000, { assistantMessageID: "a", sessionID: "root", delta: text(120) }));
  tracker.handle(event("session.text.delta", "fast-3", 7_000, { assistantMessageID: "a", sessionID: "root", delta: text(120) }));
  const summary = tracker.summary([], ["root"]);
  assert.ok(summary.tps !== undefined && summary.tps > 25, `expected fast window, got ${summary.tps}`);
  tracker.dispose();
});

test("completed provider usage replaces the live estimate", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "live", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "first", 1_200, { assistantMessageID: "live", sessionID: "root", delta: "abcd" }));
  tracker.handle(event("session.text.delta", "second", 1_400, { assistantMessageID: "live", sessionID: "root", delta: "efgh" }));
  const live = tracker.summary([], ["root"]);
  assert.equal(live.tpsEstimated, true);
  assert.ok(live.tps !== undefined && live.tps > 0);
  tracker.handle(event("session.step.ended", "end", 1_900, { assistantMessageID: "live", sessionID: "root" }));
  const history: UsageMessage[] = [{ id: "live", type: "assistant", time: { created: 1_000, streamed: 2_000 },
    tokens: { output: 20, reasoning: 10 } }];
  tracker.reconcile(history, ["root"]);
  const completed = tracker.summary(history, ["root"]);
  assert.equal(completed.tps, 30);
  assert.equal(completed.tpsEstimated, undefined);
  tracker.dispose();
});

test("concurrent steps keep independent windows and aggregate within one tree", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start-root", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "root-1", 1_000, { assistantMessageID: "a", sessionID: "root", delta: text(40) }));
  tracker.handle(event("session.text.delta", "root-2", 1_500, { assistantMessageID: "a", sessionID: "root", delta: text(40) }));
  tracker.handle(event("session.step.started", "start-child", 1_000, { assistantMessageID: "b", sessionID: "child", started: 1_000 }));
  tracker.handle(event("session.text.delta", "child-1", 1_000, { assistantMessageID: "b", sessionID: "child", delta: text(80) }));
  tracker.handle(event("session.text.delta", "child-2", 1_500, { assistantMessageID: "b", sessionID: "child", delta: text(80) }));
  // Root: 80 bytes => 20 tokens / 0.5 s = 40. Child: 160 bytes => 40 / 0.5 = 80.
  assert.equal(tracker.summary([], ["root"]).tps, 40);
  assert.equal(tracker.summary([], ["child"]).tps, 80);
  assert.equal(tracker.summary([], ["root", "child"]).tps, 60);
  assert.deepEqual(tracker.summary([], ["other"]), {});

  tracker.handle(event("session.text.delta", "root-3", 2_000, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  // Root eases from 40 toward 120. Child keeps its cached 80 over a shorter window.
  assert.equal(tracker.summary([], ["root"]).tps, 68);
  assert.equal(tracker.summary([], ["child"]).tps, 80);
  assert.equal(tracker.summary([], ["root", "child"]).tps, 72);

  tracker.handle(event("session.text.delta", "child-3", 2_000, { assistantMessageID: "b", sessionID: "child", delta: text(80) }));
  // Only child advances (80 -> 73); both windows now span one second.
  assert.equal(tracker.summary([], ["child"]).tps, 73);
  assert.equal(tracker.summary([], ["root", "child"]).tps, 70.5);
  assert.equal(tracker.summary([], ["root"]).tps, 68);

  tracker.handle({ type: "session.deleted", data: { sessionID: "child" } });
  assert.equal(tracker.summary([], ["root", "child"]).tps, 68);
  tracker.dispose();
});

test("monitor captures every tree while summaries remain scoped to explicit session sets", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "other-start", 0, { assistantMessageID: "other", sessionID: "other", started: 0 }));
  tracker.handle(event("session.text.delta", "other-delta-1", 100, { assistantMessageID: "other", sessionID: "other", delta: "xxxx" }));
  tracker.handle(event("session.text.delta", "other-delta-2", 300, { assistantMessageID: "other", sessionID: "other", delta: "xxxx" }));
  assert.deepEqual(tracker.summary([], ["root"]), {});
  assert.deepEqual(tracker.summary([], ["other"]), { tps: 10, tpsEstimated: true, ttft: 100 });

  tracker.handle(event("session.step.started", "child-start", 0, { assistantMessageID: "child-message", sessionID: "child", started: 0 }));
  tracker.handle(event("session.text.delta", "child-delta-1", 250, { assistantMessageID: "child-message", sessionID: "child", delta: "xxxx" }));
  tracker.handle(event("session.text.delta", "child-delta-2", 500, { assistantMessageID: "child-message", sessionID: "child", delta: "xxxxxxxx" }));
  // Child: 12 bytes => 3 tokens / 0.25 s = 12.
  assert.equal(tracker.summary([], ["root", "child"]).tps, 12);
  assert.deepEqual(tracker.summary([], ["other"]), { tps: 10, tpsEstimated: true, ttft: 100 });

  tracker.handle({ type: "session.deleted", data: { sessionID: "other" } });
  assert.deepEqual(tracker.summary([], ["other"]), {});
  assert.equal(tracker.summary([], ["root", "child"]).tps, 12);
  tracker.dispose();
});

test("duplicate event IDs count once", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  assert.equal(tracker.handle(event("session.text.delta", "dup", 1_200, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), true);
  assert.equal(tracker.handle(event("session.text.delta", "dup", 1_200, { assistantMessageID: "a", sessionID: "root", delta: "abcd" })), false);
  tracker.handle(event("session.text.delta", "next", 1_400, { assistantMessageID: "a", sessionID: "root", delta: "efgh" }));
  // Only two unique 4-byte deltas: 8 bytes => 2 tokens / 0.2 s = 10.
  assert.equal(tracker.summary([], ["root"]).tps, 10);
  tracker.dispose();
});

test("unicode deltas use UTF-8 bytes without claiming tokenizer precision", () => {
  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "en", 1_000, { assistantMessageID: "a", sessionID: "root", delta: "abcd" }));
  tracker.handle(event("session.text.delta", "zh", 1_200, { assistantMessageID: "a", sessionID: "root", delta: "中文" }));
  tracker.handle(event("session.reasoning.delta", "emoji", 1_400, { assistantMessageID: "a", sessionID: "root", delta: "😀" }));
  tracker.handle(event("session.tool.input.delta", "code", 1_600, { assistantMessageID: "a", sessionID: "root", delta: '{"a":1}' }));
  const summary = tracker.summary([], ["root"]);
  // Raw UTF-8 rates are 12.5, 8.75, 8.75; each new sample advances smoothing once.
  assert.equal(summary.tps, (12.5 * 0.65 + 8.75 * 0.35) * 0.65 + 8.75 * 0.35);
  assert.equal(summary.tpsEstimated, true);
  tracker.dispose();
});

test("EWMA smoothing advances only for new samples, never summary reads", () => {
  assert.equal(estimatedLiveTps([]), undefined);
  assert.equal(estimatedLiveTps([{ time: 1_000, bytes: 4 }]), undefined);
  assert.equal(estimatedLiveTps([{ time: 1_000, bytes: 4 }, { time: 1_000, bytes: 4 }]), undefined);
  assert.equal(smoothLiveTps(undefined, 20), 20);
  assert.equal(smoothLiveTps(20, 80), 20 * 0.65 + 80 * 0.35);

  const tracker = new PerformanceMonitor();
  tracker.handle(event("session.step.started", "start", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }));
  tracker.handle(event("session.text.delta", "first", 1_000, { assistantMessageID: "a", sessionID: "root", delta: text(40) }));
  tracker.handle(event("session.text.delta", "second", 2_000, { assistantMessageID: "a", sessionID: "root", delta: text(40) }));
  assert.equal(tracker.summary([], ["root"]).tps, 20);
  tracker.handle(event("session.text.delta", "third", 2_500, { assistantMessageID: "a", sessionID: "root", delta: text(400) }));
  // Raw jumps to 80; the displayed value eases toward it.
  const prepared = preparePerformance([]);
  const expected = { tps: 41, tpsEstimated: true, ttft: 0 };
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(tracker.summary([], ["root"]), expected);
    assert.deepEqual(tracker.summaryPrepared(prepared, ["root"]), expected);
  }
  assert.equal(tracker.handle(event("session.text.delta", "third", 2_500, { assistantMessageID: "a", sessionID: "root", delta: text(400) })), false);
  assert.equal(tracker.handle(event("session.text.delta", "empty", 2_750, { assistantMessageID: "a", sessionID: "root", delta: "" })), false);
  tracker.handle(event("session.step.streamed", "streamed", 3_000, { assistantMessageID: "a", sessionID: "root" }));
  assert.deepEqual(tracker.summaryPrepared(prepared, ["root"]), expected);

  tracker.handle(event("session.text.delta", "fourth", 3_000, { assistantMessageID: "a", sessionID: "root", delta: text(160) }));
  // The new window is still 80 tok/s raw; only this new sample advances EWMA.
  assert.equal(tracker.summary([], ["root"]).tps, 41 * 0.65 + 80 * 0.35);
  assert.equal(tracker.summaryPrepared(prepared, ["root"]).tps, 41 * 0.65 + 80 * 0.35);
  tracker.dispose();
});

test("live TPS is independent of summary read frequency, including no readers", t => {
  const stream = [
    event("session.step.started", "start", 1_000, { assistantMessageID: "a", sessionID: "root", started: 1_000 }),
    event("session.text.delta", "first", 1_000, { assistantMessageID: "a", sessionID: "root", delta: text(40) }),
    event("session.reasoning.delta", "second", 2_000, { assistantMessageID: "a", sessionID: "root", delta: text(40) }),
    event("session.tool.input.delta", "third", 2_500, { assistantMessageID: "a", sessionID: "root", delta: text(400) }),
  ];
  const prepared = preparePerformance([]);
  for (const reads of [0, 1, 3]) {
    const tracker = new PerformanceMonitor();
    t.after(() => tracker.dispose());
    for (const sample of stream) {
      tracker.handle(sample);
      for (let i = 0; i < reads; i++) {
        tracker.summary([], ["root"]);
        tracker.summaryPrepared(prepared, ["root"]);
      }
    }
    assert.deepEqual(tracker.summaryPrepared(prepared, ["root"]), { tps: 41, tpsEstimated: true, ttft: 0 }, `${reads} reads per event`);
  }
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
  tracker.handle(event("session.text.delta", "delta-2", 1_400, { assistantMessageID: "live", sessionID: "root", delta: "efgh" }));
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
  // Two visible deltas only: 8 bytes => 2 tokens / 0.2 s = 10.
  assert.deepEqual(tracker.summary(early, ["root"]), { tps: 10, tpsEstimated: true, ttft: 200 });
  now += 60;
  tracker.handle({ type: "noop", data: {} });
  assert.equal(tracker.summary(early, ["root"]).ttft, 200, "the early fallback expiry was cancelled");
  tracker.dispose();
});
