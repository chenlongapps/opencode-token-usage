import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRuntime } from "../src/runtime.js";
import type { UsageMessage } from "../src/usage.js";

const input = (id: string, created: number, type = "user"): UsageMessage => ({ id, type, time: { created } });
const response = (id: string, created: number, completed?: number, finish?: string): UsageMessage => ({
  id, type: "assistant", ...(finish ? { finish } : completed === undefined ? {} : { finish: "stop" }),
  time: { created, ...(completed === undefined ? {} : { completed }) },
});
const idle = (id: string, created: number) => input(id, created, "idle");
const ready = (milliseconds: number) => ({ status: "ready", milliseconds });

test("runtime sums native turn durations, including model/tool waits but excluding idle gaps", () => {
  const history = [
    input("u1", 1_000), response("tool-step", 2_000, 5_000, "tool-calls"),
    response("a1", 6_000, 10_000), idle("idle1", 12_000),
    input("u2", 100_000), response("a2", 101_000, 104_000), idle("idle2", 106_000),
  ];
  assert.deepEqual(summarizeRuntime(history), ready(13_000));
  assert.notEqual(summarizeRuntime(history).milliseconds, 8_000, "not just the final assistant steps");
  assert.notEqual(summarizeRuntime(history).milliseconds, 104_000 - 1_000, "not session age");
  assert.notEqual(summarizeRuntime(history).milliseconds, 15_000 + 6_000, "not execution/idle timestamps");
});

test("multiple response footers and retries in one marked turn count only the final duration", () => {
  assert.deepEqual(summarizeRuntime([
    input("u", 1_000), response("a1", 2_000, 4_000),
    { ...response("retry", 5_000, 6_000, "unknown"), retry: { attempt: 1 } },
    response("a2", 8_000, 10_000), idle("idle", 11_000),
  ]), ready(9_000));
});

test("marked turns use the first input after idle, including steers and synthetic inputs", () => {
  assert.deepEqual(summarizeRuntime([
    input("u1", 1_000), response("a1", 2_000, 4_000),
    input("steer", 5_000), input("synthetic", 6_000, "synthetic"),
    response("a2", 8_000, 10_000), idle("idle1", 11_000),
    input("next-synthetic", 100_000, "synthetic"), response("a3", 102_000, 103_000), idle("idle2", 104_000),
  ]), ready(12_000));
});

test("legacy histories without idle markers use the nearest input and take one final response per turn", () => {
  assert.deepEqual(summarizeRuntime([
    input("u1", 1_000), response("a1", 2_000, 3_000), response("a2", 4_000, 8_000),
    input("u2", 100_000), response("a3", 101_000, 104_000),
    input("synthetic", 110_000, "synthetic"), response("a4", 111_000, 112_000),
  ]), ready(13_000));
});

test("the last response wins rather than the largest timestamp, matching native history order", () => {
  assert.deepEqual(summarizeRuntime([
    input("u", 1_000), response("later-time", 2_000, 10_000),
    response("last-in-history", 3_000, 8_000), idle("idle", 11_000),
  ]), ready(7_000));
});

test("without a user/synthetic input the native footer falls back to assistant creation", () => {
  assert.deepEqual(summarizeRuntime([response("a", 2_000, 5_000)]), ready(3_000));
  assert.deepEqual(summarizeRuntime([
    response("a1", 1_000, 2_000), response("a2", 3_000, 5_000), idle("idle", 6_000),
  ]), ready(2_000));
});

test("a later input cannot change the start of an already displayed footer with no earlier input", () => {
  assert.deepEqual(summarizeRuntime([
    idle("previous-idle", 0), response("a", 2_000, 5_000), input("later-input", 6_000),
  ]), ready(3_000));
});

test("completed and zero-duration turns do not depend on usage reports, models or client clocks", () => {
  assert.deepEqual(summarizeRuntime([input("u", 0), response("a", 0, 0), idle("idle", 100)]), ready(0));
  assert.deepEqual(summarizeRuntime([input("u", 10_000), response("a", 10_000, 9_000)]), ready(0),
    "native durations clamp negative differences to zero");
  const history = [input("u", 1_000), response("a", 1_500, 2_000)];
  assert.deepEqual(summarizeRuntime(history), ready(1_000));
  assert.deepEqual(summarizeRuntime(history), summarizeRuntime(history), "a fresh calculation restores the same total");
});

test("empty sessions, pending input and compaction-only turns have no native response duration", () => {
  for (const history of [
    [], [input("u", 1_000)],
    [input("u", 1_000), input("compact", 2_000, "compaction"), idle("idle", 3_000)],
  ]) assert.deepEqual(summarizeRuntime(history), ready(0));
});

