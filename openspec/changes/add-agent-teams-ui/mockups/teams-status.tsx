// MOCK-ONLY. The single status table of design D12 (what `status-map.ts` will be on promotion, task 8.x).
// status -> { glyph, text, pill state }. The glyph is an aria-hidden shape, the text is the accessible name,
// the pill state picks the severity family. `--text-muted` never carries the information (ui-contract.md).
// Uses the runtime kit's `SettingsStatusPill` (the implementation behind `ui:status-pill`) with `icon={null}`:
// `ui:status-pill` adds its own default icon for `running` (spinner) and `muted` (minus), which would double
// the table glyph. Promotion decision recorded in ui-plan.md.
// See change: add-agent-teams-ui (design D12, D10).
import { SettingsStatusPill, type SettingsStatusTone } from "@rt/index.ts";
import type { MemberStatus, TaskStatus, TeamStatus } from "@teams/shared/types.ts";

/** The `ui:status-pill` states (`ui-primitives.ts`); there is no `neutral`, `muted` is the quiet one. */
export type PillState = "running" | "success" | "error" | "info" | "warn" | "muted";

const TONE: Record<PillState, SettingsStatusTone> = {
  running: "info",
  success: "success",
  error: "error",
  info: "info",
  warn: "warning",
  muted: "neutral",
};

export interface StatusEntry {
  glyph: string;
  text: string;
  pill: PillState;
  /** Sentence used by the live region and as the card's accessible description. */
  sentence: string;
}

export const MEMBER_STATUS: Record<MemberStatus, StatusEntry> = {
  spawning: { glyph: "◌", text: "Starting", pill: "info", sentence: "is starting" },
  idle: { glyph: "○", text: "Idle", pill: "muted", sentence: "is idle" },
  busy: { glyph: "●", text: "Working", pill: "running", sentence: "is now working" },
  shutdown_pending: { glyph: "◐", text: "Shutting down", pill: "warn", sentence: "is shutting down" },
  disconnected: { glyph: "⚠", text: "Disconnected", pill: "warn", sentence: "lost its connection" },
  gone: { glyph: "✕", text: "Gone", pill: "muted", sentence: "has left the team" },
  failed: { glyph: "✖", text: "Failed", pill: "error", sentence: "failed" },
};

/** Team lifecycle: an extension of the D12 table, same rules (shape + text + pill state). */
export const TEAM_STATUS: Record<TeamStatus, StatusEntry> = {
  starting: { glyph: "◌", text: "Starting", pill: "info", sentence: "is starting" },
  active: { glyph: "●", text: "Active", pill: "success", sentence: "is active" },
  orphaned: { glyph: "⚠", text: "Lead ended", pill: "warn", sentence: "lost its lead" },
  closing: { glyph: "◐", text: "Closing", pill: "warn", sentence: "is closing" },
  closed: { glyph: "■", text: "Closed", pill: "muted", sentence: "closed" },
};

export const TASK_STATUS: Record<TaskStatus, StatusEntry> = {
  pending: { glyph: "○", text: "Pending", pill: "muted", sentence: "is pending" },
  in_progress: { glyph: "●", text: "In progress", pill: "info", sentence: "is in progress" },
  completed: { glyph: "✓", text: "Completed", pill: "success", sentence: "is completed" },
};

function Pill({ entry, status, testId, pulse }: { entry: StatusEntry; status: string; testId?: string; pulse?: boolean }) {
  return (
    <SettingsStatusPill tone={TONE[entry.pill]} icon={null} status={status} testId={testId}>
      <span aria-hidden="true" className={pulse ? "animate-pulse motion-reduce:animate-none" : undefined}>
        {entry.glyph}
      </span>
      {entry.text}
    </SettingsStatusPill>
  );
}

/** `data-testid="team-member-status"` + `data-status` is the contract of change 5 (design D14). */
export function MemberStatusPill({ status }: { status: MemberStatus }) {
  return <Pill entry={MEMBER_STATUS[status]} status={status} testId="team-member-status" pulse={status === "busy"} />;
}

export function TeamStatusPill({ status }: { status: TeamStatus }) {
  return <Pill entry={TEAM_STATUS[status]} status={status} testId="team-status" />;
}

export function TaskStatusGlyph({ status }: { status: TaskStatus }) {
  return <Pill entry={TASK_STATUS[status]} status={status} />;
}
