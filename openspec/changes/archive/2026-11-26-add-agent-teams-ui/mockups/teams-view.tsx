// MOCK-ONLY Team view (tasks 1.4, 1.8): the lazy `shell-overlay-route` body of design D1/D10, built from the
// runtime kit (`SettingsStatusPill`, `SettingsNotice`, `SettingsActionError`, `SettingsTable`) and host tokens
// only. Prop-driven: layout, members presentation and board arrangement are explicit props (the pane is not a
// viewport, so `lg:` media queries cannot decide a variant); the production component will switch on `lg:`
// and render the winning variants. NOT production code (promotion happens in section 8 of tasks.md).
// Agent-authored text is React text children with `whitespace-pre-wrap` + `overflow-wrap:anywhere` (D11).
// See change: add-agent-teams-ui (design D10, D11, D12, D14).
import { SettingsActionError, SettingsNotice, SettingsStatusPill, SettingsTable } from "@rt/index.ts";
import { mdiArrowLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { SnapshotMail, SnapshotMember, SnapshotTask } from "@teams/shared/snapshot.ts";
import type { TeamUiSnapshot } from "@teams/shared/ui-protocol.ts";
import { Fix, Issue } from "mock-site/kit";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { MemberStatusPill, TASK_STATUS, TeamStatusPill } from "./teams-status";

// ---------------------------------------------------------------- rings

export type Target = "body" | "tabs" | "heads" | "members" | "board" | "log";
export type Side = "a" | "b";
/** Ring spec per changed div. `side` picks the colour (Issue = variant A on the left, Fix = variant B on the right). */
export interface Rings {
  side: Side;
  on: Partial<Record<Target, { n: number | string; tip: string }>>;
}

function R({ rings, target, children }: { rings?: Rings; target: Target; children: ReactNode }) {
  const spec = rings?.on[target];
  if (!rings || !spec) return <>{children}</>;
  return rings.side === "a" ? (
    <Issue n={spec.n} tip={spec.tip} block>
      {children}
    </Issue>
  ) : (
    <Fix n={spec.n} tip={spec.tip} block>
      {children}
    </Fix>
  );
}

// ---------------------------------------------------------------- recipes (tokens only)

const BTN =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-secondary)]";
const BTN_DANGER =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md border px-3 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold tint-action-red disabled:cursor-not-allowed";
const CHIP =
  "inline-flex max-w-full items-center rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]";
const LINKBTN =
  "focus-ring inline-flex items-center rounded text-left text-[12px] text-[var(--link)] hover:text-[var(--link-hover)] hover:underline min-h-[44px] sm:min-h-[24px] [overflow-wrap:anywhere]";
const SECTION_H = "text-[12px] font-semibold text-[var(--text-secondary)]";
const TEXT = "whitespace-pre-wrap [overflow-wrap:anywhere]";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });

function relCwd(cwd: string, leadCwd: string): string {
  if (cwd === leadCwd) return ".";
  return cwd.startsWith(`${leadCwd}/`) ? cwd.slice(leadCwd.length + 1) : cwd;
}

function currentTasks(snap: TeamUiSnapshot, member: string): SnapshotTask[] {
  return snap.tasks.filter((t) => t.status === "in_progress" && t.owner === member).sort((a, b) => Number(a.id) - Number(b.id));
}

// ---------------------------------------------------------------- members

export type MemberNote = "forbidden" | "not_busy" | "no_response";

const NOTE_COPY: Record<MemberNote, string> = {
  forbidden: "You don't have permission to stop this member. Ask the team's owner or use a credential with control access.",
  not_busy: "This member is no longer working, so there was nothing to stop.",
  no_response: "No response — checking state. The button is enabled again; nothing was retried.",
};

