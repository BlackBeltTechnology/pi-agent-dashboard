/**
 * Queue of open provisioning requests for this browser (change:
 * add-access-provisioning, task 3.2). Same lifecycle as `GrantPromptStore`,
 * keyed by `requestId`: a request leaves the queue exactly once — answered
 * locally (`claim`), ended elsewhere (`provision_dismiss`), expired (`expire`),
 * or found gone on reconnect (`reconcile`). A closed id is remembered
 * (bounded) so a late local answer or a re-delivered request is inert (first
 * answer wins).
 */
import type {
  ProvisionDismissMessage,
  ProvisionRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** How many closed request ids are remembered for late-answer suppression. */
const CLOSED_MEMORY = 200;

export class ProvisionPromptStore {
  private queue: readonly ProvisionRequestMessage[] = [];
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
  getQueue = (): readonly ProvisionRequestMessage[] => this.queue;

  /** Bumps on every queue change; the Access page refetches on it. */
  getVersion = (): number => this.version;

  /** Apply a `provision_request` / `provision_dismiss` frame. Other frames are ignored. */
  apply(msg: ProvisionRequestMessage | ProvisionDismissMessage | { type: string }): void {
    if (msg.type === "provision_request") {
      const raw = msg as ProvisionRequestMessage;
      if (this.isClosed(raw.requestId) || this.queue.some((r) => r.requestId === raw.requestId)) return;
      // Re-base onto the local clock: a skewed browser clock must not expire it early.
      const req = typeof raw.ttlMs === "number" ? { ...raw, expiresAt: Date.now() + raw.ttlMs } : raw;
      this.set([...this.queue, req]);
    } else if (msg.type === "provision_dismiss") {
      this.close((msg as ProvisionDismissMessage).requestId);
    }
  }

  /** Take an open request for a local answer. False = already closed; send nothing. */
  claim(requestId: string): boolean {
    if (!this.queue.some((r) => r.requestId === requestId)) return false;
    this.close(requestId);
    return true;
  }

  /** Drop every request whose `expiresAt` is at or before `now`. */
  expire(now: number): void {
    for (const r of this.queue) if (r.expiresAt <= now) this.close(r.requestId);
  }

  /** Ids queued right now; pass to `reconcile` to scope removals to them. */
  snapshotIds(): ReadonlySet<string> {
    return new Set(this.queue.map((r) => r.requestId));
  }

  /**
   * Converge on the server's pending list after a (re)connect. Only requests
   * queued BEFORE the snapshot was requested (`before`) may be removed, so a
   * request that raced the fetch survives.
   */
  reconcile(pending: readonly ProvisionRequestMessage[], before: ReadonlySet<string>): void {
    const live = new Set(pending.map((r) => r.requestId));
    for (const r of this.queue) {
      if (before.has(r.requestId) && !live.has(r.requestId)) this.close(r.requestId);
    }
    for (const r of pending) this.apply(r);
  }

  private isClosed(requestId: string): boolean {
    return this.closed.includes(requestId);
  }

  private close(requestId: string): void {
    if (!this.isClosed(requestId)) {
      this.closed.push(requestId);
      if (this.closed.length > CLOSED_MEMORY) this.closed.shift();
    }
    const next = this.queue.filter((r) => r.requestId !== requestId);
    if (next.length !== this.queue.length) this.set(next);
  }

  private set(next: readonly ProvisionRequestMessage[]): void {
    this.queue = next;
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** The app-wide store: fed by `ProvisionPromptHost`, read by the Access page. */
export const provisionPromptStore = new ProvisionPromptStore();
