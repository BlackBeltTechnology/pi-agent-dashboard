/**
 * GoalControl — session-card-action-bar slot.
 *
 * The "Set Goal" control from the mockups: when no goal is set, a compact
 * input + "Set goal" button; when active, pause / done / clear; when paused,
 * resume / clear. Each action dispatches `plugin_action` over the action
 * bridge; the server maps it to a `/goal …` command and sends it into the
 * session (the extension runs the loop).
 *
 * See change: add-goal-continuation-plugin (mockups/ui-plan.md, Decision 4).
 */
import React, { useState } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useSessionEvents, sendPluginAction } from "@blackbelt-technology/dashboard-plugin-runtime";
import { GOAL_PLUGIN_ID } from "../shared/goal-types.js";
import { deriveSnapshot } from "./goal-state.js";

const BTN =
  "text-[9px] px-1.5 py-px rounded border disabled:opacity-50 disabled:cursor-not-allowed";

export function GoalControl({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const events = useSessionEvents(session.id);
  const snapshot = deriveSnapshot(events);
  const [draft, setDraft] = useState("");

  const act = (action: string, payload?: Record<string, unknown>): void =>
    sendPluginAction(GOAL_PLUGIN_ID, session.id, action, payload);

  // No goal yet → compact "Set goal" input.
  if (!snapshot) {
    return (
      <div className="flex items-center gap-1" data-testid="goal-control-empty">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Set a goal…"
          className="flex-1 min-w-0 text-[10px] px-1.5 py-px rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] outline-none focus:border-indigo-400"
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              act("set", { goal: draft.trim() });
              setDraft("");
            }
          }}
        />
        <button
          className={`${BTN} border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10`}
          disabled={!draft.trim()}
          onClick={() => {
            act("set", { goal: draft.trim() });
            setDraft("");
          }}
        >
          Set goal
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" data-testid="goal-control">
      {snapshot.status === "paused" ? (
        <button
          className={`${BTN} border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10`}
          onClick={() => act("resume")}
        >
          ▶ Resume
        </button>
      ) : snapshot.status === "active" ? (
        <>
          <button
            className={`${BTN} border-orange-500/30 text-orange-400 hover:bg-orange-500/10`}
            onClick={() => act("pause")}
          >
            ⏸ Pause
          </button>
          <button
            className={`${BTN} border-green-500/30 text-green-400 hover:bg-green-500/10`}
            onClick={() => act("done")}
          >
            ✓ Done
          </button>
        </>
      ) : null}
      <button
        className={`${BTN} border-red-500/30 text-red-400 hover:bg-red-500/10`}
        onClick={() => act("clear")}
      >
        Clear
      </button>
    </div>
  );
}
