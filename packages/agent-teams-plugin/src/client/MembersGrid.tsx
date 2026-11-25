/**
 * MembersGrid — the Team view's members TABLE (owner decision, `mockups/ui-plan.md`
 * "Decisions": table, ≥ 44 px row targets, wraps on a phone). Native table above
 * `sm`; below it every row stacks into a block with its own column labels, so
 * nothing scrolls sideways. Each row: name + role, status (glyph + text + pill
 * state), model, current task (lowest in-progress id + "+N more"), folder, Open
 * session link, Stop button (busy ∧ control ∧ team not closing/closed) with its
 * inline error. Rows are memoised by value, so a refetch re-renders only the
 * member whose data changed. Test ids: `team-member-card` (row),
 * `team-member-open-subagent`, `team-member-status` (+ `data-status`).
 * See change: add-agent-teams-ui (design D10, D14; tasks 8.4, 8.6).
 */
import { SettingsActionError, SettingsNotice } from "@blackbelt-technology/dashboard-plugin-runtime";
import { memo, type ReactElement } from "react";
import { Link } from "wouter";
import type { SnapshotMember, SnapshotTask } from "../shared/snapshot.js";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { formatCwd } from "./format-cwd.js";
import { type ControlNote, noteKey } from "./team-controls.js";
import { BTN, Empty, LINKBTN, MemberStatusPill, useViewT } from "./view-kit.js";

const numeric = (id: string): number => (/^\d+$/.test(id) ? Number(id) : Number.POSITIVE_INFINITY);

