/**
 * SubagentDockGroup / BackgroundSubagentDockGroup — the subagents plugin's two
 * `composer-dock-process-group` claims: running and not-yet-started subagents
 * in the composer dock's Processes lane, foreground and background (producer
 * ≥ 0.7.0 `run_in_background`) in separate groups. Each claim reports its own
 * `{ count, noun }`; the shell draws one heading per group when both have rows.
 *
 * Two mounts by `mode`:
 *   - `"summary"`: always mounted while a session is bound. Renders `null`
 *     (no DOM, no focusable content, no ticking timer) and only reports
 *     `{ count, noun }` (`subagent(s)` / `background subagent(s)`) — or `null`
 *     when nothing runs — so the dock's header and compact chip can count it
 *     while the lane is collapsed. The dock drops the entry when this unmounts.
 *     It also clears the stop-store entry of every subagent of its own kind
 *     whose map status is terminal (a background run has no live card to do it).
 *   - `"rows"`: mounted only while the lane body is shown. One
 *     `SubagentDockRow` per subagent: name, task, `role · steps`, elapsed,
 *     Stop (when `stoppable`) and Open → `/session/:sid/subagent/:aid`. Status
 *     `created` shows `pending` and no elapsed time.
 *
 * `useSessionSubagents` can index one state under two keys (`id` and
 * `agentSessionId`), so rows are deduped by `state.id`.
 *
 * See change: add-composer-dock (task 3.3, design D4);
 * show-background-subagents-in-dock (D3, D4).
 */
