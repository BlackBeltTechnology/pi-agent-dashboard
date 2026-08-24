/**
 * Pure label builders for the folder actions menu's directory-group items
 * (change: add-folder-action-banner). Kept separate from `SessionList` so the
 * tally/badge logic is unit-testable without rendering the whole sidebar.
 */

import type { WorktreeInitStatus } from "../../lib/git/git-api.js";

/**
 * Permanent `Project setup…` item label. Appends the per-artifact tally `n/N`
 * when the checklist is present (e.g. `Project setup… 3/5`), and a `● update`
 * badge when the payload reports template drift. An absent checklist (fail-open)
 * yields the bare base label — never a misleading `0/5`.
 */
export function projectSetupLabel(status: WorktreeInitStatus | null, base = "Project setup…"): string {
  const checklist = status?.checklist;
  const tally = Array.isArray(checklist)
    ? ` ${checklist.filter((a) => a.present).length}/${checklist.length}`
    : "";
  const badge = status?.setupOutdated === true ? "  ● update" : "";
  return `${base}${tally}${badge}`;
}