function MemberCard({ snap, m, notes, onFocusTask }: { snap: TeamUiSnapshot; m: SnapshotMember; notes?: Partial<Record<string, MemberNote>>; onFocusTask?: (id: string) => void }) {
  const tasks = currentTasks(snap, m.name);
  const first = tasks[0];
  const note = notes?.[m.name];
  const errId = `team-member-err-${m.name}`;
  const canStop = snap.viewerCanControl && m.status === "busy" && snap.status !== "closed" && snap.status !== "closing";
  return (
    <li
      data-testid="team-member-card"
      data-member={m.name}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2.5 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 grow basis-[6ch] text-sm font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.name}</span>
        <MemberStatusPill status={m.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-[var(--text-secondary)]">
        {m.role ? <span className={CHIP}>{m.role}</span> : null}
        <span className="font-mono text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.model ?? "inherits the lead's model"}</span>
      </div>
      <div className="text-[12px]">
        {first ? (
          <>
            <span className="text-[var(--text-secondary)]">Working on </span>
            <button type="button" className={LINKBTN} onClick={() => onFocusTask?.(first.id)}>
              #{first.id} {first.title}
            </button>
            {tasks.length > 1 ? (
              <button type="button" className={`${LINKBTN} ml-1 font-semibold`}>
                +{tasks.length - 1} more
              </button>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--text-secondary)]">No current task</span>
        )}
      </div>
      <div className="text-[11px] text-[var(--text-secondary)]">
        <span>Folder </span>
        <span className="font-mono text-[var(--text-primary)] [overflow-wrap:anywhere]">{relCwd(m.cwd, snap.leadCwd)}</span>
      </div>
      {m.degraded ? (
        <SettingsNotice tone="warning" testId="team-member-degraded">
          <span className="font-semibold">Limited protection.</span> {m.degraded === "guard_unavailable" ? "The member's safety guard is unavailable, so its tool use is not checked." : `Condition: ${m.degraded}.`}
        </SettingsNotice>
      ) : null}
      {m.goneReason ? <div className="text-[11px] text-[var(--text-secondary)]">Reason: {m.goneReason}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        {m.sessionId ? (
          <a data-testid="team-member-open-subagent" href={`/session/${m.sessionId}`} className={`${LINKBTN} font-semibold`}>
            Open session
          </a>
        ) : (
          <span className="text-[12px] text-[var(--text-secondary)]">session removed</span>
        )}
        {canStop ? (
          <button type="button" className={`${BTN} ml-auto`} aria-describedby={note ? errId : undefined} disabled={note === "no_response"}>
            Stop
          </button>
        ) : null}
      </div>
      {note ? <SettingsActionError id={errId}>{NOTE_COPY[note]}</SettingsActionError> : null}
    </li>
  );
}

export function MembersCards({ snap, notes, cols = 2, rings, onFocusTask }: { snap: TeamUiSnapshot; notes?: Partial<Record<string, MemberNote>>; cols?: 1 | 2 | 3; rings?: Rings; onFocusTask?: (id: string) => void }) {
  if (snap.members.length === 0) return <Empty title="No members yet" hint="The lead has not started a teammate. Members appear here as soon as one starts." />;
  const grid = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <R rings={rings} target="members">
      <ul className={`grid ${grid} gap-3`} aria-label="Team members">
        {snap.members.map((m) => (
          <MemberCard key={m.name} snap={snap} m={m} notes={notes} onFocusTask={onFocusTask} />
        ))}
      </ul>
    </R>
  );
}

