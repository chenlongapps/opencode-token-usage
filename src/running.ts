const frames = ["Running.  ", "Running.. ", "Running..."] as const;

/** A presentation-only clock; padding keeps right-aligned values and summary fields still. */
export function animateRunning(publish: (label: string | undefined) => void): () => void {
  let frame = 0;
  publish(frames[frame]);
  const timer = setInterval(() => {
    frame = (frame + 1) % frames.length;
    publish(frames[frame]);
  }, 500);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    publish(undefined);
  };
}

/** Activity never replaces unavailable/stale timing or reveals a hidden zero total. */
export function withRunningIndicator(value: string | undefined, indicator?: string): string | undefined {
  return value === undefined || !indicator ? value : `${value} · ${indicator}`;
}