/** In-progress tasks a member owns, lowest id first (ties by string order). */
export function currentTasks(tasks: readonly SnapshotTask[], member: string): SnapshotTask[] {
  return tasks.filter((t) => t.status === "in_progress" && t.owner === member).sort((a, b) => numeric(a.id) - numeric(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface MembersGridProps {
  snap: TeamUiSnapshot;
  notes: Readonly<Record<string, ControlNote | undefined>>;
  /** Members whose Stop POST is pending. */
  pending: ReadonlySet<string>;
  onStop: (name: string) => void;
  /** Open the board on a task (switch to Tasks, focus the card). */
  onFocusTask: (id: string) => void;
  /** "+N more": open the board filtered to this member. */
  onShowMemberTasks: (name: string) => void;
}

export interface RowProps {
  m: SnapshotMember;
  leadCwd: string;
  firstId: string | undefined;
  firstTitle: string | undefined;
  more: number;
  canStop: boolean;
  note: ControlNote | undefined;
  stopping: boolean;
  onStop: (name: string) => void;
  onFocusTask: (id: string) => void;
  onShowMemberTasks: (name: string) => void;
}

const sameMember = (a: SnapshotMember, b: SnapshotMember): boolean =>
  a.name === b.name && a.role === b.role && a.sessionId === b.sessionId && a.cwd === b.cwd && a.model === b.model && a.status === b.status && a.degraded === b.degraded && a.goneReason === b.goneReason;

/** Memo gate of a row: by value, so a refetch that replaces every object re-renders only changed members. */
export const sameMemberRow = (a: RowProps, b: RowProps): boolean =>
  sameMember(a.m, b.m) &&
  a.leadCwd === b.leadCwd &&
  a.firstId === b.firstId &&
  a.firstTitle === b.firstTitle &&
  a.more === b.more &&
  a.canStop === b.canStop &&
  a.note === b.note &&
  a.stopping === b.stopping &&
  a.onStop === b.onStop &&
  a.onFocusTask === b.onFocusTask &&
  a.onShowMemberTasks === b.onShowMemberTasks;

/** Column label shown only on a phone (the header row is `sr-only` there). */
function Label({ children }: { children: string }): ReactElement {
  return <span className="mb-0.5 block text-[11px] font-semibold text-[var(--text-secondary)] sm:hidden">{children}</span>;
}

const CELL = "px-2 py-1.5 align-top max-sm:block max-sm:py-1";

function TaskCell({ name, firstId, firstTitle, more, onFocusTask, onShowMemberTasks }: { name: string; firstId: string | undefined; firstTitle: string | undefined; more: number; onFocusTask: (id: string) => void; onShowMemberTasks: (name: string) => void }): ReactElement {
  const t = useViewT();
  return (
      <td className={`${CELL} min-w-[14ch] sm:max-w-[28ch]`}>
        <Label>{t("members.col.task")}</Label>
        {firstId !== undefined ? (
          <>
            <button type="button" className={LINKBTN} data-testid="team-member-task" onClick={() => onFocusTask(firstId)}>
              #{firstId} {firstTitle}
            </button>
            {more > 0 ? (
              <button type="button" className={`${LINKBTN} ml-1 font-semibold`} data-testid="team-member-more" aria-label={t("members.moreTasksLabel", { name: name })} onClick={() => onShowMemberTasks(name)}>
                {t("members.moreTasks", { n: more })}
              </button>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--text-secondary)]">{t("members.noTask")}</span>
        )}
      </td>
  );
}

const MemberRow = memo(function MemberRow({ m, leadCwd, firstId, firstTitle, more, canStop, note, stopping, onStop, onFocusTask, onShowMemberTasks }: RowProps): ReactElement {
  const t = useViewT();
  const errId = `team-member-err-${m.name}`;
  return (
    <tr data-testid="team-member-card" data-member={m.name} className="border-t border-[var(--border-secondary)] first:border-t-0 max-sm:block max-sm:p-1.5">
      <td className={`${CELL} min-w-[12ch]`}>
        <Label>{t("members.col.member")}</Label>
        <div className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.name}</div>
        {m.role ? <div className="text-[11px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{m.role}</div> : null}
      </td>
      <td className={`${CELL} space-y-1`}>
        <Label>{t("members.col.status")}</Label>
        <MemberStatusPill status={m.status} />
        {m.degraded ? (
          <SettingsNotice tone="warning" testId="team-member-degraded">
            <span className="font-semibold">{t("members.limited")}.</span> {m.degraded === "guard_unavailable" ? t("members.degraded.guard_unavailable") : t("members.degraded.other", { value: m.degraded })}
          </SettingsNotice>
        ) : null}
        {m.goneReason ? <div className="text-[11px] text-[var(--text-secondary)]">{t("members.reason", { reason: m.goneReason })}</div> : null}
      </td>
      <td className={CELL}>
        <Label>{t("members.col.model")}</Label>
        <span className="font-mono text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.model ?? t("members.inheritsModel")}</span>
      </td>
      <TaskCell name={m.name} firstId={firstId} firstTitle={firstTitle} more={more} onFocusTask={onFocusTask} onShowMemberTasks={onShowMemberTasks} />
      <td className={CELL}>
        <Label>{t("members.col.folder")}</Label>
        <span className="font-mono text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]">{formatCwd(m.cwd, leadCwd)}</span>
      </td>
      <td className={CELL}>
        <Label>{t("members.col.actions")}</Label>
        <div className="flex flex-col items-start gap-1">
          {m.sessionId ? (
            <Link data-testid="team-member-open-subagent" href={`/session/${encodeURIComponent(m.sessionId)}`} className={`${LINKBTN} font-semibold`}>
              {t("members.openSession")}
            </Link>
          ) : (
            <span className="text-[var(--text-secondary)]">{t("members.sessionRemoved")}</span>
          )}
          {canStop ? (
            <button type="button" className={BTN} data-testid="team-member-stop" disabled={stopping} aria-describedby={note ? errId : undefined} onClick={() => onStop(m.name)}>
              {stopping ? t("members.stopping") : t("members.stop")}
            </button>
          ) : null}
          {note ? <SettingsActionError id={errId} testId="team-member-stop-error">{t(noteKey(note))}</SettingsActionError> : null}
        </div>
      </td>
    </tr>
  );
}, sameMemberRow);

export function MembersGrid({ snap, notes, pending, onStop, onFocusTask, onShowMemberTasks }: MembersGridProps): ReactElement {
  const t = useViewT();
  if (snap.members.length === 0) return <Empty testId="team-members-empty" title={t("members.empty.title")} hint={t("members.empty.hint")} />;
  const stoppable = snap.status !== "closed" && snap.status !== "closing";
  return (
    <div className="max-w-full rounded-md border border-[var(--border-secondary)] sm:overflow-x-auto" data-testid="team-members">
      <table className="w-full border-collapse text-left text-[12px] text-[var(--text-primary)] max-sm:block">
        <caption className="sr-only">{t("members.caption")}</caption>
        <thead className="bg-[var(--bg-tertiary)] max-sm:sr-only">
          <tr>
            {(["member", "status", "model", "task", "folder", "actions"] as const).map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 font-semibold text-[var(--text-secondary)]">
                {t(`members.col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {snap.members.map((m) => {
            const tasks = currentTasks(snap.tasks, m.name);
            return (
              <MemberRow
                key={m.name}
                m={m}
                leadCwd={snap.leadCwd}
                firstId={tasks[0]?.id}
                firstTitle={tasks[0]?.title}
                more={Math.max(0, tasks.length - 1)}
                canStop={snap.viewerCanControl && stoppable && m.status === "busy"}
                note={notes[m.name]}
                stopping={pending.has(m.name)}
                onStop={onStop}
                onFocusTask={onFocusTask}
                onShowMemberTasks={onShowMemberTasks}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