export function MembersTable({ snap, notes, rings }: { snap: TeamUiSnapshot; notes?: Partial<Record<string, MemberNote>>; rings?: Rings }) {
  if (snap.members.length === 0) return <Empty title="No members yet" hint="The lead has not started a teammate. Members appear here as soon as one starts." />;
  const rows = snap.members.map((m) => {
    const tasks = currentTasks(snap, m.name);
    const first = tasks[0];
    const note = notes?.[m.name];
    const canStop = snap.viewerCanControl && m.status === "busy" && snap.status !== "closed" && snap.status !== "closing";
    return {
      key: m.name,
      testId: "team-member-card",
      cells: [
        <div key="n" className="min-w-[12ch]">
          <div className="font-semibold [overflow-wrap:anywhere]">{m.name}</div>
          {m.role ? <div className="text-[11px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{m.role}</div> : null}
        </div>,
        <div key="s" className="space-y-1">
          <MemberStatusPill status={m.status} />
          {m.degraded ? <div className="text-[11px] font-semibold text-[var(--severity-warning-fg)]">Limited protection</div> : null}
        </div>,
        <span key="m" className="font-mono text-[11px] [overflow-wrap:anywhere]">{m.model ?? "inherits the lead's model"}</span>,
        <div key="t" className="min-w-[14ch] max-w-[28ch]">
          {first ? (
            <button type="button" className={LINKBTN}>
              #{first.id} {first.title}
              {tasks.length > 1 ? ` (+${tasks.length - 1} more)` : ""}
            </button>
          ) : (
            <span className="text-[var(--text-secondary)]">No current task</span>
          )}
        </div>,
        <span key="c" className="font-mono text-[11px] [overflow-wrap:anywhere]">{relCwd(m.cwd, snap.leadCwd)}</span>,
        <div key="a" className="flex flex-col items-start gap-1">
          {m.sessionId ? (
            <a data-testid="team-member-open-subagent" href={`/session/${m.sessionId}`} className={`${LINKBTN} font-semibold`}>
              Open session
            </a>
          ) : (
            <span className="text-[var(--text-secondary)]">session removed</span>
          )}
          {canStop ? (
            <button type="button" className={BTN} aria-describedby={note ? `team-member-err-${m.name}` : undefined}>
              Stop
            </button>
          ) : null}
          {note ? <SettingsActionError id={`team-member-err-${m.name}`}>{NOTE_COPY[note]}</SettingsActionError> : null}
        </div>,
      ],
    };
  });
  return (
    <R rings={rings} target="members">
      <SettingsTable caption="Team members" columns={["Member", "Status", "Model", "Working on", "Folder", "Actions"]} rows={rows} />
    </R>
  );
}

// ---------------------------------------------------------------- tasks

function depChip(snap: TeamUiSnapshot, id: string): { text: string; open: boolean } {
  const dep = snap.tasks.find((t) => t.id === id);
  if (!dep) return { text: `waits for #${id} — missing`, open: true };
  if (dep.status === "completed") return { text: `#${id} — completed`, open: false };
  return { text: `waits for #${id} — ${TASK_STATUS[dep.status].text.toLowerCase()}`, open: true };
}

function TaskCard({ snap, t, open, onToggle }: { snap: TeamUiSnapshot; t: SnapshotTask; open: boolean; onToggle: () => void }) {
  const uid = useId();
  const panel = `${uid}-details`;
  const deps = t.blockedBy.map((id) => depChip(snap, id));
  return (
    <li id={`team-task-${t.id}`} data-testid="team-task-card" data-task={t.id} className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">#{t.id}</span>
        <span className="min-w-0 grow basis-[10ch] text-[12px] font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{t.title}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className={CHIP}>{t.owner ?? "unassigned"}</span>
        {t.blocked ? (
          <SettingsStatusPill tone="warning" icon={null} status="blocked">
            <span aria-hidden="true">⊘</span>Blocked
          </SettingsStatusPill>
        ) : null}
        {deps.map((d) => (
          <span key={d.text} className={`${CHIP} ${d.open ? "border-[var(--severity-warning-border)]" : ""}`}>
            {d.text}
          </span>
        ))}
        {t.status === "pending" && deps.length > 0 && !t.blocked ? <span className={CHIP}>unblocked</span> : null}
      </div>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} className={`${LINKBTN} mt-0.5 font-semibold`}>
        {open ? "Hide details" : "Show details"}
      </button>
      <div id={panel} hidden={!open} className="mt-1 space-y-1.5 border-l-2 border-[var(--border-secondary)] pl-2 text-[12px] text-[var(--text-primary)]">
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Description</div>
          <p tabIndex={0} className={`${TEXT} focus-ring max-h-[30vh] overflow-y-auto`}>{t.description}</p>
        </div>
        {t.result ? (
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Result</div>
            <p tabIndex={0} className={`${TEXT} focus-ring max-h-[30vh] overflow-y-auto`}>{t.result}</p>
          </div>
        ) : null}
        {t.note ? <p className="text-[11px] text-[var(--text-secondary)]">Note: {t.note}</p> : null}
      </div>
    </li>
  );
}

