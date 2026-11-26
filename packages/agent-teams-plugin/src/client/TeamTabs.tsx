/**
 * TeamTabs — the Members · Tasks · Messages tablist (owner decision: tabs on every
 * width). WAI-ARIA APG tabs: roving tabindex (one tab stop), ←/→ move AND select
 * (wrapping at the ends), Home/End jump to the first/last tab, each tab controls a
 * `role="tabpanel"` labelled by it (`tabPanelId` / `tabId`). Wraps instead of
 * scrolling; ≥ 44 px targets below `sm`.
 * See change: add-agent-teams-ui (design D10; task 8.4, 13.24).
 */
import { type KeyboardEvent, type ReactElement, useRef } from "react";
import { CHIP, useViewT } from "./view-kit.js";

export const TABS = ["members", "tasks", "messages"] as const;
export type TeamTab = (typeof TABS)[number];
export const tabId = (tab: TeamTab): string => `team-tab-${tab}`;
export const tabPanelId = (tab: TeamTab): string => `team-panel-${tab}`;

/** Target index of a roving-tabindex key press (APG: arrows wrap, Home/End jump), or -1 for any other key. */
function targetIndex(key: string, i: number, count: number): number {
  const last = count - 1;
  if (key === "ArrowRight") return i === last ? 0 : i + 1;
  if (key === "ArrowLeft") return i === 0 ? last : i - 1;
  if (key === "Home") return 0;
  return key === "End" ? last : -1;
}

export interface TeamTabsProps {
  tab: TeamTab;
  onTab: (tab: TeamTab) => void;
  counts: Readonly<Record<TeamTab, number>>;
}

export function TeamTabs({ tab, onTab, counts }: TeamTabsProps): ReactElement {
  const t = useViewT();
  const refs = useRef<Record<TeamTab, HTMLButtonElement | null>>({ members: null, tasks: null, messages: null });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const to = targetIndex(e.key, i, TABS.length);
    if (to < 0) return;
    e.preventDefault();
    const next = TABS[to] as TeamTab;
    onTab(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={t("tabs.label")} className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border-secondary)] px-3" data-testid="team-tablist">
      {TABS.map((id, i) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={tabPanelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTab(id)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`team-tab-${id}`}
            className={`focus-ring -mb-px inline-flex min-h-[36px] max-sm:min-h-[44px] items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${selected ? "border-[var(--accent-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
          >
            {t(`tabs.${id}`)}
            <span className={CHIP}>{counts[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
