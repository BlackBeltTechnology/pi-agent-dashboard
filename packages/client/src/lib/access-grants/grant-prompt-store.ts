/**
 * Queue of open access prompts for this browser (change: add-access-grant-dialog,
 * tasks 7.1-7.3). The dialog host renders one prompt at a time (`getQueue()[0]`).
 *
 * A prompt leaves the queue exactly once: answered locally (`claim`), settled
 * elsewhere (`grant_dismiss`), expired (`expire`), or found settled on reconnect
 * (`reconcile`). A closed id is remembered (bounded) so a late local answer or
 * a re-delivered request can never act on it.
 */
import type {
  GrantDismissMessage,
  GrantRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** How many closed prompt ids are remembered for late-answer suppression. */
const CLOSED_MEMORY = 200;

export class GrantPromptStore {
  private queue: readonly GrantRequestMessage[] = [];
  private readonly closed: string[] = [];
  private version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable reference between changes (safe for `useSyncExternalStore`). */
  getQueue = (): readonly GrantRequestMessage[] => this.queue;

  /** Bumps on every queue change; the Access page refetches on it. */
  getVersion = (): number => this.version;

  /** Apply a `grant_request` / `grant_dismiss` frame. Other frames are ignored. */
  apply(msg: GrantRequestMessage | GrantDismissMessage | { type: string }): void {
    if (msg.type === "grant_request") {
      const raw = msg as GrantRequestMessage;
      if (this.isClosed(raw.promptId) || this.queue.some((p) => p.promptId === raw.promptId)) return;
      // Re-base onto the local clock: a skewed browser clock must not expire it early.
      const req = typeof raw.ttlMs === "number" ? { ...raw, expiresAt: Date.now() + raw.ttlMs } : raw;
      this.set([...this.queue, req]);
    } else if (msg.type === "grant_dismiss") {
      this.close((msg as GrantDismissMessage).promptId);
    }
  }

  /** Take an open prompt for a local answer. False = already closed; send nothing. */
  claim(promptId: string): boolean {
    if (!this.queue.some((p) => p.promptId === promptId)) return false;
    this.close(promptId);
    return true;
  }

  /** Drop every prompt whose `expiresAt` is at or before `now`. */
  expire(now: number): void {
    for (const p of this.queue) if (p.expiresAt <= now) this.close(p.promptId);
  }

  /** Ids queued right now; pass to `reconcile` to scope removals to them. */
  snapshotIds(): ReadonlySet<string> {
    return new Set(this.queue.map((p) => p.promptId));
  }

  /**
   * Converge on the server's pending list after a (re)connect. Only prompts
   * queued BEFORE the snapshot was requested (`before`) may be removed, so a
   * request that raced the fetch survives.
   */
  reconcile(pending: readonly GrantRequestMessage[], before: ReadonlySet<string>): void {
    const live = new Set(pending.map((p) => p.promptId));
    for (const p of this.queue) {
      if (before.has(p.promptId) && !live.has(p.promptId)) this.close(p.promptId);
    }
    for (const p of pending) this.apply(p);
  }

  private isClosed(promptId: string): boolean {
    return this.closed.includes(promptId);
  }

  private close(promptId: string): void {
    if (!this.isClosed(promptId)) {
      this.closed.push(promptId);
      if (this.closed.length > CLOSED_MEMORY) this.closed.shift();
    }
    const next = this.queue.filter((p) => p.promptId !== promptId);
    if (next.length !== this.queue.length) this.set(next);
  }

  private set(next: readonly GrantRequestMessage[]): void {
    this.queue = next;
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** The app-wide store: fed by `GrantPromptHost`, read by the Access page. */
export const grantPromptStore = new GrantPromptStore();
