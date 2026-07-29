// Desktop tab bar for pinned ("kedvenc") sessions — browser-tab-style quick
// access above the content area. Renders one tab per pinned session id that
// still resolves in the live `sessions` map, in the server-persisted order.
// Clicking a tab navigates to `/session/:id`; the ✕ unpins (does NOT abort or
// hide the session). Overflows horizontally (`overflow-x-auto`) rather than
// shrinking or wrapping. Ended sessions stay pinned, dimmed + "ended"-marked.
// See change: session-tab-bar.
import { Icon } from "@mdi/react";
import { mdiClose } from "@mdi/js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getSessionDisplayName } from "../../lib/session/session-display-name.js";
import { statusColors } from "../../lib/session/session-status-visuals.js";

interface SessionTabBarProps {
  /** Server-persisted, ordered pinned session ids. */
  pinnedSessions: string[];
  /** Live session map — a pinned id absent here is skipped (deleted session). */
  sessions: Map<string, DashboardSession>;
  /** Currently selected session id (active tab). */
  selectedId?: string;
  /** Navigate to a session (mirrors sidebar card click). */
  onSelect: (sessionId: string) => void;
  /** Remove a session from the tab bar (unpin, non-destructive). */
  onUnpin: (sessionId: string) => void;
}

export function SessionTabBar({
  pinnedSessions,
  sessions,
  selectedId,
  onSelect,
  onUnpin,
}: SessionTabBarProps) {
  // Resolve ids to live sessions in pinned order; drop ids that no longer
  // exist (permanently deleted). Ended sessions still resolve and render.
  const tabs = pinnedSessions
    .map((id) => sessions.get(id))
    .filter((s): s is DashboardSession => s !== undefined);

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex h-9 shrink-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-1"
      role="tablist"
      aria-label="Pinned sessions"
    >
      {tabs.map((session) => {
        const active = session.id === selectedId;
        const ended = session.endedAt !== undefined;
        return (
          <div
            key={session.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onSelect(session.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(session.id);
              }
            }}
            className={`group flex w-[160px] shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors ${
              active
                ? "border-[var(--accent-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            } ${ended ? "opacity-60" : ""}`}
            title={getSessionDisplayName(session)}
          >
            <span
              className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColors[session.status] ?? "bg-[var(--bg-surface)]"}`}
            />
            <span className="flex-1 truncate">{getSessionDisplayName(session)}</span>
            {ended && (
              <span className="flex-shrink-0 text-[10px] uppercase text-[var(--text-muted)]">ended</span>
            )}
            {session.unread && !active && (
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent-primary)]" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUnpin(session.id);
              }}
              className="flex-shrink-0 rounded p-0.5 text-[var(--text-muted)] opacity-0 hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] group-hover:opacity-100"
              aria-label={`Unpin ${getSessionDisplayName(session)}`}
              title="Unpin from tab bar"
            >
              <Icon path={mdiClose} size={0.6} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
