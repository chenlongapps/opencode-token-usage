import type { SessionContext } from "@opencode/plugin/promise/session";
import type { Plugin } from "@opencode/plugin";
import { estimateContextSources, parseContextSources } from "./context-sources.js";
import type { ContextSources } from "./context-sources.js";

type Request = Pick<SessionContext, "sessionID" | "model" | "system" | "messages" | "tools">;
type Mcp = {
  list(...args: Parameters<Plugin.Context["mcp"]["list"]>): Promise<{ data: readonly { name: string }[] }>;
};
type Storage = Pick<Plugin.Context["storage"], "get" | "set" | "remove">;

/** MCP metadata waits are bounded; persistence never delays the model request. */
export class ContextCapture {
  private names: readonly string[] | undefined;
  private expiresAt = 0;
  private listing: Promise<readonly string[] | undefined> | undefined;
  private writes = new Map<string, Promise<void>>();
  private inflight = new Map<string, Set<Promise<void>>>();
  private latestEstimate = new Map<string, ContextSources>();
  private deleted = new Set<string>();
  readonly timings = { requests: 0, mcpReads: 0, mcpWaitMs: 0, storageWrites: 0, storageWriteMs: 0 };

  constructor(
    private readonly mcp: Mcp,
    private readonly storage: Storage,
    private readonly ttl = 30_000,
    private readonly now = Date.now,
    private readonly elapsed = () => performance.now(),
    private readonly mcpTimeoutMs = 100,
  ) {}

  private async servers(): Promise<readonly string[] | undefined> {
    if (this.names && this.now() < this.expiresAt) return this.names;
    if (!this.listing) {
      this.timings.mcpReads++;
      this.listing = this.readServers().finally(() => { this.listing = undefined; });
    }
    return this.listing;
  }

  private async readServers(): Promise<readonly string[] | undefined> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException("MCP metadata read timed out", "TimeoutError");
          reject(error);
          controller.abort(error);
        }, this.mcpTimeoutMs);
      });
      const result = await Promise.race([this.mcp.list(undefined, { signal: controller.signal }), timeout]);
      // Only the bounded read may update the cache, even if cancellation is ignored.
      this.names = result.data.map(server => server.name);
      this.expiresAt = this.now() + this.ttl;
      return this.names;
    } catch {
      // Reuse stale metadata without renewing it, so the next request can retry.
      return this.names;
    } finally {
      clearTimeout(timer);
    }
  }

  invalidateMcp() { this.expiresAt = 0; }

  capture(request: Request): Promise<void> {
    const tasks = this.inflight.get(request.sessionID) ?? new Set<Promise<void>>();
    this.inflight.set(request.sessionID, tasks);
    const task = this.record(request);
    tasks.add(task);
    return task.finally(() => {
      tasks.delete(task);
      if (tasks.size === 0) this.inflight.delete(request.sessionID);
    });
  }

  private async record(request: Request): Promise<void> {
    if (this.deleted.has(request.sessionID)) return;
    const start = this.elapsed();
    let names: readonly string[] | undefined;
    try { names = await this.servers(); }
    finally {
      this.timings.requests++;
      this.timings.mcpWaitMs += this.elapsed() - start;
    }
    if (!names || this.deleted.has(request.sessionID)) return;
    const value = estimateContextSources(request, names);
    this.latestEstimate.set(request.sessionID, value);
    const previous = this.writes.get(request.sessionID) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (this.deleted.has(request.sessionID)) return;
      const started = this.elapsed();
      this.timings.storageWrites++;
      try {
        await this.storage.set(`context/${request.sessionID}`, {
          capturedAt: value.capturedAt, model: value.model, tokens: { ...value.tokens },
        });
      } finally {
        this.timings.storageWriteMs += this.elapsed() - started;
      }
    });
    this.writes.set(request.sessionID, write);
    void write.catch(() => {}).finally(() => {
      if (this.writes.get(request.sessionID) === write) this.writes.delete(request.sessionID);
    });
  }

  async latest(sessionID: string): Promise<ContextSources | undefined> {
    if (this.deleted.has(sessionID)) return undefined;
    return this.latestEstimate.get(sessionID)
      ?? parseContextSources(await this.storage.get(`context/${sessionID}`));
  }

  async remove(sessionID: string): Promise<void> {
    this.deleted.add(sessionID);
    if (this.deleted.size > 256) this.deleted.delete(this.deleted.values().next().value!);
    this.latestEstimate.delete(sessionID);
    await Promise.allSettled(this.inflight.get(sessionID) ?? []);
    await this.writes.get(sessionID)?.catch(() => {});
    await this.storage.remove(`context/${sessionID}`);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.inflight.values()].flatMap(tasks => [...tasks]));
    await Promise.allSettled(this.writes.values());
  }
}
