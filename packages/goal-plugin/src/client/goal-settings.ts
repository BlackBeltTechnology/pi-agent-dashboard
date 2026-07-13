/**
 * Client-side goal plugin settings. Currently just `autoRespawnDefault` — the
 * default value of a new goal's auto-respawn toggle. Persisted in localStorage
 * (a per-browser preference); the per-goal `GoalRecord.autoRespawn` the server
 * persists is the source of truth once a goal exists. New goals inherit this
 * default via the create form.
 *
 * See change: add-goal-session-supervisor.
 */
const AUTO_RESPAWN_DEFAULT_KEY = "pi-dashboard.goal.autoRespawnDefault";

/** Read the auto-respawn default (off unless explicitly enabled). */
export function getAutoRespawnDefault(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_RESPAWN_DEFAULT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the auto-respawn default. */
export function setAutoRespawnDefault(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(AUTO_RESPAWN_DEFAULT_KEY, on ? "1" : "0");
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}
