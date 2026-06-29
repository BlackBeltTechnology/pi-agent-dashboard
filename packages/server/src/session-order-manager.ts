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
  /**
   * Move a session id from `oldKey` to `newKey`. Removes it from `oldKey`
   * (pruning the entry entirely if its list becomes empty) and inserts it
   * into `newKey` — at the front when `toFront` is set, else appended.
   * No-op when `oldKey === newKey`. Used by the deferred order-key
   * resolution path: a worktree session registers under its raw cwd key
   * (group identity not yet known) and is re-keyed to the parent key once
   * `git_info_update` arrives.
   * See change: fix-worktree-spawn-placeholder-and-ordering.
   */
  rekey(oldKey: string, newKey: string, sessionId: string, opts?: { toFront?: boolean }): void;
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

    rekey(oldKey: string, newKey: string, sessionId: string, opts?: { toFront?: boolean }): void {
      if (oldKey === newKey) return;
      // Remove from old key, pruning the entry if it becomes empty.
      if (orderMap[oldKey]) {
        const filtered = orderMap[oldKey].filter((id) => id !== sessionId);
        if (filtered.length === 0) {
          delete orderMap[oldKey];
        } else {
          orderMap[oldKey] = filtered;
        }
      }
      // Insert into new key (dedupe).
      if (!orderMap[newKey]) {
        orderMap[newKey] = [];
      }
      const dest = orderMap[newKey].filter((id) => id !== sessionId);
      if (opts?.toFront) {
        dest.unshift(sessionId);
      } else {
        dest.push(sessionId);
      }
      orderMap[newKey] = dest;
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
