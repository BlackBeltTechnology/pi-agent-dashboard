/**
 * Processes lane adapter for the composer dock.
 *
 * `useProcessesLane` builds the lane's `DockLane` (header, chip summary, live-region
 * count string, lazy body) from three sources and returns the always-mounted
 * zero-DOM `summary` mounts of the `composer-dock-process-group` claims:
 *   - plugin groups (subagents …): counts arrive through `reportSummary` into a
 *     per-claim map; the entry is dropped when the claim unmounts;
 *   - core commands: unresolved bash tool calls (`useInflightBashTools`);
 *   - core background processes: `session.processes` (bridge scan).
 *
 * The lane exists for a positive total from any source, so a plugin-only count
 * renders it collapsed. Kill progress (`Stopping…` → gone / `Still running`)
 * lives here, not in the body, so collapsing the lane does not reset it. Scans
 * are detected by the identity of `session.processes` (one new array per scan).
 *
 * The header's "longest elapsed" is a leaf (`LongestElapsed`) that owns its
 * tick and is `aria-hidden`, so nothing here re-renders per second and no
 * accessible name or live region carries clock text.
 *
 * See change: add-composer-dock (task 3.1, 3.2; design D4, D11).
 */
import { ComposerDockProcessGroupSlot } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { ProcessGroupSummary } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCogPlayOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { InflightBashTool } from "../../hooks/useInflightBashTools.js";
import { t } from "../../lib/i18n/i18n.js";
import { useNow } from "../../lib/time/use-now.js";
import { formatElapsed, type ProcessEntry } from "../terminal/ProcessList.js";
import { type DockLane, dockLaneLabel } from "./composer-dock-model.js";
import { type BackgroundRow, type KillStage, ProcessesLaneBody } from "./ProcessesLaneBody.js";

export interface ProcessesLaneInput {
  /** Bound session; `undefined` (folder home, no session) → no lane, no mounts. */
  session: DashboardSession | undefined;
  /** Unresolved bash tool calls (`useInflightBashTools`). */
  commands: readonly InflightBashTool[];
  /** `kill_process { pgid }` for the bound session. Never aborts the turn. */
  onKill: (pgid: number) => void;
  /** Scroll the transcript to a command's tool call. */
  onShowTool?: (toolCallId: string) => void;
  /** Open a session (sub-session process rows). */
  onNavigateToSession?: (sessionId: string) => void;
}

export interface ProcessesLaneResult {
  lane: DockLane | null;
  /** Always-mounted `"summary"`-mode claim instances: zero DOM, no focusable content. */
  mounts: ReactNode;
}

/** Scans after Kill (counting the first) that still list the group before `Still running`. */
const SCANS_BEFORE_STILL_RUNNING = 3;

const EMPTY_PROCESSES: readonly ProcessEntry[] = [];
const EMPTY_PROGRESS: ReadonlyMap<number, number> = new Map();
const TIME_TOKEN = "\u0001";

/** Leaf: owns its 1 s tick; `aria-hidden` so no accessible name carries clock text. */
function LongestElapsed({ startedAt }: { startedAt: number }) {
  const now = useNow(true);
  const text = t("dock.processes.longest", { time: TIME_TOKEN }, "longest {time}");
  const [before, after = ""] = text.split(TIME_TOKEN);
  return (
    <span aria-hidden="true" data-testid="composer-dock-longest" className="tabular-nums">
      {before}
      {formatElapsed(Math.max(0, now - startedAt))}
      {after}
    </span>
  );
}

function commandsText(count: number): string {
  return count === 1
    ? t("dock.processes.commandOne", { count }, "{count} command")
    : t("dock.processes.commandOther", { count }, "{count} commands");
}

function backgroundText(count: number, short: boolean): string {
  if (short) return t("dock.processes.backgroundShort", { count }, "{count} background");
  return count === 1
    ? t("dock.processes.backgroundOne", { count }, "{count} background process")
    : t("dock.processes.backgroundOther", { count }, "{count} background processes");
}

/** Header strings: a single group names itself; mixed reads `N running` + `a · b · c`. No clock text. */
function headerText(
  pluginEntries: readonly [string, ProcessGroupSummary][],
  commandCount: number,
  backgroundCount: number,
): { titleText: string; metaText: string; announce: string } {
  const groupCount = pluginEntries.length + (commandCount > 0 ? 1 : 0) + (backgroundCount > 0 ? 1 : 0);
  const single = groupCount === 1;
  const parts = [
    ...pluginEntries.map(([, s]) => `${s.count} ${s.noun}`),
    ...(commandCount > 0 ? [commandsText(commandCount)] : []),
    ...(backgroundCount > 0 ? [backgroundText(backgroundCount, !single)] : []),
  ];
  const total = pluginEntries.reduce((sum, [, s]) => sum + s.count, 0) + commandCount + backgroundCount;
  const titleText = single ? (parts[0] as string) : t("dock.processes.running", { count: total }, "{count} running");
  const metaText = single ? "" : parts.join(" · ");
  return { titleText, metaText, announce: single ? titleText : `${titleText}, ${metaText}` };
}

