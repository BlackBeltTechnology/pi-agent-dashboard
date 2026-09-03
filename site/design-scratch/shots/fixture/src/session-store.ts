import { EventEmitter } from "node:events";

export type SessionState = "idle" | "working" | "needs-you" | "error" | "ended";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  state: SessionState;
  model: string;
  branch: string | null;
  startedAt: number;
  endedAt: number | null;
  tokens: { input: number; output: number };
  costUsd: number;
}

export interface StoreEvents {
  added: [Session];
  changed: [Session, Partial<Session>];
  removed: [string];
}

const TERMINAL: ReadonlySet<SessionState> = new Set(["ended", "error"]);

/**
 * In-memory session map with an append-only change feed.
 *
 * Ordering is insertion order, not id order — the dashboard renders the list
 * top-down and a stable order is what stops cards jumping under the cursor
 * while a session streams.
 */
export class SessionStore extends EventEmitter {
  readonly #sessions = new Map<string, Session>();

  get size(): number {
    return this.#sessions.size;
  }

  add(session: Session): void {
    if (this.#sessions.has(session.id)) {
      throw new Error(`duplicate session id: ${session.id}`);
    }
    this.#sessions.set(session.id, session);
    this.emit("added", session);
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  patch(id: string, delta: Partial<Session>): Session {
    const current = this.#sessions.get(id);
    if (!current) throw new Error(`unknown session: ${id}`);

    const next = { ...current, ...delta };
    this.#sessions.set(id, next);
    this.emit("changed", next, delta);
    return next;
  }

  end(id: string, at = Date.now()): Session {
    return this.patch(id, { state: "ended", endedAt: at });
  }

  remove(id: string): boolean {
    const existed = this.#sessions.delete(id);
    if (existed) this.emit("removed", id);
    return existed;
  }

  active(): Session[] {
    return [...this.#sessions.values()].filter((s) => !TERMINAL.has(s.state));
  }

  needingAttention(): Session[] {
    return [...this.#sessions.values()].filter((s) => s.state === "needs-you");
  }

  totalCost(): number {
    let sum = 0;
    for (const s of this.#sessions.values()) sum += s.costUsd;
    return sum;
  }
}
