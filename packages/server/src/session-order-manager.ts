/**
 * Manages per-cwd session ordering with persistence via PreferencesStore.
 * All mutations are synchronous — Node.js event loop provides concurrency safety.
 */
import type { PreferencesStore } from "./preferences-store.js";

export interface SessionOrderManager {
  /** Insert session into cwd order. Prepends by default, or inserts after afterSessionId. */
  insert(cwd: string, sessionId: string, afterSessionId?: string): void;
  /** Replace the full order for a cwd. */
  reorder(cwd: string, sessionIds: string[]): void;
  /** Remove a session from its cwd order. */
  remove(cwd: string, sessionId: string): void;
  /**
   * Move a session id to the front (index 0) of its cwd order. Idempotent:
   * if the id is already at the front, the order is unchanged but a persist
   * still fires (callers gate broadcasts on actual mutation).
   * If the id is absent, it is inserted at the front.
   * Used by the user-intent resume path to surface the just-resumed session
   * at the top of the alive tier even on repeated end → resume cycles.
   * See change: top-of-tier-on-status-change.
   */
  moveToFront(cwd: string, sessionId: string): void;
  /** Get order for a cwd, optionally filtering to only valid IDs. */
  getOrder(cwd: string, validIds?: Set<string>): string[];
  /** Get all cwd→order entries. */
  getAllOrders(): Record<string, string[]>;
}

export function createSessionOrderManager(preferencesStore: PreferencesStore): SessionOrderManager {
  // Load initial state from store
  const orderMap: Record<string, string[]> = { ...preferencesStore.getSessionOrder() };

  function persist(): void {
    preferencesStore.setSessionOrder({ ...orderMap });
  }

  return {
    insert(cwd: string, sessionId: string, afterSessionId?: string): void {
      if (!orderMap[cwd]) {
        orderMap[cwd] = [];
      }
      const arr = orderMap[cwd];

      // Don't duplicate
      if (arr.includes(sessionId)) return;

      if (afterSessionId) {
        const idx = arr.indexOf(afterSessionId);
        if (idx !== -1) {
          arr.splice(idx + 1, 0, sessionId);
        } else {
          arr.unshift(sessionId);
        }
      } else {
        arr.unshift(sessionId);
      }
      persist();
    },

    reorder(cwd: string, sessionIds: string[]): void {
      orderMap[cwd] = [...sessionIds];
      persist();
    },

    remove(cwd: string, sessionId: string): void {
      if (!orderMap[cwd]) return;
      orderMap[cwd] = orderMap[cwd].filter((id) => id !== sessionId);
      persist();
    },

    moveToFront(cwd: string, sessionId: string): void {
      // remove + unshift = move-to-front. Works whether the id was
      // absent, mid-list, or already at index 0.
      // See change: top-of-tier-on-status-change.
      if (!orderMap[cwd]) {
        orderMap[cwd] = [];
      }
      orderMap[cwd] = orderMap[cwd].filter((id) => id !== sessionId);
      orderMap[cwd].unshift(sessionId);
      persist();
    },

    getOrder(cwd: string, validIds?: Set<string>): string[] {
      const arr = orderMap[cwd];
      if (!arr) return [];
      if (!validIds) return [...arr];
      return arr.filter((id) => validIds.has(id));
    },

    getAllOrders(): Record<string, string[]> {
      return { ...orderMap };
    },
  };
}