const SECTIONS = [
  { status: "pending", label: "Pending" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
] as const;

export type BoardMode = "stack" | "columns" | "grouped";

/**
 * `stack` = sections one under another (desktop region), `columns` = horizontal scroll-snap columns (mobile option A),
 * `grouped` = collapsible grouped list with counts (mobile option B, Completed folded by default).
 */
export function TaskBoard({ snap, mode, rings, openIds = [] }: { snap: TeamUiSnapshot; mode: BoardMode; rings?: Rings; openIds?: string[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(openIds));
  const [folded, setFolded] = useState<Set<string>>(new Set(mode === "grouped" ? ["completed"] : []));
  if (snap.tasks.length === 0) return <Empty title="No tasks yet" hint="The lead has not added a task. The shared list appears here as soon as one exists." />;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const list = (status: string) => snap.tasks.filter((t) => t.status === status);
  const cards = (status: string) => (
    <ul className="flex flex-col gap-2" aria-label={`${status.replace("_", " ")} tasks`}>
      {list(status).map((t) => (
        <TaskCard key={t.id} snap={snap} t={t} open={open.has(t.id)} onToggle={() => toggle(t.id)} />
      ))}
      {list(status).length === 0 ? <li className="rounded-lg border border-dashed border-[var(--border-secondary)] p-2 text-[12px] text-[var(--text-secondary)]">None</li> : null}
    </ul>
  );
  const head = (label: string, n: number, id: string) => (
    <h3 id={id} className={`${SECTION_H} flex items-center gap-1.5`}>
      {label}
      <span className={CHIP}>{n}</span>
    </h3>
  );
  if (mode === "columns") {
    return (
      <R rings={rings} target="board">
        <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2" data-testid="team-board" tabIndex={0} aria-label="Task board, scrolls sideways">
          {SECTIONS.map((s) => (
            <section key={s.status} aria-labelledby={`col-${s.status}`} className="w-[82%] shrink-0 snap-start rounded-lg bg-[var(--bg-tertiary)] p-2">
              {head(s.label, list(s.status).length, `col-${s.status}`)}
              <div className="mt-2 max-h-[52vh] overflow-y-auto">{cards(s.status)}</div>
            </section>
          ))}
        </div>
      </R>
    );
  }
  if (mode === "grouped") {
    return (
      <R rings={rings} target="board">
        <div className="flex flex-col gap-2" data-testid="team-board">
          {SECTIONS.map((s) => {
            const isFolded = folded.has(s.status);
            return (
              <section key={s.status} aria-labelledby={`grp-${s.status}`} className="rounded-lg border border-[var(--border-secondary)]">
                <h3 id={`grp-${s.status}`} className="m-0">
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    aria-controls={`grp-body-${s.status}`}
                    onClick={() => setFolded((f) => { const n = new Set(f); n.has(s.status) ? n.delete(s.status) : n.add(s.status); return n; })}
                    className="focus-ring flex w-full min-h-[44px] items-center gap-2 rounded-lg px-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <span aria-hidden="true" className="text-[var(--text-secondary)]">{isFolded ? "▸" : "▾"}</span>
                    {s.label}
                    <span className={CHIP}>{list(s.status).length}</span>
                  </button>
                </h3>
                <div id={`grp-body-${s.status}`} hidden={isFolded} className="px-2 pb-2">
                  {cards(s.status)}
                </div>
              </section>
            );
          })}
        </div>
      </R>
    );
  }
  return (
    <R rings={rings} target="board">
      <div className="flex flex-col gap-3" data-testid="team-board">
        {SECTIONS.map((s) => (
          <section key={s.status} aria-labelledby={`stk-${s.status}`} className="flex flex-col gap-2">
            {head(s.label, list(s.status).length, `stk-${s.status}`)}
            {cards(s.status)}
          </section>
        ))}
      </div>
    </R>
  );
}

// ---------------------------------------------------------------- message log

const KIND_LABEL: Record<string, string> = {
  message: "Message",
  broadcast: "Broadcast",
  task_assigned: "Task assigned",
  shutdown_request: "Shutdown request",
  shutdown_response: "Shutdown response",
  spawn_prompt: "Teammate prompt",
  idle: "Idle report",
  notice: "Team notice",
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, " ");
const MAIL_BOUND = 400;

function MailRow({ m, open, onToggle }: { m: SnapshotMail; open: boolean; onToggle: () => void }) {
  const uid = useId();
  const long = m.text.length > MAIL_BOUND;
  const shown = long && !open ? `${m.text.slice(0, MAIL_BOUND)}…` : m.text;
  return (
    <li data-testid="team-mail-row" className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
        <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.from}</span>
        <span aria-hidden="true" className="text-[var(--text-secondary)]">→</span>
        <span className="sr-only">to</span>
        <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.to === "all" ? "everyone" : m.to}</span>
        <span className={CHIP}>{kindLabel(m.kind)}</span>
        {m.priority === "urgent" ? (
          <SettingsStatusPill tone="warning" icon={null} status="urgent">
            <span aria-hidden="true">▲</span>Urgent
          </SettingsStatusPill>
        ) : null}
        {m.ackedAt === undefined ? <span className="text-[11px] text-[var(--text-secondary)]">not yet acknowledged</span> : null}
        <time className="ml-auto text-[11px] text-[var(--text-secondary)]" dateTime={new Date(m.createdAt).toISOString()}>{hhmm(m.createdAt)}</time>
      </div>
      <p id={`${uid}-t`} className={`${TEXT} mt-1 text-[12px] text-[var(--text-primary)]`}>{shown}</p>
      {long ? (
        <button type="button" aria-expanded={open} aria-controls={`${uid}-t`} onClick={onToggle} className={`${LINKBTN} font-semibold`}>
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </li>
  );
}

export function MessageLog({ snap, rings, filter: initialFilter = "all", urgentOnly: initialUrgent = false, newMessages = false }: { snap: TeamUiSnapshot; rings?: Rings; filter?: string; urgentOnly?: boolean; newMessages?: boolean }) {
  const [filter, setFilter] = useState(initialFilter);
  const [urgent, setUrgent] = useState(initialUrgent);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const vanished = filter !== "all" && !snap.members.some((m) => m.name === filter);
  const effective = vanished ? "all" : filter;
  const rows = snap.mail.filter((m) => (effective === "all" || m.from === effective || m.to === effective || m.to === "all") && (!urgent || m.priority === "urgent"));
  const names = ["lead", ...snap.members.map((m) => m.name)];
  const selId = useId();
  return (
    <R rings={rings} target="log">
      <div className="flex min-h-0 flex-col gap-2" data-testid="team-log">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selId} className="text-[12px] font-semibold text-[var(--text-primary)]">Member</label>
          <select id={selId} value={effective} onChange={(e) => setFilter(e.target.value)} className="focus-ring min-h-[44px] sm:min-h-[32px] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] text-[var(--text-primary)]">
            <option value="all">All members</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            type="button"
            aria-pressed={urgent}
            onClick={() => setUrgent((u) => !u)}
            className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 min-h-[44px] sm:min-h-[32px] text-xs font-semibold ${urgent ? "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]" : "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"}`}
          >
            {urgent ? <span aria-hidden="true">✓</span> : null}Urgent only
          </button>
        </div>
        {vanished ? <p className="text-[11px] text-[var(--text-secondary)]">{filter} left the team, so the filter was reset to all members.</p> : null}
        <p className="text-[11px] text-[var(--text-secondary)]" data-testid="team-log-scope">
          {snap.mailTotal > snap.mail.length ? `Showing last ${snap.mail.length} of ${snap.mailTotal} messages` : "Showing all messages"}
        </p>
        {rows.length === 0 ? (
          <Empty title="No messages match" hint={snap.mail.length === 0 ? "Members have not written to each other yet." : "Change the member or turn off Urgent only to see more."} />
        ) : (
          <div role="log" aria-live="off" aria-label="Team messages, oldest first" tabIndex={0} className="focus-ring min-h-0 overflow-y-auto">
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rows.map((m) => (
                <MailRow key={m.id} m={m} open={open.has(m.id)} onToggle={() => setOpen((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} />
              ))}
            </ol>
          </div>
        )}
        {newMessages ? (
          <button type="button" className={`${BTN} self-center`}>
            <span aria-hidden="true">↓</span>New messages
          </button>
        ) : null}
      </div>
    </R>
  );
}

// ---------------------------------------------------------------- states

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{hint}</p>
    </div>
  );
}

function Skeleton() {
  const bar = "rounded-md bg-[var(--bg-tertiary)] animate-pulse motion-reduce:animate-none";
  return (
    <div aria-busy="true" data-testid="team-loading" className="flex flex-1 flex-col gap-3 p-3">
      <span role="status" className="sr-only">Loading team</span>
      <div className={`${bar} h-8 w-1/2`} />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${bar} h-24`} />)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`${bar} h-40`} />
        <div className={`${bar} h-40`} />
      </div>
    </div>
  );
}

