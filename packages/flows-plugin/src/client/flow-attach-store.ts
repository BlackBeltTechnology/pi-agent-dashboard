/**
 * Per-session "attached flow" store for the attach-before-run panel.
 *
 * Module-level `Map<sessionId, FlowAttachment | null>` persisted as JSON under
 * `dashboard:flow-attached:<sessionId>` and exposed via `useSyncExternalStore`
 * (pattern of `FlowsUiStateContext`). `getAttachment` returns the SAME cached
 * object until that session's entry is written or cleared, so React does not
 * loop. localStorage access is try/catch-swallowed (as in
 * `flow-collapse-storage.ts`) — storage failure degrades to in-memory. A
 * `window` `storage` listener keeps tabs of the same browser in sync.
 *
 * Shared by `SessionFlowActions` (writes on Open) and `FlowDashboardClaim`
 * (reads, resolves baseline, deletes on consume / Close).
 * See change: attach-flow-before-run (D5).
 */
import { useCallback, useSyncExternalStore } from "react";
import type { FlowAttachment } from "./flow-idle-state.js";

const KEY_PREFIX = "dashboard:flow-attached:";

export function flowAttachKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

const cache = new Map<string, FlowAttachment | null>();
const subscribers = new Map<string, Set<() => void>>();

function parse(raw: string | null): FlowAttachment | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FlowAttachment> | null;
    if (!v || typeof v.id !== "string" || typeof v.name !== "string") return null;
    // Coerce the rest so a legacy / hand-edited entry cannot strand the panel.
    return {
      id: v.id,
      name: v.name,
      source: typeof v.source === "string" ? v.source : undefined,
      baselineStartedAt:
        typeof v.baselineStartedAt === "number" && Number.isFinite(v.baselineStartedAt) ? v.baselineStartedAt : null,
    };
  } catch {
    return null;
  }
}

function notify(sessionId: string): void {
  const set = subscribers.get(sessionId);
  if (set) for (const cb of set) cb();
}

function write(sessionId: string, value: FlowAttachment | null): void {
  cache.set(sessionId, value);
  try {
    if (value) localStorage.setItem(flowAttachKey(sessionId), JSON.stringify(value));
    else localStorage.removeItem(flowAttachKey(sessionId));
  } catch {
    /* noop — degrade to in-memory */
  }
  notify(sessionId);
}

/** Current attachment for a session (stable reference until written). */
export function getAttachment(sessionId: string): FlowAttachment | null {
  if (!cache.has(sessionId)) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(flowAttachKey(sessionId));
    } catch {
      /* noop */
    }
    cache.set(sessionId, parse(raw));
  }
  return cache.get(sessionId) ?? null;
}

/** Attach a flow (replaces any existing attachment for the session). */
export function setAttachment(sessionId: string, attachment: FlowAttachment): void {
  write(sessionId, attachment);
}

/** Set a still-null baseline, only when the stored entry has `id`. */
export function resolveBaseline(sessionId: string, id: string, baselineStartedAt: number): void {
  const cur = getAttachment(sessionId);
  if (!cur || cur.id !== id || cur.baselineStartedAt !== null) return;
  write(sessionId, { ...cur, baselineStartedAt });
}

/** Remove the attachment; with `id`, only when the stored entry still has it. */
export function clearAttachment(sessionId: string, id?: string): void {
  const cur = getAttachment(sessionId);
  if (!cur) return;
  if (id !== undefined && cur.id !== id) return;
  write(sessionId, null);
}

/** Random per-attach token. */
export function newAttachmentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function subscribe(sessionId: string, cb: () => void): () => void {
  let set = subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    subscribers.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) subscribers.delete(sessionId);
  };
}

/** React hook — the session's attachment, re-rendering on any change. */
export function useFlowAttachment(sessionId: string): FlowAttachment | null {
  const sub = useCallback((cb: () => void) => subscribe(sessionId, cb), [sessionId]);
  const get = useCallback(() => getAttachment(sessionId), [sessionId]);
  return useSyncExternalStore(sub, get, get);
}

// Cross-tab sync: another tab of this browser wrote/removed an attachment.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null) {
      const ids = Array.from(cache.keys());
      cache.clear();
      for (const id of ids) notify(id);
      return;
    }
    if (!e.key.startsWith(KEY_PREFIX)) return;
    const sessionId = e.key.slice(KEY_PREFIX.length);
    cache.set(sessionId, parse(e.newValue));
    notify(sessionId);
  });
}

/** Test-only: drop the in-memory cache (subscribers kept). */
export function __resetFlowAttachStoreForTests(): void {
  cache.clear();
}