import { ComposerDockRow, useSessionSubagents, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import {
  countSteps,
  isTerminalSubagentStatus,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import { mdiOpenInNew, mdiRobotOutline, mdiTrayArrowDown } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { isBackgroundSubagent } from "./sessionEventReducer.js";
import { clearSubagentStop, requestSubagentStop, useSubagentStopState } from "./subagentStop.js";
import type { SubagentState } from "./types.js";

type DockGroupProps = SlotProps<"composer-dock-process-group">;

/**
 * Copy of the shell's Kill button classes (`ProcessesLaneBody.tsx`
 * `ACTION_BUTTON` + `KILL_BUTTON`; the shell constant is not exported). A test
 * pins it to the shell source so the two cannot drift.
 */
export const DOCK_STOP_BUTTON_CLASS =
  "focus-ring inline-flex items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:hover:bg-transparent hover:bg-[var(--tint-red-bg)] hover:text-[var(--tint-red-fg)]";

/**
 * A subagent waiting for a spawn slot. The session map stores no `queued`
 * status (the tool's own details carry it), so waiting is read from the queue
 * fields: a 1-based position and no slot grant yet.
 */
function queuePositionOf(sub: SubagentState): number | undefined {
  const pos = sub.queuePosition;
  return typeof pos === "number" && Number.isSafeInteger(pos) && pos > 0 && sub.slotGrantedAt === undefined ? pos : undefined;
}

const isLive = (sub: SubagentState): boolean => sub.status === "created" || sub.status === "running";

/** Distinct subagents (the map can dual-index a state) of one kind matching `keep`. */
function subagentsOfKind(
  map: ReadonlyMap<string, SubagentState>,
  background: boolean,
  keep: (sub: SubagentState) => boolean,
): SubagentState[] {
  const seen = new Set<string>();
  const out: SubagentState[] = [];
  for (const sub of map.values()) {
    if (!keep(sub) || isBackgroundSubagent(sub) !== background) continue;
    if (seen.has(sub.id)) continue;
    seen.add(sub.id);
    out.push(sub);
  }
  return out;
}

type Translate = ReturnType<typeof useT>;
type StopPhase = NonNullable<ReturnType<typeof useSubagentStopState>>["phase"];

/** Stop feedback text for a row, or `undefined` when no stop is in flight. */
function stopMeta(phase: StopPhase | undefined, t: Translate): string | undefined {
  if (phase === "pending") return t("dockStopping", undefined, "Stopping…");
  if (phase === "unconfirmed") return t("dockStillRunning", undefined, "Still running");
  if (phase === "error") return t("dockStopFailed", undefined, "Stop failed");
  return undefined;
}

/** Row meta without stop feedback: queue position, `pending`, or `type · N steps`. */
function progressMeta(sub: SubagentState, queuePos: number | undefined, pending: boolean, t: Translate): string {
  if (queuePos !== undefined) return t("agentQueuePos", { pos: queuePos }, "#{pos} in queue");
  if (pending) return t("dockPending", undefined, "pending");
  const steps = countSteps(sub.entries);
  if (steps === 0) return sub.type;
  const stepsLabel =
    steps === 1
      ? t("dockStepOne", { count: steps }, "{count} step")
      : t("dockSteps", { count: steps }, "{count} steps");
  return `${sub.type} · ${stepsLabel}`;
}

/** One subagent row: content, Stop (live + `stoppable`) and Open. Shared by both groups. */
export function SubagentDockRow({ sessionId, sub }: { sessionId: string; sub: SubagentState }) {
  const t = useT();
  const stopState = useSubagentStopState(sessionId, sub.id);
  const name = sub.displayName ?? sub.type;
  const queuePos = queuePositionOf(sub);
  const pending = sub.status === "created" || queuePos !== undefined;
  const meta = stopMeta(stopState?.phase, t) ?? progressMeta(sub, queuePos, pending, t);
  const openLabel = t("dockOpenSubagent", { name, task: sub.description }, "Open subagent {name}: {task}");
  const canStop = isLive(sub) && sub.stoppable === true;
  const stopLabel = pending
    ? t("dockRemoveFromQueueNamed", { name }, "Remove subagent {name} from queue")
    : t("dockStopNamed", { name }, "Stop subagent {name}");
  return (
    <ComposerDockRow
      icon={<Icon path={isBackgroundSubagent(sub) ? mdiTrayArrowDown : mdiRobotOutline} size={0.6} />}
      title={name}
      detail={sub.description}
      meta={meta}
      startedAt={pending ? undefined : (sub.slotGrantedAt ?? sub.startedAt)}
      actions={
        <>
          {canStop && (
            <button
              type="button"
              disabled={stopState?.phase === "pending"}
              onClick={() => void requestSubagentStop(sessionId, sub.id)}
              aria-label={stopLabel}
              title={t("dockStopTitle", undefined, "Stop this subagent (the turn continues)")}
              className={DOCK_STOP_BUTTON_CLASS}
            >
              {t("dockStop", undefined, "Stop")}
            </button>
          )}
          <Link
            href={`/session/${encodeURIComponent(sessionId)}/subagent/${encodeURIComponent(sub.id)}`}
            aria-label={openLabel}
            title={openLabel}
            className="focus-ring inline-flex items-center gap-1 rounded px-1 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Icon path={mdiOpenInNew} size={0.6} aria-hidden="true" />
            <span className="max-md:hidden">{t("dockOpen", undefined, "Open")}</span>
          </Link>
        </>
      }
    />
  );
}

/** Shared body of both claims; `background` selects the kind and the noun. */
function useDockGroup({ session, mode, reportSummary }: DockGroupProps, background: boolean) {
  const t = useT();
  // Downcast the runtime's structural snapshot map to this plugin's `SubagentState`
  // (same cast as `SubagentPopoutClaim`).
  const all = useSessionSubagents(session.id) as unknown as ReadonlyMap<string, SubagentState>;
  const active = useMemo(() => subagentsOfKind(all, background, isLive), [all, background]);
  const count = active.length;
  // The dock prints `noun` verbatim after `count`, so it must agree with the count.
  const noun = background
    ? count === 1
      ? t("dockNounBgSubagentOne", undefined, "background subagent")
      : t("dockNounBgSubagents", undefined, "background subagents")
    : count === 1
      ? t("dockNounSubagentOne", undefined, "subagent")
      : t("dockNounSubagents", undefined, "subagents");

  // Report through a ref so an unstable `reportSummary` identity neither loops
  // nor re-reports; only `count` / `noun` changes do.
  const reportRef = useRef(reportSummary);
  reportRef.current = reportSummary;
  useEffect(() => {
    if (mode !== "summary") return;
    reportRef.current(count > 0 ? { count, noun } : null);
  }, [mode, count, noun]);

  // Summary mode is always mounted: it clears the stop notice of every subagent
  // of its own kind whose MAP status is terminal (never on a row disappearing,
  // so collapsing the lane clears nothing). One clearer per subagent (D4).
  useEffect(() => {
    if (mode !== "summary") return;
    for (const sub of subagentsOfKind(all, background, (s) => isTerminalSubagentStatus(s.status))) {
      clearSubagentStop(session.id, sub.id);
    }
  }, [mode, all, background, session.id]);

  if (mode === "summary" || count === 0) return null;
  return (
    <>
      {active.map((sub) => (
        <SubagentDockRow key={sub.id} sessionId={session.id} sub={sub} />
      ))}
    </>
  );
}

/** Foreground subagents (`subagent(s)`). */
export function SubagentDockGroup(props: DockGroupProps) {
  return useDockGroup(props, false);
}

/** Background subagents (`background subagent(s)`), producer ≥ 0.7.0. */
export function BackgroundSubagentDockGroup(props: DockGroupProps) {
  return useDockGroup(props, true);
}
