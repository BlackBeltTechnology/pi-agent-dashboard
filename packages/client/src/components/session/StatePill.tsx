/**
 * Compact color-coded pill showing an OpenSpec change's `ChangeState`.
 *
 * Rendered next to the attached-change badge on the session card so users
 * can see lifecycle state at a glance instead of inferring it from which
 * action buttons are present.
 */
import React from "react";
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Human label for a ChangeState value. */
export function stateToLabel(state: ChangeState): string {
  return state;
}

/** Tailwind class string for the pill at each state. */
export const STATE_PILL_CLASS: Record<ChangeState, string> = {
  [ChangeState.PLANNING]:
    "text-zinc-400 border border-zinc-500/40 bg-zinc-500/10",
  [ChangeState.READY]:
    "text-blue-400 border border-blue-500/40 bg-blue-500/10",
  [ChangeState.IMPLEMENTING]:
    "text-amber-400 border border-amber-500/40 bg-amber-500/10",
  [ChangeState.COMPLETE]:
    "text-green-400 border border-green-500/40 bg-green-500/10",
};

export function StatePill({ state }: { state: ChangeState }) {
  return (
    <span
      data-testid="state-pill"
      data-state={state}
      className={`text-[9px] font-medium uppercase tracking-wide px-1.5 py-[1px] rounded ${STATE_PILL_CLASS[state]}`}
    >
      {stateToLabel(state)}
    </span>
  );
}
