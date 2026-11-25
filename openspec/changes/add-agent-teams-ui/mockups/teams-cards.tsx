// MOCK-ONLY chat-side surfaces of the Team UI: the eager session badge (two densities), the lazy mail entry
// cards (`custom-entry-renderer`), and the lazy tool renderers (`tool-renderer`, four families). They are
// mounted through the REAL host paths (`SessionCardBadgeSlot`, `CustomEntryRow`, `ToolCallStep`) by
// `teams-host.tsx`; nothing here is production code. Mail cards parse with core's own `parseEnvelope`.
// Agent-authored text is plain text children, never markdown, HTML or links (design D5, D11).
// See change: add-agent-teams-ui (design D4, D5, D6, D9, D11).
import { SettingsNotice, SettingsStatusPill } from "@rt/index.ts";
import { useMobile } from "@app/hooks/useMobile.tsx";
import { formatMessageTime } from "@app/lib/util/format.ts";
import { mdiRobotOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { RESERVED_MEMBER_NAMES } from "@teams/shared/constants.ts";
import { parseEnvelope } from "@teams/shared/mail-format.ts";
import type { MemberStatus } from "@teams/shared/types.ts";
import { type ReactNode, useId } from "react";
import { MemberStatusPill, TASK_STATUS } from "./teams-status";

// ================================================================ badge (eager)

export type BadgeDensity = "compact" | "full";

interface RefBag { teamId?: unknown; member?: unknown; role?: unknown }
const refOf = (s: unknown, key: string): RefBag | undefined => {
  const v = (s as Record<string, unknown>)[key];
  return v && typeof v === "object" ? (v as RefBag) : undefined;
};
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Design D6: pure predicate over the top-level projection; both refs present => lead wins; `teamId: null` clears. */
export function teamRole(session: unknown): { kind: "lead" } | { kind: "member"; name: string } | null {
  if (nonEmpty(refOf(session, "agent-teams-lead")?.teamId)) return { kind: "lead" };
  const mate = refOf(session, "agent-teams");
  if (nonEmpty(mate?.teamId)) return { kind: "member", name: nonEmpty(mate?.member) ? mate.member : "teammate" };
  return null;
}
export const isTeamSession = (s: unknown): boolean => teamRole(s) !== null;

const BADGE_TONE =
  "border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)]";

export function makeTeamBadge(density: BadgeDensity) {
  return function TeamBadge({ session }: { session: { id: string } }) {
    const role = teamRole(session);
    if (!role) return null;
    const label = role.kind === "lead" ? "Lead" : role.name;
    const name = role.kind === "lead" ? "Open team view, lead" : `Open team view, teammate ${role.name}`;
    const href = `/session/${session.id}/team`;
    if (density === "compact")
      return (
        <a href={href} aria-label={name} data-testid="team-badge" className={`focus-ring inline-flex min-h-[24px] max-w-full items-center truncate rounded-full border px-2 text-[11px] font-semibold ${BADGE_TONE}`}>
          {label}
        </a>
      );
    return (
      <a href={href} aria-label={name} data-testid="team-badge" className={`focus-ring inline-flex min-h-[24px] max-w-full items-stretch overflow-hidden rounded-full border text-[11px] font-semibold ${BADGE_TONE}`}>
        <span className="inline-flex items-center gap-1 border-r border-[var(--severity-neutral-border)] px-1.5">
          <span aria-hidden="true">{role.kind === "lead" ? "◆" : "◇"}</span>Team
        </span>
        <span className="inline-flex min-w-0 items-center truncate px-1.5">{label}</span>
      </a>
    );
  };
}

// ================================================================ mail cards (lazy)

const KIND: Record<string, string> = {
  message: "Message",
  broadcast: "Broadcast",
  task_assigned: "Task assigned",
  shutdown_request: "Shutdown request",
  shutdown_response: "Shutdown response",
  spawn_prompt: "Teammate prompt",
};

type Sender = { label: string } | null;
function senderOf(name: string): Sender {
  if (name === "lead") return { label: "Lead" };
  if (name === "server") return { label: "Server" };
  if ((RESERVED_MEMBER_NAMES as readonly string[]).includes(name)) return null; // system | all | user: never trusted
  return { label: `Teammate ${name}` };
}

const TRUNCATED_RE = /^«\d+ earlier lines? hidden»/;

interface Item { head: string; cont: string[] }
/** Design D4: `• ` begins an item, `│ ` continues it, any other non-blank line is one legacy item. */
export function noticeItems(body: string): Item[] {
  const items: Item[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("• ")) items.push({ head: line.slice(2), cont: [] });
    else if (line.startsWith("│ ") && items.length) (items[items.length - 1] as Item).cont.push(line.slice(2));
    else if (line.trim() !== "") items.push({ head: line, cont: [] });
  }
  return items;
}