export type ViewState = "ready" | "loading" | "none" | "notFound" | "error";

// ---------------------------------------------------------------- shell of the view

export type Tab = "members" | "tasks" | "messages";

export interface TeamViewProps {
  snap: TeamUiSnapshot | null;
  state?: ViewState;
  /** A = three regions on wide screens, B = tabs everywhere. */
  layout: "regions" | "tabs";
  members?: "cards" | "table";
  /** Board arrangement while a tablist is shown (narrow). */
  board?: "columns" | "grouped";
  /** Phone width: one column, tablist whatever the layout. */
  narrow?: boolean;
  viewedFrom?: string;
  initialTab?: Tab;
  rings?: Rings;
  notes?: Partial<Record<string, MemberNote>>;
  stale?: boolean;
  confirm?: boolean;
  announce?: string;
  openTaskIds?: string[];
  logFilter?: string;
  newMessages?: boolean;
  sessionId?: string;
}

function Confirm({ onClose }: { onClose: () => void }) {
  // Drawn inline: `ui:confirm-dialog` portals to document.body and escapes the pane (live-mock-site.md pitfall).
  // Same recipe as ui-contract.md "dialog": scrim, card, 44 px actions, danger = tint-red triple. Behaviour matches
  // the contract: alertdialog, Cancel focused on open, Tab trapped between the two actions, Escape closes only this dialog.
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const first = e.shiftKey ? confirm.current : cancel.current;
    const last = e.shiftKey ? cancel.current : confirm.current;
    if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-overlay)] p-3" data-testid="confirm-dialog" onKeyDown={onKey}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="shut-title" aria-describedby="shut-desc" className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-5 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]">
        <h2 id="shut-title" className="text-lg font-semibold text-[var(--text-primary)]">Shut down the team?</h2>
        <p id="shut-desc" className="text-sm text-[var(--text-primary)]">
          Every teammate is asked to stop and its session ends after a short grace period. A teammate in the middle of a task loses its unfinished work. <strong>The lead session stays open.</strong>
        </p>
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button ref={confirm} type="button" className={BTN_DANGER} onClick={onClose}>Shut down team</button>
        </div>
      </div>
    </div>
  );
}

