/**
 * Setup state derived from a `GET /init-status` payload. Lives in `lib/` so
 * `useInitStatus` (hook) and `FolderActionBanner` (component) can share it
 * without the hook importing a component file.
 *
 * See change: fix-project-setup-completion-state.
 */
import type { WorktreeInitStatus } from "./git/git-api.js";

export type SetupState = "not-a-project" | "ok" | "unknown";

/**
 * The checklist WINS whenever present; the deprecated `configured` boolean is
 * consulted only in its absence. Neither present → "unknown" (fail open, no
 * banner).
 */
export function setupState(status: WorktreeInitStatus | null): SetupState {
  if (!status) return "unknown";
  if (Array.isArray(status.checklist)) {
    const settings = status.checklist.find((a) => a.id === "settings");
    if (!settings) return "unknown"; // uninterpretable shape → fail open
    return settings.present ? "ok" : "not-a-project";
  }
  if (status.configured === true) return "ok";
  if (status.configured === false) return "not-a-project";
  return "unknown";
}
