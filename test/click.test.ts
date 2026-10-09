import assert from "node:assert/strict";
import { test } from "node:test";
import { createClickHandlers } from "../src/click.js";

function fixture() {
  let opens = 0, stops = 0, selected = false;
  const handlers = createClickHandlers(() => { opens++; }, () => selected);
  const event = (button = 0, x = 10, y = 2) => ({
    button, x, y, isDragging: true,
    stopPropagation: () => { stops++; },
  });
  return { handlers, event, counts: () => [opens, stops], select: () => { selected = true; } };
}

test("a plain left click opens once even when OpenTUI marks mouse-up as dragging", () => {
  const { handlers, event, counts } = fixture();
  handlers.onMouseDown(event());
  assert.deepEqual(counts(), [0, 0], "mouse-down preserves native text selection");
  handlers.onMouseUp(event());
  assert.deepEqual(counts(), [1, 1]);
  handlers.onMouseUp(event());
  assert.deepEqual(counts(), [1, 1], "a repeated release cannot reopen the dialog");
});

test("middle and right clicks never open or consume mouse-up", () => {
  for (const button of [1, 2]) {
    const { handlers, event, counts } = fixture();
    handlers.onMouseDown(event(button));
    handlers.onMouseUp(event(button));
    assert.deepEqual(counts(), [0, 0]);
    handlers.onMouseDown(event());
    handlers.onMouseUp(event(button));
    handlers.onMouseUp(event());
    assert.deepEqual(counts(), [0, 0], "a different button cancels the pending click");
  }
});

test("dragging cancels a click even when the pointer returns without selecting text", () => {
  const { handlers, event, counts } = fixture();
  handlers.onMouseDown(event());
  handlers.onMouseDrag();
  handlers.onMouseUp(event());
  assert.deepEqual(counts(), [0, 0]);
  handlers.onMouseDown(event());
  handlers.onMouseUp(event());
  assert.deepEqual(counts(), [1, 1], "a later plain click still works");
});

test("release at another cell or without a matching press does not open", () => {
  const { handlers, event, counts } = fixture();
  handlers.onMouseUp(event());
  for (const [x, y] of [[11, 2], [10, 3]]) {
    handlers.onMouseDown(event());
    handlers.onMouseUp(event(0, x, y));
    handlers.onMouseUp(event());
  }
  assert.deepEqual(counts(), [0, 0]);
});

test("selected text suppresses activation without consuming the selection event", () => {
  const { handlers, event, counts, select } = fixture();
  handlers.onMouseDown(event());
  select();
  handlers.onMouseUp(event());
  assert.deepEqual(counts(), [0, 0]);
});
