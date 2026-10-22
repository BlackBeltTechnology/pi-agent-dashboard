/**
 * Expanded body of the dock's Processes lane: groups in a fixed order — plugin
 * groups (`composer-dock-process-group`, rows mode), unresolved bash commands,
 * bridge-scanned background processes. Group headings show only when two or
 * more groups have rows. Each row acts on its own kind only: Open (plugin),
 * Show (command, scrolls the transcript), Kill (background process group via
 * `kill_process`); none aborts the turn — the composer's Stop does.
 *
 * Mounted only while the lane body is shown (so rows-mode plugin instances are
 * too). Elapsed times live in `ComposerDockRow`'s leaf, so a tick never
 * re-renders this component.
 *
 * See change: add-composer-dock (task 3.1, 3.2; design D4, D11).
 */
import { ComposerDockRow } from "@blackbelt-technology/dashboard-plugin-runtime";
import { ComposerDockProcessGroupSlot } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { ProcessGroupSummary } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiConsoleLine, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ReactNode } from "react";
import type { InflightBashTool } from "../../hooks/useInflightBashTools.js";
import { t } from "../../lib/i18n/i18n.js";
import { kindIcon, type ProcessEntry } from "../terminal/ProcessList.js";

/** Background process plus the epoch ms it started (scan receipt minus its reported elapsed). */
export interface BackgroundRow {
  process: ProcessEntry;
  startedAt: number;
}

/** Kill progress of one process group: `idle` until Kill, then `stopping`, then `still-running`. */
export type KillStage = "idle" | "stopping" | "still-running";

export interface ProcessesLaneBodyProps {
  session: DashboardSession;
  commands: readonly InflightBashTool[];
  background: readonly BackgroundRow[];
  /** Plugin groups with rows (`count > 0`), keyed by claim. */
  summaries: ReadonlyMap<string, ProcessGroupSummary>;
  killStage: (pgid: number) => KillStage;
  onKill: (pgid: number) => void;
  onShowTool?: (toolCallId: string) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onReportSummary: (claimKey: string, summary: ProcessGroupSummary | null) => void;
}

const ACTION_BUTTON =
  "focus-ring inline-flex items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:hover:bg-transparent";
const KILL_BUTTON = `${ACTION_BUTTON} hover:bg-[var(--tint-red-bg)] hover:text-[var(--tint-red-fg)]`;

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="composer-dock-group-heading"
      className="px-1.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
    >
      {children}
    </div>
  );
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function BackgroundProcessRow({
  row,
  stage,
  onKill,
  onNavigateToSession,
}: {
  row: BackgroundRow;
  stage: KillStage;
  onKill: (pgid: number) => void;
  onNavigateToSession?: (sessionId: string) => void;
}) {
  const { process: p } = row;
  const name = p.label ?? p.command;
  const sessionRef = p.kind === "sub-session" ? p.sessionRef : undefined;
  const status =
    stage === "stopping"
      ? t("dock.processes.stopping", undefined, "Stopping…")
      : stage === "still-running"
        ? t("dock.processes.stillRunning", undefined, "Still running")
        : `pid ${p.pid}`;
  return (
    <ComposerDockRow
      icon={<Icon path={kindIcon(p.kind)} size={0.6} />}
      title={name}
      meta={status}
      startedAt={row.startedAt}
      actions={
        <>
          {sessionRef !== undefined && onNavigateToSession && (
            <a
              // client-sinks: allow — same-origin /session/ route, ref URI-encoded
              href={`/session/${encodeURIComponent(sessionRef)}`}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onNavigateToSession(sessionRef);
              }}
              aria-label={t("dock.processes.openSession", { name }, "Open session {name}")}
              title={t("dock.processes.openSession", { name }, "Open session {name}")}
              className={ACTION_BUTTON}
            >
              <Icon path={mdiOpenInNew} size={0.6} aria-hidden="true" />
              <span className="max-md:hidden">{t("dock.processes.open", undefined, "Open")}</span>
            </a>
          )}
          <button
            type="button"
            disabled={stage === "stopping"}
            onClick={() => onKill(p.pgid)}
            aria-label={t("dock.processes.killLabel", { name }, "Kill {name}")}
            title={t("dock.processes.killTitle", undefined, "Terminate this process group")}
            className={KILL_BUTTON}
          >
            {t("dock.processes.kill", undefined, "Kill")}
          </button>
        </>
      }
    />
  );
}

export function ProcessesLaneBody({
  session,
  commands,
  background,
  summaries,
  killStage,
  onKill,
  onShowTool,
  onNavigateToSession,
  onReportSummary,
}: ProcessesLaneBodyProps) {
  const pluginGroups = [...summaries.entries()].filter(([, s]) => s.count > 0);
  const groupCount = pluginGroups.length + (commands.length > 0 ? 1 : 0) + (background.length > 0 ? 1 : 0);
  const headings = groupCount > 1;
  const noun = (claimKey: string) => summaries.get(claimKey)?.noun;

  return (
    <div data-testid="composer-dock-processes-body" className="grid gap-0.5">
      <ComposerDockProcessGroupSlot
        session={session}
        mode="rows"
        onReport={onReportSummary}
        wrapClaim={(claimKey, node) => {
          const heading = headings ? noun(claimKey) : undefined;
          return (
            <>
              {heading !== undefined && <GroupHeading>{capitalize(heading)}</GroupHeading>}
              {node}
            </>
          );
        }}
      />
      {commands.length > 0 && (
        <>
          {headings && <GroupHeading>{t("dock.processes.headingCommands", undefined, "Commands")}</GroupHeading>}
          {commands.map((c) => (
            <ComposerDockRow
              key={c.toolCallId}
              icon={<Icon path={mdiConsoleLine} size={0.6} />}
              title={c.command}
              startedAt={c.startedAt > 0 ? c.startedAt : undefined}
              actions={
                onShowTool && (
                  <button
                    type="button"
                    onClick={() => onShowTool(c.toolCallId)}
                    aria-label={t("dock.processes.showLabel", { command: c.command }, "Show {command} in the transcript")}
                    className={ACTION_BUTTON}
                  >
                    {t("dock.processes.show", undefined, "Show")}
                  </button>
                )
              }
            />
          ))}
        </>
      )}
      {background.length > 0 && (
        <>
          {headings && <GroupHeading>{t("dock.processes.headingBackground", undefined, "Background")}</GroupHeading>}
          {background.map((row) => (
            <BackgroundProcessRow
              key={row.process.pid}
              row={row}
              stage={killStage(row.process.pgid)}
              onKill={onKill}
              onNavigateToSession={onNavigateToSession}
            />
          ))}
        </>
      )}
    </div>
  );
}