function Header({ snap, viewedSessionId, viewedFrom, narrow, onShutdown, triggerRef }: { snap: TeamUiSnapshot; viewedSessionId: string; viewedFrom?: string; narrow?: boolean; onShutdown?: () => void; triggerRef?: RefObject<HTMLButtonElement | null> }) {
  const working = snap.members.filter((m) => m.status === "busy").length;
  const live = snap.status === "starting" || snap.status === "active" || snap.status === "orphaned";
  return (
    <header className="shrink-0 border-b border-[var(--border-primary)] px-3 py-2" data-testid="team-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a href={`/session/${viewedSessionId}`} className={BTN}>
          <Icon path={mdiArrowLeft} size={0.6} aria-hidden="true" />
          Back
        </a>
        <h2 className="min-w-0 grow basis-[10ch] text-lg font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{snap.name}</h2>
        <TeamStatusPill status={snap.status} />
        {live && snap.viewerCanControl ? (
          <button ref={triggerRef} type="button" className={BTN_DANGER} onClick={onShutdown} data-testid="team-shutdown">
            Shut down team
          </button>
        ) : null}
        {snap.status === "closing" ? (
          <button type="button" className={BTN} disabled data-testid="team-shutdown">
            Closing…
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
        <span data-testid="team-header-mode">Mode: {snap.mode}</span> · <span data-testid="team-header-parallel">{working} working in parallel</span> · {snap.members.length} members · {snap.tasks.length} tasks
        {narrow ? null : <> · started {hhmm(snap.createdAt)}</>}
      </p>
      {viewedFrom ? <p className="mt-0.5 text-[12px] text-[var(--text-primary)]">Viewing from <strong>{viewedFrom}</strong>’s session.</p> : null}
    </header>
  );
}

function Banners({ snap, stale }: { snap: TeamUiSnapshot; stale?: boolean }) {
  const items: ReactNode[] = [];
  if (stale)
    items.push(
      <SettingsNotice key="stale" tone="error" onRetry={() => {}} retryLabel="Retry" testId="team-stale">
        <span className="font-semibold">Couldn’t refresh the team.</span> Showing the last update from {hhmm(snap.createdAt + 90 * 60_000)}.
      </SettingsNotice>,
    );
  if (snap.persist_degraded)
    items.push(
      <SettingsNotice key="persist" tone="warning" testId="team-persist-degraded">
        <span className="font-semibold">Changes may not survive a restart.</span> The server could not save the team file.
      </SettingsNotice>,
    );
  if (snap.status === "orphaned")
    items.push(
      <SettingsNotice key="orphan" tone="info" role="status" testId="team-orphaned">
        <span className="font-semibold">The lead session ended.</span> Teammates keep working until the orphan time limit passes.
      </SettingsNotice>,
    );
  if (snap.status === "starting")
    items.push(
      <SettingsNotice key="start" tone="info" role="status" testId="team-starting">
        <span className="font-semibold">The lead is starting.</span> Members appear as soon as it starts one.
      </SettingsNotice>,
    );
  if (snap.status === "closing")
    items.push(
      <SettingsNotice key="closing" tone="warning" role="status" testId="team-closing">
        <span className="font-semibold">Shutting the team down.</span> Controls are off until every teammate has stopped.
      </SettingsNotice>,
    );
  if (snap.status === "closed")
    items.push(
      <SettingsNotice key="closed" tone="info" role="status" testId="team-closed">
        <span className="font-semibold">This team is closed.</span> It is shown read-only.
      </SettingsNotice>,
    );
  return items.length ? <div className="flex shrink-0 flex-col gap-2 px-3 pt-2">{items}</div> : null;
}

function TabList({ tab, setTab, snap, rings }: { tab: Tab; setTab: (t: Tab) => void; snap: TeamUiSnapshot; rings?: Rings }) {
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ members: null, tasks: null, messages: null });
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "members", label: "Members", n: snap.members.length },
    { id: "tasks", label: "Tasks", n: snap.tasks.length },
    { id: "messages", label: "Messages", n: snap.mailTotal },
  ];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = tabs[to] as (typeof tabs)[number];
    setTab(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <R rings={rings} target="tabs">
      <div role="tablist" aria-label="Team sections" className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border-secondary)] px-3">
        {tabs.map((t, i) => {
          const sel = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => { refs.current[t.id] = el; }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={sel}
              aria-controls={`panel-${t.id}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`focus-ring -mb-px inline-flex min-h-[36px] max-sm:min-h-[44px] items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${sel ? "border-[var(--accent-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
            >
              {t.label}
              <span className={CHIP}>{t.n}</span>
            </button>
          );
        })}
      </div>
    </R>
  );
}

