/**
 * Per-tab state shared by the app-wide pairing approval host and the Gateway
 * "Waiting devices" list (change: add-pairing-approval-dialog, D5).
 *
 * - `pending`   — last `GET /api/pair/pending` result (oldest first). Written
 *   only by `PairingApprovalHost`, so a paired-device browser (no host fetch)
 *   always sees an empty list.
 * - `dismissed` — pendingIds the operator closed without answering ("decide
 *   later"); the host does not reopen them on its own.
 * - `preferred` — a pendingId the operator asked to Review; shown first.
 */
import type { PendingPairing } from "./pairing-approval-api.js";

export interface PairingApprovalState {
  pending: readonly PendingPairing[];
  dismissed: ReadonlySet<string>;
  preferred: string | null;
}

export class PairingApprovalStore {
  private state: PairingApprovalState = { pending: [], dismissed: new Set(), preferred: null };
  private listeners = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): PairingApprovalState => this.state;

  private set(next: Partial<PairingApprovalState>): void {
    this.state = { ...this.state, ...next };
    for (const cb of this.listeners) cb();
  }

  setPending(pending: readonly PendingPairing[]): void {
    // Forget dismissals/preference for requests that no longer exist.
    const live = new Set(pending.map((p) => p.pendingId));
    const dismissed = new Set([...this.state.dismissed].filter((id) => live.has(id)));
    const preferred = this.state.preferred && live.has(this.state.preferred) ? this.state.preferred : null;
    this.set({ pending, dismissed, preferred });
  }

  dismiss(pendingId: string): void {
    const dismissed = new Set(this.state.dismissed);
    dismissed.add(pendingId);
    this.set({ dismissed, preferred: this.state.preferred === pendingId ? null : this.state.preferred });
  }

  /** Reopen a dismissed request (Gateway "Review"). */
  review(pendingId: string): void {
    const dismissed = new Set(this.state.dismissed);
    dismissed.delete(pendingId);
    this.set({ dismissed, preferred: pendingId });
  }
}

export const pairingApprovalStore = new PairingApprovalStore();
