import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { countStatusRollup } from "../../lib/session/session-status-visuals.js";

/**
 * Compact status rollup shown in a folder header when the folder is COLLAPSED.
 * Renders working (yellow) and idle (green) session dot-counts so the folder
 * still communicates "is anything running / alive here" without expanding —
 * see change: condense-collapsed-folder-header (variant B).
 *
 * The `needs-you` state is intentionally NOT shown here: it is surfaced by the
 * sibling clickable `FolderNeedsYouPill` (purple), which owns the widget-bar
 * probe. `ended` sessions are excluded. Renders nothing when both counts are 0.
 *
 * Colors trace to the semantic `--status-working` / `--status-idle` tokens via
 * `session-status-visuals`, keeping this in lockstep with the SessionCard dot.
 */
export function FolderStatusRollup({ sessions }: { sessions: DashboardSession[] }) {
  const { working, idle } = countStatusRollup(sessions);
  if (working === 0 && idle === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] shrink-0"
      data-testid="folder-status-rollup"
      aria-label={i18nT(
        "folders.folderStatusRollup",
        { working, idle },
        `${working} running, ${idle} idle`,
      )}
    >
      {working > 0 && (
        <span className="inline-flex items-center gap-1" data-testid="folder-status-working">
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-[var(--status-working)]" />
          {working}
        </span>
      )}
      {idle > 0 && (
        <span className="inline-flex items-center gap-1" data-testid="folder-status-idle">
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-[var(--status-idle)]" />
          {idle}
        </span>
      )}
    </span>
  );
}
