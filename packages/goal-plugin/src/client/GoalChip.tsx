/**
 * GoalChip — session-card-badge slot component.
 *
 * Renders the live goal status next to the queue chips on Line 2 of the
 * card: `● Pursuing n/m` (active), `⏸ Paused · <reason>` (paused),
 * `✓ Achieved` (done). Hidden when no snapshot (predicate-gated by `hasGoal`,
 * plus a defensive null return).
 *
 * Reads the plugin per-session event store via `useSessionEvents` and folds
 * to the latest snapshot. Theme-reactive palette.
 *
 * See change: add-goal-continuation-plugin (mockups/ui-plan.md).
 */
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import { deriveSnapshot } from "./goal-state.js";
import { goalDetailUrl } from "./goals-api.js";

/** Tracks `<html data-theme>` so the palette flips with the dashboard theme. */
function useIsLightTheme(): boolean {
  const read = () =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";
  const [light, setLight] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

export function GoalChip({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const events = useSessionEvents(session.id);
  const light = useIsLightTheme();
  const [, navigate] = useLocation();
  const snapshot = deriveSnapshot(events);
  if (!snapshot) return null;

  const { status, goal, turnsUsed, maxTurns, lastVerdict, lastReason } = snapshot;

  let label: string;
  let dot: string;
  let palette: { background: string; color: string };
  if (status === "done") {
    label = "Achieved";
    dot = "✓";
    palette = light
      ? { background: "rgba(52,211,153,0.15)", color: "rgb(4,120,87)" }
      : { background: "rgba(52,211,153,0.15)", color: "rgb(110,231,183)" };
  } else if (status === "paused") {
    label = lastReason ? `Paused · ${lastReason}` : "Paused";
    dot = "⏸";
    palette = light
      ? { background: "rgba(251,191,36,0.15)", color: "rgb(146,96,10)" }
      : { background: "rgba(251,191,36,0.15)", color: "rgb(252,211,77)" };
  } else {
    label = `Pursuing ${turnsUsed}/${maxTurns}`;
    dot = "●";
    palette = light
      ? { background: "rgba(99,102,241,0.15)", color: "rgb(67,56,202)" }
      : { background: "rgba(99,102,241,0.15)", color: "rgb(165,180,252)" };
  }

  const tooltip =
    `Goal: ${goal}` +
    `\nStatus: ${status} (${turnsUsed}/${maxTurns})` +
    (lastVerdict ? `\nLast verdict: ${lastVerdict}` : "") +
    (lastReason ? `\nReason: ${lastReason}` : "");

  // When this session is linked to a folder-scoped goal, the chip becomes a
  // read-only link to that goal's detail page (task 5.1). Otherwise it stays
  // a plain status badge.
  const linkable = !!(session.goalId && session.cwd);
  const goTo = (e: React.SyntheticEvent): void => {
    e.stopPropagation();
    navigate(goalDetailUrl(session.cwd, session.goalId!));
  };
  return (
    <span
      data-testid="goal-chip"
      title={tooltip}
      onClick={linkable ? goTo : undefined}
      onKeyDown={linkable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(e); } } : undefined}
      role={linkable ? "link" : undefined}
      tabIndex={linkable ? 0 : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full font-mono text-[10px]${linkable ? " cursor-pointer hover:brightness-110" : ""}`}
      style={{ ...palette, verticalAlign: "middle" }}
    >
      <span>{dot}</span>
      <span>{label}</span>
    </span>
  );
}
