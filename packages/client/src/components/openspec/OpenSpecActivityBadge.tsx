import type { OpenSpecPhase } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClipboardTextOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

const phaseKeys: Record<OpenSpecPhase, string> = {
  explore: "explore",
  new: "new",
  continue: "continue",
  ff: "ff",
  apply: "apply",
  verify: "verify",
  archive: "archive",
  "sync-specs": "syncSpecs",
  onboard: "onboard",
};

const phaseLabels: Record<OpenSpecPhase, string> = {
  explore: "Exploring",
  new: "New Change",
  continue: "Specifying",
  ff: "Fast-Forward",
  apply: "Applying",
  verify: "Verifying",
  archive: "Archiving",
  "sync-specs": "Syncing Specs",
  onboard: "Onboarding",
};

const phaseColors: Record<OpenSpecPhase, string> = {
  explore: "text-blue-400",
  new: "text-purple-400",
  continue: "text-cyan-400",
  ff: "text-cyan-400",
  apply: "text-yellow-400",
  verify: "text-green-400",
  archive: "text-emerald-400",
  "sync-specs": "text-teal-400",
  onboard: "text-indigo-400",
};

export function OpenSpecActivityBadge({
  phase,
  changeName,
  completedTasks,
  totalTasks,
}: {
  phase?: OpenSpecPhase;
  changeName?: string;
  completedTasks?: number;
  totalTasks?: number;
}) {
  const { t } = useI18n();
  const label = phase
    ? t(`openspec.phase.${phaseKeys[phase] ?? phase}`, undefined, phaseLabels[phase] ?? phase)
    : "OpenSpec";
  const color = phase ? (phaseColors[phase] ?? "text-[var(--text-tertiary)]") : "text-[var(--text-tertiary)]";
  const hasProgress = totalTasks != null && totalTasks > 0;

  return (
    <div className={`text-[11px] mt-0.5 ml-4 flex items-center gap-1 ${color}`}>
      <Icon path={mdiClipboardTextOutline} size={0.45} />
      <span className="truncate">
        {label}
        {changeName && <span className="text-[var(--text-secondary)]"> · {changeName}</span>}
        {hasProgress && (
          <span className="text-[var(--text-muted)]"> ({completedTasks}/{totalTasks})</span>
        )}
      </span>
    </div>
  );
}
