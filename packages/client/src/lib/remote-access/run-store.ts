/**
 * Persisted wizard run — what lets the dialog resume the SAME task at the SAME
 * step after Listen on network restarts the server (design D4).
 *
 * `sessionStorage` (per tab, gone with the tab). A resume older than
 * {@link RESUME_TTL_MS} is discarded; the key is ALWAYS removed when read, and
 * removed at once when the restart request is refused or fails — so a stale run
 * can never reopen the dialog later.
 *
 * See change: add-remote-access-wizard.
 */
import type { DeviceBranch, RunState, StepId, TaskId } from "./steps.js";

export const RUN_KEY = "remoteAccess.run";
const RESUME_TTL_MS = 120_000;

interface StoredRun {
  task: TaskId;
  branch?: DeviceBranch;
  done: StepId[];
  at: number;
}

export function saveRun(run: RunState, now = Date.now()): void {
  const stored: StoredRun = { task: run.task, branch: run.branch, done: run.done, at: now };
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(stored));
  } catch {
    /* storage blocked: resume simply won't happen */
  }
}

export function clearRun(): void {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

/** Read AND remove. Returns the run only when it is younger than the TTL. */
export function takeFreshRun(now = Date.now()): RunState | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
  clearRun();
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredRun;
    if (typeof s.at !== "number" || now - s.at >= RESUME_TTL_MS) return null;
    if (!["share", "device", "lan", "connect"].includes(s.task)) return null;
    return { task: s.task, branch: s.branch, done: Array.isArray(s.done) ? s.done : [] };
  } catch {
    return null;
  }
}

export const hasStoredRun = (): boolean => {
  try {
    return sessionStorage.getItem(RUN_KEY) !== null;
  } catch {
    return false;
  }
};
