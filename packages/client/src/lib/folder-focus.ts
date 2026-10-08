/**
 * Pure helpers for the opt-in accordion folder list: the attention predicate,
 * the active-folder derivation (latest intent wins) and the render-mode table.
 * No React, no I/O. See change: add-focus-mode-and-card-block-toggles (D6).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** A session needs attention when it asks a question, is working, or is unread. */
export function demandsAttention(s: Pick<DashboardSession, "status" | "currentTool" | "unread">): boolean {
  return s.currentTool === "ask_user" || s.status === "streaming" || s.status === "active" || s.unread === true;
}

export type GroupRenderMode = "full" | "collapsed" | "compactAttention" | "compactEmpty";

export interface RenderModeInput {
  focused: boolean;
  collapsed: boolean;
  pinnedOpen: boolean;
  /** Already gated by `folderAttentionPeek`. */
  hasAttention: boolean;
  /** Session search / workspace filter active → every matching folder is full. */
  forceFull?: boolean;
}

export function resolveGroupRenderMode(i: RenderModeInput): GroupRenderMode {
  if (i.forceFull || i.pinnedOpen) return "full";
  if (i.focused) return i.collapsed ? "collapsed" : "full";
  return i.hasAttention ? "compactAttention" : "compactEmpty";
}

export type FocusIntent = "select" | "activate";

/**
 * The focused folder follows the user's latest intent. An activated folder
 * that no longer renders is treated as cleared (falls back to the selection).
 */
export function resolveActiveCwd(i: {
  selectedCwd: string | null;
  activatedCwd: string | null;
  lastIntent: FocusIntent | null;
  isRendered: (cwd: string) => boolean;
}): string | null {
  if (i.lastIntent === "activate" && i.activatedCwd !== null && i.isRendered(i.activatedCwd)) return i.activatedCwd;
  return i.selectedCwd;
}