function Body(p: TeamViewProps & { snap: TeamUiSnapshot }) {
  const { snap, layout, narrow, rings } = p;
  const [tab, setTab] = useState<Tab>(p.initialTab ?? "members");
  const membersEl = p.members === "table"
    ? <MembersTable snap={snap} notes={p.notes} rings={rings} />
    : <MembersCards snap={snap} notes={p.notes} cols={narrow ? 1 : 2} rings={rings} />;
  const boardEl = <TaskBoard snap={snap} mode={narrow ? (p.board ?? "grouped") : "stack"} rings={rings} openIds={p.openTaskIds} />;
  const logEl = <MessageLog snap={snap} rings={rings} filter={p.logFilter} newMessages={p.newMessages} />;
  if (layout === "regions" && !narrow) {
    const heading = (label: string, n: number) => (
      <h3 className={`${SECTION_H} flex items-center gap-1.5 pb-1`}>
        {label}
        <span className={CHIP}>{n}</span>
      </h3>
    );
    return (
      <R rings={rings} target="body">
        <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="team-regions">
          <section aria-label="Members" className="flex max-h-[44%] shrink-0 flex-col">
            <R rings={rings} target="heads">{heading("Members", snap.members.length)}</R>
            <div className="min-h-0 overflow-y-auto">{membersEl}</div>
          </section>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <section aria-label="Tasks" className="flex min-h-0 flex-col">
              {heading("Tasks", snap.tasks.length)}
              <div className="min-h-0 overflow-y-auto">{boardEl}</div>
            </section>
            <section aria-label="Messages" className="flex min-h-0 flex-col overflow-hidden">
              {heading("Messages", snap.mailTotal)}
              {logEl}
            </section>
          </div>
        </div>
      </R>
    );
  }
  const panels: Record<Tab, ReactNode> = { members: membersEl, tasks: boardEl, messages: logEl };
  return (
    <R rings={rings} target="body">
      <div className="flex h-full min-h-0 flex-col" data-testid="team-tabs">
        <TabList tab={tab} setTab={setTab} snap={snap} rings={rings} />
        {(["members", "tasks", "messages"] as const).map((id) => (
          <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tab !== id} tabIndex={0} className="focus-ring min-h-0 flex-1 overflow-y-auto p-3">
            {panels[id]}
          </div>
        ))}
      </div>
    </R>
  );
}

