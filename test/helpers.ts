import assert from "node:assert/strict";
import type { Session, UsageSource, Page } from "../src/source.js";
import type { UsageMessage, Price } from "../src/usage.js";
import type { UsageEvent } from "../src/controller.js";

export const session = (id: string, parentID?: string): Session => ({
  id, ...(parentID ? { parentID } : {}), location: { directory: "/tmp/usage" },
});
export const message = (id: string, input = 10, type = "assistant"): UsageMessage => ({ id, type, tokens: { input } });
export const page = <T>(data: T[], next?: string): Page<T> => ({ data, cursor: next ? { next } : {} });

export class FakeSource implements UsageSource {
  sessions = new Map<string, Session>([["root", session("root")]]);
  history = new Map<string, UsageMessage[]>([["root", [message("a")]]]);
  prices: Price[] = [{ input: 2, output: 4, cache: { read: 1, write: 3 } }];
  label = "test/model";
  fail = false;
  reads = 0;
  size = 2;
  async session(id: string): Promise<Session> {
    this.reads++;
    if (this.fail) throw new Error("offline");
    const value = this.sessions.get(id);
    if (!value) throw new Error("missing session");
    return value;
  }
  async children(id: string, cursor?: string) {
    return this.slice([...this.sessions.values()].filter(s => s.parentID === id), cursor);
  }
  async messages(id: string, cursor?: string) { return this.slice(this.history.get(id) ?? [], cursor); }
  async pricing() { return { label: this.label, prices: this.prices }; }
  private slice<T>(data: T[], cursor?: string): Page<T> {
    const offset = Number(cursor ?? 0);
    return page(data.slice(offset, offset + this.size), offset + this.size < data.length ? String(offset + this.size) : undefined);
  }
}

export class Events {
  listeners = new Set<(event: UsageEvent) => void>();
  subscribe = (fn: (event: UsageEvent) => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  emit(type = "session.step.ended", sessionID = "root") { for (const fn of this.listeners) fn({ type, data: { sessionID } }); }
}

export async function until(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate() && Date.now() - start < 2000) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), "condition did not become true");
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { resolve, promise };
}
