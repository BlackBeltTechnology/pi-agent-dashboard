/**
 * Client-side, cwd-keyed worktree-init run store.
 *
 * Single source of truth for the friendly init feedback surfaces (folder-row
 * chip, session-card sub-state, concurrent stack). Fed by three inputs that
 * all key on the run's stable `cwd`:
 *   1. optimistic `startRun(cwd)` on manual click / auto-init spawn,
 *   2. the ws event stream (via `subscribeInitByCwd`),
 *   3. boot rehydration (`seed(activeRuns)` from `GET /active-inits`).
 *
 * Terminal presentation rules (design.md):
 *   - `done`  → flashes ~2s, then auto-collapses (entry removed).
 *   - `failed`→ sticky; only Retry / dismiss clears it (never a timer).
 *
 * Exposes a `useSyncExternalStore` surface: `subscribe` + per-cwd / all-runs
 * snapshots with stable references so React only rerenders on real change.
 *
 * See change: friendlier-worktree-init.
 */

import type { ActiveWorktreeInit } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useSyncExternalStore } from "react";
import { subscribeInitByCwd, type WorktreeInitEvent } from "./worktree-init-bus.js";

export type InitPhase = "running" | "done" | "failed";

export interface ClientInitRun {
  cwd: string;
  phase: InitPhase;
  startedAt: number;
  /** Ghost preview — last non-empty progress line. */
  lastLine?: string;
  /** Opt-in disclosure — last <= 4KB of combined output. */
  logTail?: string;
  /** Failure classifier (phase `failed`). */
  code?: string;
  /** Plain-language failure summary (phase `failed`). */
  message?: string;
  /** Full stderr / log tail on failure. */
  stderr?: string;
}

/** Success-flash window before a `done` entry auto-collapses. */
export const DONE_FLASH_MS = 2000;

/**
 * Grace before `reconcile` prunes a client `running` run the server no longer
 * reports. Spares a just-started optimistic run whose `POST /init` has not yet
 * registered server-side (so a reconnect racing a click can't kill its chip).
 */
export const RECONCILE_GRACE_MS = 4000;

const runs = new Map<string, ClientInitRun>();
const cwdUnsubs = new Map<string, () => void>();
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

let allSnapshot: ClientInitRun[] = [];

function rebuildAllSnapshot() {
  allSnapshot = [...runs.values()];
}

function notify() {
  rebuildAllSnapshot();
  for (const l of listeners) { try { l(); } catch { /* swallow */ } }
}

/** Ensure a ws subscription (server + bus) for `cwd` while a run is live. */
function ensureCwdSubscription(cwd: string) {
  if (cwdUnsubs.has(cwd)) return;
  const unsub = subscribeInitByCwd(cwd, (ev) => applyEvent(ev));
  cwdUnsubs.set(cwd, unsub);
}

function dropCwdSubscription(cwd: string) {
  const unsub = cwdUnsubs.get(cwd);
  if (unsub) { unsub(); cwdUnsubs.delete(cwd); }
}

function clearFlashTimer(cwd: string) {
  const t = flashTimers.get(cwd);
  if (t) { clearTimeout(t); flashTimers.delete(cwd); }
}

function applyEvent(ev: WorktreeInitEvent) {
  const cwd = ev.cwd;
  if (!cwd) return;
  if (ev.type === "worktree_init_progress") {
    const prev = runs.get(cwd);
    runs.set(cwd, {
      cwd,
      phase: "running",
      startedAt: prev?.startedAt ?? Date.now(),
      lastLine: lastLineOf(ev.line),
      logTail: ev.line,
    });
    notify();
  } else if (ev.type === "worktree_init_done") {
    markDone(cwd);
  } else if (ev.type === "worktree_init_failed") {
    markFailed(cwd, ev.code, ev.message, ev.stderr);
  }
}

function lastLineOf(tail: string): string {
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return "";
}