/** Plugin group counts, one entry per claim; entries with no count are never stored. */
function usePluginSummaries() {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, ProcessGroupSummary>>(new Map());
  const onReportSummary = useCallback((claimKey: string, summary: ProcessGroupSummary | null) => {
    setSummaries((prev) => {
      const current = prev.get(claimKey);
      if (!summary || summary.count <= 0) {
        if (!current) return prev;
        const next = new Map(prev);
        next.delete(claimKey);
        return next;
      }
      if (current && current.count === summary.count && current.noun === summary.noun) return prev;
      return new Map(prev).set(claimKey, { count: summary.count, noun: summary.noun });
    });
  }, []);
  return { summaries, onReportSummary };
}

/** Kill progress: pgid → post-Kill scans that still list it. One scan = a new `scanned` identity. */
function useKillProgress(scanned: readonly ProcessEntry[], onKill: (pgid: number) => void) {
  const [progress, setProgress] = useState<ReadonlyMap<number, number>>(EMPTY_PROGRESS);
  useEffect(() => {
    setProgress((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(scanned.map((p) => p.pgid));
      const next = new Map<number, number>();
      for (const [pgid, scans] of prev) if (present.has(pgid)) next.set(pgid, scans + 1);
      return next;
    });
  }, [scanned]);
  const handleKill = useCallback(
    (pgid: number) => {
      setProgress((prev) => new Map(prev).set(pgid, 0));
      onKill(pgid);
    },
    [onKill],
  );
  const killStage = useCallback(
    (pgid: number): KillStage => {
      const scans = progress.get(pgid);
      if (scans === undefined) return "idle";
      return scans >= SCANS_BEFORE_STILL_RUNNING ? "still-running" : "stopping";
    },
    [progress],
  );
  return { killStage, handleKill };
}

export function useProcessesLane({
  session,
  commands,
  onKill,
  onShowTool,
  onNavigateToSession,
}: ProcessesLaneInput): ProcessesLaneResult {
  const { summaries, onReportSummary } = usePluginSummaries();
  const scanned = session?.processes ?? EMPTY_PROCESSES;
  const background = useMemo<BackgroundRow[]>(() => {
    const receivedAt = Date.now();
    return scanned.map((process) => ({ process, startedAt: receivedAt - process.elapsedMs }));
  }, [scanned]);
  const { killStage, handleKill } = useKillProgress(scanned, onKill);

  const pluginEntries = useMemo(
    () => [...summaries.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [summaries],
  );
  const pluginTotal = pluginEntries.reduce((sum, [, s]) => sum + s.count, 0);
  const total = pluginTotal + commands.length + background.length;

  const longestStartedAt = useMemo(() => {
    const starts = [
      ...commands.map((c) => c.startedAt).filter((s) => s > 0),
      ...background.map((b) => b.startedAt),
    ];
    return starts.length > 0 ? Math.min(...starts) : undefined;
  }, [commands, background]);

  const mounts = session ? (
    <ComposerDockProcessGroupSlot session={session} mode="summary" onReport={onReportSummary} />
  ) : null;

  if (!session || total === 0) return { lane: null, mounts };

  const { titleText, metaText, announce } = headerText(pluginEntries, commands.length, background.length);

  const lane: DockLane = {
    key: "processes",
    label: dockLaneLabel("processes"),
    icon: <Icon path={mdiCogPlayOutline} size={0.7} />,
    title: <span className="font-semibold">{titleText}</span>,
    meta:
      metaText || longestStartedAt !== undefined ? (
        <span>
          {metaText}
          {metaText && longestStartedAt !== undefined ? " · " : ""}
          {longestStartedAt !== undefined && <LongestElapsed startedAt={longestStartedAt} />}
        </span>
      ) : undefined,
    summary: total,
    summaryText: announce,
    expandable: true,
    announce,
    renderBody: () => (
      <ProcessesLaneBody
        session={session}
        commands={commands}
        background={background}
        summaries={summaries}
        killStage={killStage}
        onKill={handleKill}
        onShowTool={onShowTool}
        onNavigateToSession={onNavigateToSession}
        onReportSummary={onReportSummary}
      />
    ),
  };
  return { lane, mounts };
}
