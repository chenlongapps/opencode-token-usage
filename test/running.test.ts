import assert from "node:assert/strict";
import { test } from "node:test";
import { animateRunning, withRunningIndicator } from "../src/running.js";
import { fitUsageSummary, formatRunTime } from "../src/usage.js";

test("running dots cycle every 500ms with a fixed width", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const labels: Array<string | undefined> = [];
  const stop = animateRunning(label => labels.push(label));
  assert.deepEqual(labels, ["Running.  "]);
  t.mock.timers.tick(499);
  assert.equal(labels.length, 1);
  t.mock.timers.tick(1);
  assert.equal(labels.at(-1), "Running.. ");
  t.mock.timers.tick(500);
  assert.equal(labels.at(-1), "Running...");
  t.mock.timers.tick(500);
  assert.equal(labels.at(-1), "Running.  ");
  assert.ok(labels.every(label => label?.length === 10));
  stop();
});

test("stopping the animation removes its label and cancels future ticks", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const labels: Array<string | undefined> = [];
  const stop = animateRunning(label => labels.push(label));
  t.mock.timers.tick(500);
  stop();
  assert.deepEqual(labels, ["Running.  ", "Running.. ", undefined]);
  stop();
  t.mock.timers.tick(5_000);
  assert.equal(labels.length, 3, "cleanup is idempotent and leaves no animation clock");
});

test("restarting begins at one dot without retaining an old clock", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const labels: Array<string | undefined> = [];
  const first = animateRunning(label => labels.push(label));
  t.mock.timers.tick(500);
  first();
  const second = animateRunning(label => labels.push(label));
  assert.equal(labels.at(-1), "Running.  ");
  const before = labels.length;
  t.mock.timers.tick(500);
  assert.equal(labels.length, before + 1);
  assert.equal(labels.at(-1), "Running.. ");
  second();
});

test("activity keeps cumulative time, zero hiding and freshness independent", () => {
  for (const compact of [false, true]) {
    const runtime = { status: "ready" as const, milliseconds: 318_000 };
    const value = formatRunTime(runtime, compact);
    for (const label of ["Running.  ", "Running.. ", "Running..."]) {
      assert.equal(withRunningIndicator(value, label), `${value} · ${label}`);
      assert.deepEqual(runtime, { status: "ready", milliseconds: 318_000 });
      assert.equal(withRunningIndicator(formatRunTime({ status: "ready", milliseconds: 0 }, compact), label), undefined);
      assert.equal(withRunningIndicator(formatRunTime({ status: "unavailable" }, compact), label), `— · ${label}`);
      assert.equal(withRunningIndicator(formatRunTime({ status: "stale", milliseconds: 0 }, compact), label),
        `0s · ${compact ? "stale" : "Not updated"} · ${label}`);
    }
    assert.equal(withRunningIndicator(value), value, "idle views keep the original value");
    assert.equal(withRunningIndicator(undefined, "Running..."), undefined);
  }
});

test("animated child summaries fit one line without moving later fields", () => {
  const lines = ["Running.  ", "Running.. ", "Running..."].map(label => fitUsageSummary([
    ["Context", "—"], ["Total", "5,080"], ["Cost", "$0.005"],
    ["Time", withRunningIndicator("5m18s", label)], ["TPS", "48.7 tok/s"],
  ], 160));
  assert.equal(new Set(lines.map(line => line.indexOf("TPS"))).size, 1);
  assert.equal(new Set(lines.map(line => line.length)).size, 1);
  for (const width of [80, 48, 40, 32, 20]) {
    const narrow = ["Running.  ", "Running.. ", "Running..."].map(label => fitUsageSummary([
      ["Total", "5,080"], ["Time", withRunningIndicator("5m18s", label)], ["TPS", "48.7 tok/s"],
    ], width));
    assert.equal(new Set(narrow.map(line => line.length)).size, 1);
    for (const line of narrow) {
      assert.ok(line.length <= width);
      assert.match(line, /Time 5m18s/);
      assert.doesNotMatch(line, /\n|undefined/);
    }
  }
});