export function TeamView(p: TeamViewProps) {
  const [confirm, setConfirm] = useState(!!p.confirm);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeConfirm = () => { setConfirm(false); queueMicrotask(() => trigger.current?.focus()); };
  const state = p.state ?? "ready";
  const base = "relative h-full min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]";
  const frame = `${base} flex flex-col`;
  const back = (
    <div className="shrink-0 border-b border-[var(--border-primary)] px-3 py-2">
      <a href={`/session/${p.sessionId ?? "9f3c2a71"}`} className={BTN}>
        <Icon path={mdiArrowLeft} size={0.6} aria-hidden="true" />
        Back to the session
      </a>
    </div>
  );
  if (state === "loading")
    return (
      <div className={frame}>
        {back}
        <Skeleton />
      </div>
    );
  if (state === "none")
    return (
      <div className={frame}>
        {back}
        <div className="p-3">
          <Empty title="This session is not part of a team" hint="Teams appear here when a lead session creates one and starts teammates. Nothing to show for this session yet." />
        </div>
      </div>
    );
  if (state === "notFound")
    return (
      <div className={frame}>
        {back}
        <div className="p-3">
          <Empty title="This team is no longer available" hint="It was removed, or you may not have access to it. Go back to the session to carry on." />
        </div>
      </div>
    );
  if (state === "error" && !p.snap)
    return (
      <div className={frame}>
        {back}
        <div className="p-3">
          <SettingsNotice tone="error" onRetry={() => {}} retryLabel="Retry" testId="team-error">
            <span className="font-semibold">Couldn’t load the team.</span> The server did not answer. Try again in a moment.
          </SettingsNotice>
        </div>
      </div>
    );
  const snap = p.snap as TeamUiSnapshot;
  return (
    <div className={`${base} grid grid-rows-[auto_auto_minmax(0,1fr)]`} data-testid="team-view">
      <Header snap={snap} viewedSessionId={p.sessionId ?? "9f3c2a71"} viewedFrom={p.viewedFrom} narrow={p.narrow} onShutdown={() => setConfirm(true)} triggerRef={trigger} />
      <div className="min-h-0"><Banners snap={snap} stale={p.stale || state === "error"} /></div>
      <Body {...p} snap={snap} />
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="team-live-region">{p.announce ?? ""}</div>
      {confirm ? <Confirm onClose={closeConfirm} /> : null}
    </div>
  );
}

