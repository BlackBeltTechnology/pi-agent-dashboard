/**
 * SubagentDockGroup — the subagents plugin's `composer-dock-process-group`
 * claim: running and not-yet-started subagents in the composer dock's
 * Processes lane.
 *
 * Two mounts by `mode`:
 *   - `"summary"`: always mounted while a session is bound. Renders `null`
 *     (no DOM, no focusable content, no ticking timer) and only reports
 *     `{ count, noun: "subagents" }` (`"subagent"` for 1) — or `null` when nothing runs — so the
 *     dock's header and compact chip can count it while the lane is collapsed.
 *     The dock drops the entry when this component unmounts.
 *   - `"rows"`: mounted only while the lane body is shown. One
 *     `ComposerDockRow` per subagent: name, task, `role · steps`, elapsed,
 *     and Open → `/session/:sid/subagent/:aid`. Status `created` shows
 *     `pending` and no elapsed time (matches `SubagentDetailView`'s
 *     `created` → `pending` mapping).
 *
 * `useSessionSubagents` can index one state under two keys (`id` and
 * `agentSessionId`), so rows are deduped by `state.id`.
 *
 * See change: add-composer-dock (task 3.3, design D4).
 */
import { ComposerDockRow, useSessionSubagents, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { countSteps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import { mdiOpenInNew, mdiRobotOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import type { SubagentState } from "./types.js";

type DockGroupProps = SlotProps<"composer-dock-process-group">;

/** Running or waiting subagents, one per `id` (the map can dual-index a state). */
function activeSubagents(map: ReadonlyMap<string, SubagentState>): SubagentState[] {
  const seen = new Set<string>();
  const out: SubagentState[] = [];
  for (const sub of map.values()) {
    if (sub.status !== "created" && sub.status !== "running") continue;
    if (seen.has(sub.id)) continue;
    seen.add(sub.id);
    out.push(sub);
  }
  return out;
}

export function SubagentDockGroup({ session, mode, reportSummary }: DockGroupProps) {
  const t = useT();
  // Downcast the runtime's structural snapshot map to this plugin's `SubagentState`
  // (same cast as `SubagentPopoutClaim`).
  const all = useSessionSubagents(session.id) as unknown as ReadonlyMap<string, SubagentState>;
  const active = useMemo(() => activeSubagents(all), [all]);
  const count = active.length;
  // The dock prints `noun` verbatim after `count`, so it must agree with the count.
  const noun =
    count === 1 ? t("dockNounSubagentOne", undefined, "subagent") : t("dockNounSubagents", undefined, "subagents");

  // Report through a ref so an unstable `reportSummary` identity neither loops
  // nor re-reports; only `count` / `noun` changes do.
  const reportRef = useRef(reportSummary);
  reportRef.current = reportSummary;
  useEffect(() => {
    if (mode !== "summary") return;
    reportRef.current(count > 0 ? { count, noun } : null);
  }, [mode, count, noun]);

  if (mode === "summary" || count === 0) return null;

  return (
    <>
      {active.map((sub) => {
        const name = sub.displayName ?? sub.type;
        const pending = sub.status === "created";
        const steps = countSteps(sub.entries);
        const stepsLabel =
          steps === 1
            ? t("dockStepOne", { count: steps }, "{count} step")
            : t("dockSteps", { count: steps }, "{count} steps");
        const meta = pending
          ? t("dockPending", undefined, "pending")
          : steps > 0
            ? `${sub.type} · ${stepsLabel}`
            : sub.type;
        const openLabel = t("dockOpenSubagent", { name, task: sub.description }, "Open subagent {name}: {task}");
        return (
          <ComposerDockRow
            key={sub.id}
            icon={<Icon path={mdiRobotOutline} size={0.6} />}
            title={name}
            detail={sub.description}
            meta={meta}
            startedAt={pending ? undefined : sub.startedAt}
            actions={
              <Link
                href={`/session/${encodeURIComponent(session.id)}/subagent/${encodeURIComponent(sub.id)}`}
                aria-label={openLabel}
                title={openLabel}
                className="focus-ring inline-flex items-center gap-1 rounded px-1 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Icon path={mdiOpenInNew} size={0.6} aria-hidden="true" />
                <span className="max-md:hidden">{t("dockOpen", undefined, "Open")}</span>
              </Link>
            }
          />
        );
      })}
    </>
  );
}
