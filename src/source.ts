import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { modelKey } from "./usage.js";
import type { PriceCatalog, UsageMessage } from "./usage.js";

export type Session = Pick<SessionInfo, "id" | "parentID" | "fork" | "model" | "location">;
export interface Page<T> { data: T[]; cursor: { next?: string | null; previous?: string | null } }
/** Active model of the viewed session plus the location's current resolved price catalog. */
export interface ActiveModel {
  label: string;
  catalog: PriceCatalog;
  context?: number | undefined;
}
export interface UsageSource {
  session(id: string, signal: AbortSignal): Promise<Session>;
  children(id: string, cursor: string | undefined, signal: AbortSignal): Promise<Page<Session>>;
  messages(id: string, cursor: string | undefined, signal: AbortSignal): Promise<Page<UsageMessage>>;
  model(session: Session, signal: AbortSignal): Promise<ActiveModel>;
}

export function createSource(client: OpenCodeClient): UsageSource {
  return {
    session: (sessionID, signal) => client.session.get({ sessionID }, { signal }),
    children: (parentID, cursor, signal) => client.session.list(cursor ? { cursor } : { parentID, order: "asc", limit: 100 }, { signal }),
    // Unlike session.context(), message.list() includes pre-compaction history.
    messages: (sessionID, cursor, signal) => client.message.list(cursor ? { sessionID, cursor } : { sessionID, order: "asc", limit: 100 }, { signal }),
    async model(session, signal) {
      const input = { location: session.location };
      const selected = session.model;
      const models = (await client.model.list(input, { signal })).data;
      const model = selected
        ? models.find(m => m.providerID === selected.providerID && m.id === selected.id)
        : (await client.model.default(input, { signal })).data ?? undefined;
      const catalog = new Map(models.map(value => [modelKey(value), value.cost] as const));
      if (model && !catalog.has(modelKey(model))) catalog.set(modelKey(model), model.cost);
      return {
        label: model ? `${model.providerID}/${model.id}` : selected ? `${selected.providerID}/${selected.id}` : "Default model",
        catalog,
        context: model?.limit?.context,
      };
    },
  };
}

export async function pages<T>(read: (cursor?: string) => Promise<Page<T>>, signal: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await read(cursor);
    signal.throwIfAborted();
    result.push(...page.data);
    cursor = page.cursor.next ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error("Repeated pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

export interface Snapshot {
  rootID: string;
  viewedID: string;
  sessions: Map<string, Session>;
  messages: Map<string, Map<string, UsageMessage>>;
  model: ActiveModel;
}

export async function loadSnapshot(source: UsageSource, sessionID: string, signal: AbortSignal): Promise<Snapshot> {
  const viewed = await source.session(sessionID, signal);
  let root = viewed;
  const ancestors = new Set<string>();
  while (root.parentID) {
    if (ancestors.has(root.id)) throw new Error("Cyclic session ancestry");
    ancestors.add(root.id);
    signal.throwIfAborted();
    root = await source.session(root.parentID, signal);
  }
  const sessions = new Map<string, Session>([[root.id, root]]);
  const messages = new Map<string, Map<string, UsageMessage>>();
  // Breadth-first discovery includes unopened descendants, with bounded parallelism.
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const session = queue[index]!;
    const [children, history] = await Promise.all([
      pages(cursor => source.children(session.id, cursor, signal), signal),
      pages(cursor => source.messages(session.id, cursor, signal), signal),
    ]);
    messages.set(session.id, new Map(history.map(message => [message.id, message])));
    for (const child of children) {
      if (child.parentID !== session.id) throw new Error("Unexpected child session");
      if (!sessions.has(child.id)) {
        sessions.set(child.id, child);
        queue.push(child);
      }
    }
  }
  if (!sessions.has(viewed.id)) throw new Error("Session tree changed during refresh");
  const model = await source.model(viewed, signal);
  signal.throwIfAborted();
  return { rootID: root.id, viewedID: viewed.id, sessions, messages, model };
}

/** History of the viewed session only, in API order (`order: "asc"`). */
export function viewedMessages(snapshot: Snapshot): readonly UsageMessage[] {
  return [...(snapshot.messages.get(snapshot.viewedID)?.values() ?? [])];
}

export function* uniqueMessages(snapshot: Snapshot): Iterable<UsageMessage> {
  const seen = new Set<string>();
  for (const [sessionID, messages] of snapshot.messages) {
    const session = snapshot.sessions.get(sessionID)!;
    for (const message of messages.values()) {
      // 2.0.9 projectFork copies history with IDs `${forkMessageID}_${sourceSeq}`.
      // Those calls belong to the source session, even though the copy has a new ID.
      // A fork is a separate root (fork.sessionID is not parentID).
      if (session.fork && /_\d+$/.test(message.id)) continue;
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      yield message;
    }
  }
}
