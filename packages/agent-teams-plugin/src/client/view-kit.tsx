/**
 * Shared building blocks of the lazy Team view (promoted from the decided mock
 * `mockups/teams-view.tsx` / `teams-status.tsx`): token-only class recipes, the
 * status pill over `status-map.ts`, the `Empty` state and the view's translator.
 * Colours are token names only; every control carries `focus-ring`, ≥ 44 px below
 * `sm`. Agent text is rendered through `TEXT` (plain React text, `pre-wrap`,
 * `overflow-wrap:anywhere`) — never markdown, HTML or links (design D11).
 * See change: add-agent-teams-ui.
 */
import type { ReactElement } from "react";
import { useLazyT } from "./lazy-i18n.js";
import { PillView } from "./pill.js";
import { memberStatusEntry, type StatusEntry, teamStatusEntry } from "./status-map.js";
import { TEAM_VIEW_TABLES } from "./team-view-i18n.js";

export * from "./recipes.js";

/** Translator of the Team view module. */
export function useViewT() {
  return useLazyT(TEAM_VIEW_TABLES);
}

/** Glyph + text + pill state of the D12 table, text from the Team view table. */
function StatusPill({ entry, status, testId, pulse }: { entry: StatusEntry; status: string; testId?: string; pulse?: boolean }): ReactElement {
  const t = useViewT();
  return <PillView entry={entry} label={t(entry.textKey)} status={status} testId={testId} pulse={pulse} />;
}

/** `data-testid="team-member-status"` + `data-status` is the contract of change 5 (design D14). */
export function MemberStatusPill({ status }: { status: string }): ReactElement {
  return <StatusPill entry={memberStatusEntry(status)} status={status} testId="team-member-status" pulse={status === "busy"} />;
}

export function TeamStatusPill({ status }: { status: string }): ReactElement {
  return <StatusPill entry={teamStatusEntry(status)} status={status} testId="team-status" />;
}


export function Empty({ title, hint, testId }: { title: string; hint: string; testId?: string }): ReactElement {
  return (
    <div data-testid={testId} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{hint}</p>
    </div>
  );
}
