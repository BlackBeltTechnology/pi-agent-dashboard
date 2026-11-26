/**
 * The single status table of design D12: member status, team status and task
 * state → `{glyph, textKey, sentenceKey?, pill}`. The glyph is an `aria-hidden`
 * shape, the text key resolves (in the lazy view's own table) to the accessible
 * name, the pill state picks the `ui:status-pill` severity family. Status is
 * never colour alone. Pure data, no React and no `@mdi` import (lazy-module use).
 * See change: add-agent-teams-ui (design D12; mockups/ui-plan.md "D12 status table").
 */
import type { MemberStatus, TaskStatus, TeamStatus } from "../shared/types.js";

/** The `ui:status-pill` states (`ui-primitives.ts`); there is no `neutral`, `muted` is the quiet one. */
export const PILL_STATES = ["running", "success", "error", "info", "warn", "muted"] as const;
export type PillState = (typeof PILL_STATES)[number];

export interface StatusEntry {
  /** Shape glyph, `aria-hidden`; pairwise distinct inside one set. */
  glyph: string;
  /** i18n key (lazy-view table), the visible text and accessible name. */
  textKey: string;
  /** `ui:status-pill` state. */
  pill: PillState;
}

export interface MemberStatusEntry extends StatusEntry {
  /** i18n key of the live-region sentence ("{name} is now working"). */
  sentenceKey: string;
}

const member = (status: MemberStatus, glyph: string, pill: PillState): MemberStatusEntry => ({
  glyph,
  textKey: `status.member.${status}`,
  sentenceKey: `announce.member.${status}`,
  pill,
});
const entry = (textKey: string, glyph: string, pill: PillState): StatusEntry => ({ glyph, textKey, pill });

export const MEMBER_STATUS: Readonly<Record<MemberStatus, MemberStatusEntry>> = {
  spawning: member("spawning", "◌", "info"),
  idle: member("idle", "○", "muted"),
  busy: member("busy", "●", "running"),
  shutdown_pending: member("shutdown_pending", "◐", "warn"),
  disconnected: member("disconnected", "⚠", "warn"),
  gone: member("gone", "✕", "muted"),
  failed: member("failed", "✖", "error"),
};

/** Team lifecycle: an extension of the D12 table, same rules. */
export const TEAM_STATUS: Readonly<Record<TeamStatus, StatusEntry>> = {
  starting: entry("status.team.starting", "◌", "info"),
  active: entry("status.team.active", "●", "success"),
  orphaned: entry("status.team.orphaned", "⚠", "warn"),
  closing: entry("status.team.closing", "◐", "warn"),
  closed: entry("status.team.closed", "■", "muted"),
};

export const TASK_STATUS: Readonly<Record<TaskStatus, StatusEntry>> = {
  pending: entry("status.task.pending", "○", "muted"),
  in_progress: entry("status.task.in_progress", "●", "info"),
  completed: entry("status.task.completed", "✓", "success"),
};

/** Derived markers shown next to a task / mail row (server flag decides `blocked`). */
export const TASK_BLOCKED: StatusEntry = entry("status.task.blocked", "⊘", "warn");
export const URGENT_MARKER: StatusEntry = entry("status.urgent", "▲", "warn");

/** Fallback for a status a newer core may add; never throws, renders as text. */
export const UNKNOWN_STATUS: MemberStatusEntry = {
  ...entry("status.unknown", "?", "muted"),
  sentenceKey: "announce.member.unknown",
};

function lookup<E>(table: Readonly<Record<string, E>>, status: unknown): E | undefined {
  return typeof status === "string" && Object.hasOwn(table, status) ? table[status] : undefined;
}

export function memberStatusEntry(status: unknown): MemberStatusEntry {
  return lookup(MEMBER_STATUS, status) ?? UNKNOWN_STATUS;
}
export function teamStatusEntry(status: unknown): StatusEntry {
  return lookup(TEAM_STATUS, status) ?? UNKNOWN_STATUS;
}
export function taskStatusEntry(status: unknown): StatusEntry {
  return lookup(TASK_STATUS, status) ?? UNKNOWN_STATUS;
}