test("compaction preserves older native response durations without adding compaction time", () => {
  assert.deepEqual(summarizeRuntime([
    input("u1", 1_000), response("a1", 2_000, 4_000), idle("idle1", 5_000),
    input("compact", 10_000, "compaction"), idle("idle2", 20_000),
    input("u2", 30_000), response("a2", 31_000, 32_000), idle("idle3", 33_000),
  ]), ready(5_000));
});

test("failed and interrupted native responses use their own completed timestamps", () => {
  assert.deepEqual(summarizeRuntime([
    input("u1", 1_000), { ...response("failed", 2_000, 5_000, "unknown"), error: { message: "provider error" } }, idle("idle1", 6_000),
    input("u2", 10_000), { ...response("interrupted", 11_000, 12_000), error: { message: "Step interrupted" } }, idle("idle2", 13_000),
  ]), ready(6_000));
});

test("unfinished responses are not estimated with a live clock; completion adds their native duration", () => {
  const history = [input("u1", 1_000), response("a1", 2_000, 4_000), idle("idle1", 5_000),
    input("u2", 10_000), response("a2", 11_000)];
  assert.deepEqual(summarizeRuntime(history), ready(3_000));
  history[4] = response("a2", 11_000, 15_000);
  assert.deepEqual(summarizeRuntime(history), ready(8_000));
});

test("tool-call and unknown steps without native footers are not counted separately", () => {
  assert.deepEqual(summarizeRuntime([
    input("u", 1_000), response("tool", 2_000, 4_000, "tool-calls"), response("unknown", 5_000, 7_000, "unknown"),
  ]), ready(0));
});

test("an unfinished steered response retains the previous native footer until completion replaces it", () => {
  const history = [idle("previous-idle", 0), input("u", 1_000), response("a1", 2_000, 4_000),
    input("steer", 5_000), response("a2", 6_000)];
  assert.deepEqual(summarizeRuntime(history), ready(3_000));
  history[4] = response("a2", 6_000, 10_000);
  assert.deepEqual(summarizeRuntime(history), ready(9_000), "the newer footer replaces rather than adds an overlapping duration");
});

test("forks ignore inherited inputs, responses and idle markers and start with their own turns", () => {
  const inherited = [input("u_1", 1_000), response("a_2", 2_000, 10_000), idle("idle_3", 11_000)];
  assert.deepEqual(summarizeRuntime(inherited, true), ready(0));
  assert.deepEqual(summarizeRuntime([...inherited, input("own-u", 20_000), response("own-a", 21_000, 23_000)], true), ready(3_000));
  assert.deepEqual(summarizeRuntime(inherited), ready(9_000), "ordinary session IDs are not filtered as copies");
});

test("a fork's inherited unclosed turn cannot supply the start of the fork's own response", () => {
  assert.deepEqual(summarizeRuntime([
    input("u_1", 1_000), response("a_2", 2_000, 5_000),
    input("own-u", 20_000), response("own-a", 21_000, 23_000), idle("own-idle", 24_000),
  ], true), ready(3_000));
});

test("copied idle markers retain the host's marked-turn semantics for a fork's open steered turn", () => {
  assert.deepEqual(summarizeRuntime([
    input("u_1", 1_000), response("a_2", 2_000, 5_000), idle("idle_3", 6_000),
    input("own-u", 20_000), response("own-a1", 21_000, 23_000),
    input("own-steer", 24_000), response("own-a2", 25_000, 30_000),
  ], true), ready(10_000));
});

for (const value of [NaN, Infinity, -1, 9e15]) {
  test(`invalid timestamp ${value} makes an unknown historical total unavailable, not zero`, () => {
    for (const history of [
      [input("u", value), response("a", 1_500, 2_000)],
      [input("u", 1_000), response("a", 1_500, value)],
    ]) assert.deepEqual(summarizeRuntime(history), { status: "unavailable" });
  });
}

test("missing closed-turn timestamps cannot disappear into a seemingly complete subtotal", () => {
  const known = [input("u1", 1_000), response("a1", 2_000, 4_000), idle("idle1", 5_000)];
  for (const incomplete of [
    [{ id: "u2", type: "user" }, response("a2", 11_000, 12_000)],
    [input("u2", 10_000), { id: "a2", type: "assistant" }],
    [input("u2", 10_000), response("a2", 11_000), idle("idle2", 12_000)],
    [input("u2", 10_000), response("a2", 11_000, undefined, "stop")],
    [input("u2", NaN), response("a2", 11_000)],
  ] as UsageMessage[][]) assert.deepEqual(summarizeRuntime([...known, ...incomplete]), { status: "unavailable" });
});

test("native durations are summed before formatting instead of rounding each turn", () => {
  assert.deepEqual(summarizeRuntime([
    input("u1", 1_000), response("a1", 1_100, 1_800), idle("idle1", 1_900),
    input("u2", 3_000), response("a2", 3_100, 3_800), idle("idle2", 3_900),
  ]), ready(1_600));
});
