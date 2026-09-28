/**
 * Folder-header grouping indicator (ui-plan §1). Rendered on the header's
 * secondary row only when the effective mode is not `none`; says `· default`
 * when inherited. Activating it opens the folder actions menu (the menu
 * focuses the checked Group-by radio on open). 18px visual, 44px hit area on
 * coarse pointers via `.group-by-chip` (index.css).
 * See change: session-list-group-by.
 */
import type { GroupByMode } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { mdiCircleHalfFull, mdiSourceBranch } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t } from "../../lib/i18n/i18n.js";

export function groupByModeLabel(mode: GroupByMode): string {
  switch (mode) {
    case "none":
      return t("sessionList.groupByNone", undefined, "None");
    case "status":
      return t("sessionList.groupByStatus", undefined, "Status");
    case "location":
      return t("sessionList.groupByLocation", undefined, "Location");
  }
}

export function GroupByChip({
  cwd,
  mode,
  inherited,
  onActivate,
}: {
  cwd: string;
  mode: GroupByMode;
  inherited: boolean;
  onActivate: () => void;
}) {
  if (mode === "none") return null;
  const label = groupByModeLabel(mode);
  const title = t("sessionList.groupByChipTitle", undefined, "Grouping — click to change");
  return (
    <button
      type="button"
      aria-haspopup="menu"
      title={title}
      onClick={(e) => {
        // The header row navigates to the folder home on click.
        e.stopPropagation();
        onActivate();
      }}
      className="group-by-chip focus-ring ml-auto inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-[7px] py-px text-[10px] text-[var(--text-secondary)] hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)]"
      data-testid={`folder-group-by-chip-${cwd}`}
    >
      <Icon path={mode === "status" ? mdiCircleHalfFull : mdiSourceBranch} size={0.4} />
      <span>{label}</span>
      {inherited && <span className="text-[var(--text-muted)]">· {t("sessionList.groupByDefaultSuffix", undefined, "default")}</span>}
    </button>
  );
}