const LINK = "focus-ring inline-flex min-h-[44px] sm:min-h-[24px] items-center rounded text-[12px] font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline";
const PLAIN = "whitespace-pre-wrap [overflow-wrap:anywhere]";

function Shell({ id, title, kind, sender, urgent, time, expanded, onToggle, collapsed, full, canExpand, footer, label }: {
  id: string; title: string; kind?: string; sender?: string; urgent?: boolean; time: number; expanded: boolean; onToggle: () => void;
  collapsed: ReactNode; full: ReactNode; canExpand: boolean; footer?: ReactNode; label: string;
}) {
  const mobile = useMobile();
  const bodyId = `${id}-body`;
  return (
    <div
      role="group"
      aria-label={label}
      data-testid="team-mail-card"
      className={`my-1 ${mobile ? "mx-2" : "mx-4"} overflow-hidden rounded-lg border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] bg-[var(--bg-secondary)] text-xs`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-1.5">
        <Icon path={mdiRobotOutline} size={0.6} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
        <span className="font-semibold text-[var(--text-primary)]">{title}</span>
        {kind ? <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]">{kind}</span> : null}
        {sender ? <span className="text-[12px] text-[var(--text-secondary)]">from <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{sender}</span></span> : null}
        {urgent ? (
          <SettingsStatusPill tone="warning" icon={null} status="urgent"><span aria-hidden="true">▲</span>Urgent</SettingsStatusPill>
        ) : null}
        <span className="ml-auto text-[12px] text-[var(--text-secondary)]">{formatMessageTime(time)}</span>
      </div>
      <div className="px-3 pb-1.5 pt-1">
        {expanded ? (
          <div id={bodyId} tabIndex={0} className={`${PLAIN} focus-ring max-h-[60vh] overflow-y-auto rounded bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]`}>{full}</div>
        ) : (
          <div id={bodyId} className={`${PLAIN} line-clamp-2 text-[12px] text-[var(--text-primary)]`}>{collapsed}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-3">
          {/* D14: the toggle is always rendered (a stable control, not one that appears with the text length). */}
          <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle} className={LINK} data-can-expand={canExpand}>
            {expanded ? "Show less" : "Show more"}
          </button>
          {footer}
        </div>
      </div>
    </div>
  );
}

export interface MailCardProps {
  customType: string;
  body: string;
  timestamp: number;
  expanded: boolean;
  onToggle: () => void;
  sessionId?: string;
}

/** One component for the three mail customTypes; derives everything from `customType` and `body`, issues no request. */
export function MailEntryCard({ customType, body, timestamp, expanded, onToggle, sessionId }: MailCardProps) {
  const id = useId();
  const common = { id, time: timestamp, expanded, onToggle };

  if (TRUNCATED_RE.test(body)) {
    return (
      <Shell {...common} title="Agent message — header truncated" label="Agent message, header truncated" collapsed={body} full={body} canExpand={body.split("\n").length > 2}
        footer={<span className="text-[12px] text-[var(--text-secondary)]">The sender is not shown because the header line was cut off.</span>} />
    );
  }
  const env = parseEnvelope(body);
  const sender = env ? senderOf(env.sender) : null;
  if (!env || !sender) {
    return (
      <Shell {...common} title="Unrecognised agent message" label="Unrecognised agent message" collapsed={body} full={body} canExpand={body.split("\n").length > 2 || body.length > 140}
        footer={<span className="text-[12px] text-[var(--text-secondary)]">No sender is claimed; the text is shown as-is.</span>} />
    );
  }
  const text = env.body;
  const teamLink = sessionId ? (
    <a href={`/session/${sessionId}/team`} className={LINK}>Open team view</a>
  ) : null;

  if (customType === "agent-teams-notice") {
    const items = noticeItems(text);
    const first = items[0];
    return (
      <Shell {...common} title="Team notice" sender={sender.label} label={`Agent message from ${sender.label}: team notice`} canExpand={items.length > 1 || (first?.cont.length ?? 0) > 0}
        collapsed={items.length === 0 ? "Team notice (empty)" : (<>{first?.head}{items.length > 1 ? <span className="ml-1 font-semibold text-[var(--text-secondary)]"> +{items.length - 1} more</span> : null}</>)}
        full={items.length === 0 ? "Team notice (empty)" : (
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {items.map((it, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: notice items have no id; order is the identity
              <li key={i} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <div className="min-w-0">
                  <div>{it.head}</div>
                  {it.cont.length ? <div className="ml-1 mt-0.5 border-l-2 border-[var(--border-secondary)] pl-2 text-[var(--text-secondary)]">{it.cont.join("\n")}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        footer={teamLink} />
    );
  }
  if (customType === "agent-teams-idle") {
    return (
      <Shell {...common} title={`${sender.label} reported idle`} label={`Agent message from ${sender.label}: idle report`} collapsed={text} full={text} canExpand={text.split("\n").length > 2 || text.length > 140} />
    );
  }
  const known = KIND[env.kind];
  return (
    <Shell {...common} title="Agent message" kind={known ?? env.kind.replace(/_/g, " ")} sender={sender.label} urgent={env.urgent}
      label={`Agent message from ${sender.label}`} collapsed={text} full={text} canExpand={text.split("\n").length > 2 || text.length > 140} />
  );
}

// ================================================================ tool renderers (lazy)

interface ToolProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  status: "running" | "complete" | "error" | "elided";
  result?: string;
  toolDetails?: Record<string, unknown>;
}

const FAMILY: Record<string, "lifecycle" | "message" | "task" | "shutdown"> = {
  TeamCreate: "lifecycle", TeammateSpawn: "lifecycle", TeamStatus: "lifecycle", TeamDelete: "lifecycle",
  SendMessage: "message",
  TaskCreate: "task", TaskList: "task", TaskGet: "task", TaskUpdate: "task",
  ShutdownRequest: "shutdown", ShutdownResponse: "shutdown",
};
export const TEAM_TOOL_NAMES = Object.keys(FAMILY);

const ERROR_COPY: Record<string, string> = {
  team_full: "The team already has the maximum number of live teammates.",
  name_taken: "A teammate with that name is already on the team.",
  not_lead: "Only the lead can do this.",
  members_active: "Teammates are still working. Ask them to stop or force the shutdown.",
  unknown_task: "There is no task with that id.",
  blocked: "The task waits for another task that is not finished.",
  already_claimed: "Another member already claimed this task.",
  team_closed: "The team is closed.",
  unknown_recipient: "There is no member with that name.",
};

const hasDetails = (name: string, d?: Record<string, unknown>): d is Record<string, unknown> & { ok: boolean } =>
  !!d && d.op === name && typeof d.ok === "boolean";

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-[var(--text-secondary)]">{k}</dt>
      <dd className="m-0 min-w-0 text-[var(--text-primary)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function InputSummary({ input }: { input: Record<string, unknown> }) {
  const keys = Object.keys(input).slice(0, 6);
  if (keys.length === 0) return <p className="text-[var(--text-secondary)]">No input.</p>;
  return (
    <dl className="m-0 flex flex-col gap-0.5">
      {keys.map((k) => (
        <Fact key={k} k={k}>{typeof input[k] === "string" ? String(input[k]).slice(0, 160) : JSON.stringify(input[k])}</Fact>
      ))}
    </dl>
  );
}

function Fallback({ input, result, note }: { input: Record<string, unknown>; result?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="team-tool-fallback">
      {note ? <p className="m-0 text-[var(--text-secondary)]">{note}</p> : null}
      <InputSummary input={input} />
      {result ? <pre tabIndex={0} className={`${PLAIN} m-0 max-h-[240px] overflow-auto rounded bg-[var(--bg-code)] focus-ring p-2 font-mono text-[11px] text-[var(--text-secondary)]`}>{result}</pre> : null}
    </div>
  );
}

function ErrorBody({ code }: { code: string }) {
  const sentence = ERROR_COPY[code];
  return (
    <SettingsNotice tone="error" details={code} testId="team-tool-error">
      <span className="font-semibold">{sentence ? "That didn’t work." : `Unexpected error (${code})`}</span>
      {sentence ? <> {sentence} <span className="font-mono text-[11px]">{code}</span></> : null}
    </SettingsNotice>
  );
}

const TeamLink = ({ sessionId }: { sessionId: string }) => (
  <a href={`/session/${sessionId}/team`} className={LINK}>Open team view</a>
);

function Success({ name, d, input, sessionId }: { name: string; d: Record<string, unknown>; input: Record<string, unknown>; sessionId: string }) {
  const o = <T,>(k: string) => d[k] as T;
  switch (name) {
    case "TeammateSpawn": {
      const m = o<{ name: string; role?: string; status: MemberStatus; model?: string }>("member");
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">{m.name}</span>
            {m.role ? <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px]">{m.role}</span> : null}
            <MemberStatusPill status={m.status} />
          </div>
          <div className="font-mono text-[11px] text-[var(--text-primary)]">{m.model ?? "inherits the lead's model"}</div>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    }
    case "TeamCreate": {
      const t = o<{ name: string; maxTeammates: number; mode: string }>("team");
      return (
        <div className="flex flex-col gap-1">
          <dl className="m-0 flex flex-col gap-0.5"><Fact k="Team">{t.name}</Fact><Fact k="Mode">{t.mode}</Fact><Fact k="Up to">{t.maxTeammates} teammates</Fact></dl>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    }
    case "TeamStatus": {
      const c = o<{ members: Partial<Record<MemberStatus, number>>; tasks: Record<string, number> }>("counts");
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(c.members) as [MemberStatus, number][]).map(([s, n]) => (
              <span key={s} className="inline-flex items-center gap-1"><MemberStatusPill status={s} /><span className="text-[var(--text-secondary)]">×{n}</span></span>
            ))}
          </div>
          <p className="m-0 text-[var(--text-primary)]">Tasks: {Object.entries(c.tasks).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ")}</p>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    }
    case "TeamDelete":
      return <p className="m-0 text-[var(--text-primary)]">Team closed{o<boolean>("force") ? " (forced; teammates were shut down)" : ""}. <TeamLink sessionId={sessionId} /></p>;
    case "SendMessage": {
      const to = String(d.to ?? input.to ?? "");
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[var(--text-secondary)]">to</span>
            <span className="font-semibold text-[var(--text-primary)]">{to === "all" ? "everyone" : to}</span>
            {input.priority === "urgent" ? <SettingsStatusPill tone="warning" icon={null} status="urgent"><span aria-hidden="true">▲</span>Urgent</SettingsStatusPill> : null}
            <SettingsStatusPill tone={d.delivery === "queued" ? "warning" : "success"} icon={null} status={String(d.delivery)}>
              <span aria-hidden="true">{d.delivery === "queued" ? "◐" : "✓"}</span>{d.delivery === "queued" ? "Queued" : "Delivered"}
            </SettingsStatusPill>
          </div>
          <p tabIndex={0} className={`${PLAIN} focus-ring m-0 max-h-[30vh] overflow-y-auto rounded bg-[var(--bg-tertiary)] p-2 text-[var(--text-primary)]`}>{String(input.message ?? "")}</p>
        </div>
      );
    }
    case "TaskCreate": {
      const t = o<{ id: string; title: string; blockedBy: string[]; owner?: string }>("task");
      return (
        <div className="flex flex-col gap-1">
          <div className={`${PLAIN} text-[var(--text-primary)]`}><span className="font-mono font-semibold">#{t.id}</span> {t.title}</div>
          <div className="text-[var(--text-secondary)]">{t.owner ? `Assigned to ${t.owner}` : "unassigned"}{t.blockedBy.length ? ` · waits for ${t.blockedBy.map((b) => `#${b}`).join(", ")}` : ""}</div>
        </div>
      );
    }
    case "TaskList": {
      const ts = o<{ id: string; title: string; status: keyof typeof TASK_STATUS; owner?: string; claimable: boolean }[]>("tasks");
      return (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {ts.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-x-1.5">
              <span aria-hidden="true">{TASK_STATUS[t.status].glyph}</span>
              <span className="font-mono font-semibold text-[var(--text-primary)]">#{t.id}</span>
              <span className={`${PLAIN} min-w-0 text-[var(--text-primary)]`}>{t.title}</span>
              <span className="text-[var(--text-secondary)]">{TASK_STATUS[t.status].text}{t.owner ? ` · ${t.owner}` : ""}{t.claimable ? " · claimable" : ""}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "TaskGet": {
      const t = o<{ id: string; title: string; status: keyof typeof TASK_STATUS; description: string; owner?: string; blockedBy: string[] }>("task");
      return (
        <div className="flex flex-col gap-1">
          <div className={`${PLAIN} text-[var(--text-primary)]`}><span className="font-mono font-semibold">#{t.id}</span> {t.title}</div>
          <div className="text-[var(--text-secondary)]">{TASK_STATUS[t.status].text}{t.owner ? ` · ${t.owner}` : ""}{t.blockedBy.length ? ` · waits for ${t.blockedBy.map((b) => `#${b}`).join(", ")}` : ""}</div>
          <p tabIndex={0} className={`${PLAIN} focus-ring m-0 max-h-[30vh] overflow-y-auto text-[var(--text-primary)]`}>{t.description}</p>
        </div>
      );
    }
    case "TaskUpdate": {
      const t = o<{ id: string; title: string; from: keyof typeof TASK_STATUS; to: keyof typeof TASK_STATUS; owner?: string }>("task");
      return (
        <div className="flex flex-col gap-1">
          <div className={`${PLAIN} text-[var(--text-primary)]`}><span className="font-mono font-semibold">#{t.id}</span> {t.title}</div>
          <div className="text-[var(--text-primary)]">{TASK_STATUS[t.from].text} <span aria-hidden="true">→</span><span className="sr-only">changed to</span> {TASK_STATUS[t.to].text}{t.owner ? <span className="text-[var(--text-secondary)]"> · {t.owner}</span> : null}</div>
        </div>
      );
    }
    case "ShutdownRequest":
      return (
        <div className="flex flex-col gap-1">
          <div className="text-[var(--text-primary)]">Asked <span className="font-semibold">{String(input.to)}</span> to shut down.</div>
          {input.reason ? <p className={`${PLAIN} m-0 text-[var(--text-secondary)]`}>Reason: {String(input.reason)}</p> : null}
          <p className="m-0 text-[var(--text-secondary)]">The teammate may approve or reject; a rejection wakes the lead.</p>
        </div>
      );
    case "ShutdownResponse": {
      const approve = o<boolean>("approve");
      return (
        <div className="flex flex-col gap-1">
          <SettingsStatusPill tone={approve ? "success" : "warning"} icon={null} status={approve ? "approve" : "reject"}>
            <span aria-hidden="true">{approve ? "✓" : "✕"}</span>{approve ? "Approved shutdown" : "Rejected shutdown"}
          </SettingsStatusPill>
          {input.reason ? <p className={`${PLAIN} m-0 text-[var(--text-primary)]`}>{String(input.reason)}</p> : null}
        </div>
      );
    }
    default:
      return <Fallback input={input} />;
  }
}

/** One lazy module; a data-driven tool-name -> family table. Never blank: foreign or missing details fall back. */
export function TeamToolRenderer({ toolName, toolInput, sessionId, status, result, toolDetails }: ToolProps) {
  if (!(toolName in FAMILY)) return <Fallback input={toolInput} result={result} />;
  if (status === "running")
    return (
      <div className="flex flex-col gap-1.5" data-testid="team-tool-running">
        <div><SettingsStatusPill tone="info" icon={null} status="running"><span aria-hidden="true" className="animate-pulse motion-reduce:animate-none">●</span>Waiting for the result</SettingsStatusPill></div>
        <InputSummary input={toolInput} />
      </div>
    );
  if (status === "elided") return <Fallback input={toolInput} result={result} note="Result not loaded. It is outside the loaded history, so only the call is shown." />;
  if (status === "error") {
    const code = typeof toolDetails?.error === "string" ? toolDetails.error : (result?.split(":")[0] ?? "unknown");
    return <ErrorBody code={code} />;
  }
  if (!hasDetails(toolName, toolDetails) || !toolDetails.ok) return <Fallback input={toolInput} result={result} />;
  return <Success name={toolName} d={toolDetails} input={toolInput} sessionId={sessionId} />;
}
