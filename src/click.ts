import type { MouseEvent } from "@opentui/core";

type ClickEvent = Pick<MouseEvent, "button" | "x" | "y" | "stopPropagation">;

/** Text mouse-up can be marked isDragging even for a plain click by OpenTUI selection. */
export function createClickHandlers(open: () => void, hasSelection: () => boolean) {
  let pressed: { x: number; y: number } | undefined;
  return {
    onMouseDown(event: ClickEvent) {
      pressed = event.button === 0 ? { x: event.x, y: event.y } : undefined;
    },
    onMouseDrag() {
      pressed = undefined;
    },
    onMouseUp(event: ClickEvent) {
      const start = pressed;
      pressed = undefined;
      if (event.button !== 0 || !start || event.x !== start.x || event.y !== start.y || hasSelection()) return;
      event.stopPropagation();
      open();
    },
  };
}
