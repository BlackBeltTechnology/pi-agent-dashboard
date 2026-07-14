/**
 * GoalControl — session-card-action-bar slot (Screen D rich chip).
 *
 * For a session linked to a folder-scoped goal, renders a compact live chip:
 * `⚑ turns/budget · verdict` plus an inline Pause control and an open-detail
 * affordance. Loop control round-trips through the existing `plugin_action`
 * channel (`goalCommandFor` → `/goal …`); open navigates to the goal detail
 * route. Renders nothing when the session has no owning `goalId`.
 *
 * See change: sophisticate-goal-authoring-and-control (task 5.4).
 * Original demoted link chip: see change add-goals-folder-page (task 2.2).
 */

import { sendPluginAction, useSessionEvents, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiOpenInNew, mdiPause } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useLocation } from "wouter";
import { GOAL_PLUGIN_ID } from "../shared/goal-types.js";
import { deriveSnapshot } from "./goal-state.js";
import { goalDetailUrl } from "./goals-api.js";

export function GoalControl({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const t = useT();
  const [, navigate] = useLocation();
  const events = useSessionEvents(session.id);
  if (!session.goalId || !session.cwd) return null;

  const snap = deriveSnapshot(events);
  const turns = snap ? `${snap.turnsUsed}/${snap.maxTurns}` : "—";
  const verdict = snap?.lastVerdict;
  const active = snap?.status === "active";

  return (
    <span
      data-testid="goal-control"
      className="inline-flex items-center gap-1 text-[9px] px-1.5 py-px rounded border border-indigo-500/30 text-indigo-400"
      title={
        snap
          ? t(
              "goalStatusTooltip",
              { status: snap.status, turns, verdict: verdict ? ` · ${verdict}` : "" },
              `Goal ${snap.status} · ${turns}${verdict ? ` · ${verdict}` : ""}`,
            )
          : t("openSessionGoal", undefined, "Open this session's goal")
      }
    >
      <span>⚑ {turns}{verdict ? ` · ${verdict}` : ""}</span>
      {active && (
        <button
          data-testid="goal-control-pause"
          onClick={(e) => { e.stopPropagation(); sendPluginAction(GOAL_PLUGIN_ID, session.id, "pause", undefined); }}
          className="hover:text-amber-300"
          title={t("pauseLoop", undefined, "Pause loop")}
        >
          <Icon path={mdiPause} size={0.45} />
        </button>
      )}
      <button
        data-testid="goal-control-link"
        onClick={(e) => { e.stopPropagation(); navigate(goalDetailUrl(session.cwd, session.goalId!)); }}
        className="hover:text-indigo-300"
        title={t("openSessionGoal", undefined, "Open this session's goal")}
      >
        <Icon path={mdiOpenInNew} size={0.45} />
      </button>
    </span>
  );
}