export const initStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getRun(cwd: string): ClientInitRun | undefined {
    return runs.get(cwd);
  },

  getAllSnapshot(): ClientInitRun[] {
    return allSnapshot;
  },

  /** Optimistic running entry + live subscription. */
  startRun(cwd: string) {
    clearFlashTimer(cwd);
    const prev = runs.get(cwd);
    runs.set(cwd, { cwd, phase: "running", startedAt: prev?.phase === "running" ? prev.startedAt : Date.now() });
    ensureCwdSubscription(cwd);
    notify();
  },

  markDone(cwd: string) {
    markDone(cwd);
  },

  markFailed(cwd: string, code: string, message: string, stderr?: string) {
    markFailed(cwd, code, message, stderr);
  },

  /** Clear a run (Retry / dismiss). Drops its subscription. */
  dismiss(cwd: string) {
    clearFlashTimer(cwd);
    dropCwdSubscription(cwd);
    if (runs.delete(cwd)) notify();
  },

  /**
   * Reconcile against the server's authoritative snapshot (boot + reconnect):
   * upsert present runs AND prune a stale client `running` run the server no
   * longer reports (it finished + TTL-evicted while the ws was disconnected),
   * so an empty snapshot is NOT a silent no-op. Grace-guarded to spare an
   * in-flight optimistic run. Client terminal state (done-flash / failed-sticky)
   * is preserved — the server evicts those but the client keeps them on purpose.
   */
  reconcile(active: ActiveWorktreeInit[]) {
    const serverRunning = new Set(active.filter((r) => r.phase === "running").map((r) => r.cwd));
    const now = Date.now();
    let changed = false;
    for (const [cwd, run] of runs) {
      if (run.phase === "running" && !serverRunning.has(cwd) && now - run.startedAt > RECONCILE_GRACE_MS) {
        dropCwdSubscription(cwd);
        runs.delete(cwd);
        changed = true;
      }
    }
    if (changed) notify();
    initStore.seed(active);
  },

  /** Boot rehydration: merge server-reported active runs. */
  seed(active: ActiveWorktreeInit[]) {
    let changed = false;
    for (const r of active) {
      if (r.phase === "running") {
        runs.set(r.cwd, { cwd: r.cwd, phase: "running", startedAt: r.startedAt, lastLine: r.lastLine });
        ensureCwdSubscription(r.cwd);
        changed = true;
      } else if (r.phase === "done") {
        runs.set(r.cwd, { cwd: r.cwd, phase: "done", startedAt: r.startedAt });
        scheduleCollapse(r.cwd);
        changed = true;
      } else if (r.phase === "failed") {
        runs.set(r.cwd, { cwd: r.cwd, phase: "failed", startedAt: r.startedAt, code: r.code, message: r.code });
        changed = true;
      }
    }
    if (changed) notify();
  },

  /** Test-only. */
  __resetForTests() {
    for (const unsub of cwdUnsubs.values()) { try { unsub(); } catch { /* noop */ } }
    for (const t of flashTimers.values()) clearTimeout(t);
    runs.clear();
    cwdUnsubs.clear();
    flashTimers.clear();
    listeners.clear();
    allSnapshot = [];
  },
};

function markDone(cwd: string) {
  const prev = runs.get(cwd);
  runs.set(cwd, { cwd, phase: "done", startedAt: prev?.startedAt ?? Date.now() });
  scheduleCollapse(cwd);
  notify();
}

function markFailed(cwd: string, code: string, message: string, stderr?: string) {
  clearFlashTimer(cwd);
  const prev = runs.get(cwd);
  runs.set(cwd, {
    cwd,
    phase: "failed",
    startedAt: prev?.startedAt ?? Date.now(),
    logTail: prev?.logTail,
    code,
    message,
    stderr,
  });
  // Keep the subscription until dismiss/retry so nothing is lost, but a failed
  // run receives no further events; drop the ws subscription to free the server.
  dropCwdSubscription(cwd);
  notify();
}

/** `done` entries flash then auto-collapse. */
function scheduleCollapse(cwd: string) {
  dropCwdSubscription(cwd);
  clearFlashTimer(cwd);
  const t = setTimeout(() => {
    flashTimers.delete(cwd);
    const cur = runs.get(cwd);
    if (cur?.phase === "done") { runs.delete(cwd); notify(); }
  }, DONE_FLASH_MS);
  flashTimers.set(cwd, t);
}

/** Per-cwd run subscription for a component. */
export function useInitRun(cwd: string): ClientInitRun | undefined {
  return useSyncExternalStore(
    initStore.subscribe,
    () => initStore.getRun(cwd),
    () => initStore.getRun(cwd),
  );
}

/** All active runs (concurrent stack). */
export function useAllInitRuns(): ClientInitRun[] {
  return useSyncExternalStore(
    initStore.subscribe,
    initStore.getAllSnapshot,
    initStore.getAllSnapshot,
  );
}
