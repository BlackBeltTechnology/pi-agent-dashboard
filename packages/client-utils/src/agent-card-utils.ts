/**
 * Shared utilities for agent card rendering.
 * Used by FlowAgentCard (flows) and AgentToolRenderer (subagents).
 */

import { mdiAlertCircle, mdiCheckCircle, mdiCircleOutline, mdiCloseCircle, mdiLoading, mdiMinusCircleOutline, mdiPause, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode } from "react";

/** Format a token count compactly: 500 → "500", 12000 → "12k" */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return Math.round(n / 1000) + "k";
}

/** Format milliseconds as human-readable duration */
export function formatDuration(ms: number): string {
  const sec = ms / 1000;
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
}

export type AgentCardStatus = "pending" | "running" | "complete" | "error" | "blocked" | "stopped" | "background" | "elided";

export interface StatusIconDef {
  icon: ReactNode;
  color: string;
}

/** Status icon definitions for agent cards */
export const statusIconDefs: Record<string, StatusIconDef> = {
  pending: { icon: React.createElement(Icon, { path: mdiCircleOutline, size: 0.55 }), color: "text-[var(--text-tertiary)]" },
  running: { icon: React.createElement(Icon, { path: mdiLoading, size: 0.55, className: "animate-spin" }), color: "text-yellow-400" },
  complete: { icon: React.createElement(Icon, { path: mdiCheckCircle, size: 0.55 }), color: "text-green-400" },
  error: { icon: React.createElement(Icon, { path: mdiCloseCircle, size: 0.55 }), color: "text-red-400" },
  blocked: { icon: React.createElement(Icon, { path: mdiAlertCircle, size: 0.55 }), color: "text-orange-400" },
  stopped: { icon: React.createElement(Icon, { path: mdiStop, size: 0.55 }), color: "text-[var(--text-tertiary)]" },
  background: { icon: React.createElement(Icon, { path: mdiPause, size: 0.55 }), color: "text-blue-400" },
  /**
   * Result is not loadable (a backfill segment orphaned this call). Terminal
   * and neutral: static glyph, muted colour, never the running spinner and
   * never error red. See change: fix-lazy-history-backfill-ux (D5).
   */
  elided: { icon: React.createElement(Icon, { path: mdiMinusCircleOutline, size: 0.55 }), color: "text-[var(--text-muted)]" },
};

/** Get status icon + color, with fallback to pending */
export function getStatusIcon(status: string): StatusIconDef {
  return statusIconDefs[status] ?? statusIconDefs.pending;
}
