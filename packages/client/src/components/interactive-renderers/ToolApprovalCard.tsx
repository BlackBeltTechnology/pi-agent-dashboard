/**
 * ToolApprovalCard — the Supervised-mode approval prompt: "approve this agent action?".
 *
 * Rendered by `SelectRenderer` when `params.kind === "supervised-tool-approval"` (no new
 * registry method). The bridge sends a PromptBus `select` (`Allow once` / `Deny`,
 * `allowOther`); this card shows WHAT will run (command, or path + `+N −M` + collapsed diff),
 * a countdown to the gate's single clock (`params.deadline`), and answers with exactly
 * `{ value: "Allow once" }`, `{ value: "Deny" }` or `{ value: "<reason>" }`.
 *
 * Contracts:
 * - No preselection, no autofocus, no global key handler: a stray Enter sends nothing.
 * - No Cancel (it would mean Deny). The reason field refuses a text equal to an option label —
 *   the gate would otherwise read it as an approval.
 * - The countdown never disables the buttons: the server clock decides (a cancel arrives as
 *   `dismissed`, which renders a resolved row with no control). Client skew must not strand a
 *   valid approval.
 * - Operator-/agent-controlled text (command, diff, reason) is only ever a React text node.
 *
 * See change: add-supervised-tool-approval (design D3, D10, D11; mockup b-*).
 */
import { mdiAccountEyeOutline, mdiAlertOutline, mdiCheck, mdiChevronRight, mdiClockOutline, mdiClose, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { InteractiveRendererProps } from "./types.js";

export const SUPERVISED_APPROVAL_KIND = "supervised-tool-approval";
const ALLOW_ONCE = "Allow once";
const DENY = "Deny";
/** Seconds left at which the countdown turns warning-coloured and is announced once. */
const WARN_SECONDS = 30;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** True when a reason would be read as an option label (case-insensitive, trimmed). */
export function reasonCollidesWithOption(reason: string): boolean {
  const r = reason.trim().toLowerCase();
  return r === ALLOW_ONCE.toLowerCase() || r === DENY.toLowerCase();
}

function defaultTitle(tool: string): string {
  switch (tool.toLowerCase()) {
    case "bash":
    case "powershell":
      return i18nT("supervised.card.runCommand", undefined, "Run this command?");
    case "write":
      return i18nT("supervised.card.createFile", undefined, "Create this file?");
    case "edit":
      return i18nT("supervised.card.editFile", undefined, "Edit this file?");
    case "agent":
      return i18nT("supervised.card.startAgent", undefined, "Start a subagent?");
    default:
      return i18nT("supervised.card.generic", undefined, "Allow this tool call?");
  }
}

/** Seconds until `deadline` (epoch ms), re-read each second; `null` without a deadline. */
function useRemainingSeconds(deadline: number | undefined): number | null {
  const compute = useCallback(
    () => (deadline === undefined ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
    [deadline],
  );
  const [remaining, setRemaining] = useState<number | null>(compute);
  useEffect(() => {
    if (deadline === undefined) return;
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
  }, [deadline, compute]);
  return remaining;
}

function DiffStat({ stat }: { stat: string }) {
  const m = /^\+(\d+)\s+[−-](\d+)$/.exec(stat.trim());
  if (!m) return <span className="text-[var(--text-secondary)]">{stat}</span>;
  return (
    <span className="font-mono">
      <span className="text-[var(--tint-green-fg)]">+{m[1]}</span> <span className="text-[var(--tint-red-fg)]">−{m[2]}</span>
    </span>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <div
      role="region"
      aria-label={i18nT("supervised.card.proposedChange", undefined, "Proposed change")}
      data-testid="tool-approval-diff"
      className="mt-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-code)] font-mono text-[12px] leading-5 overflow-x-auto max-h-[320px] overflow-y-auto"
    >
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+")
          ? "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]"
          : line.startsWith("-")
            ? "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]"
            : "text-[var(--text-secondary)]";
        return (
          <div key={i} className={`px-2 whitespace-pre-wrap break-all ${cls}`}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

type Outcome = "approved" | "denied" | "timeout" | "dismissed";

function resolvedOutcome(status: InteractiveRendererProps["status"], value: string | undefined, deadline: number | undefined): Outcome {
  if (status === "resolved") return value === ALLOW_ONCE ? "approved" : "denied";
  // cancelled / dismissed: the gate (or another surface) closed it. Past the deadline = it timed out.
  return deadline !== undefined && Date.now() >= deadline - 1500 ? "timeout" : "dismissed";
}

const OUTCOME_VIEW: Record<Outcome, { tone: string; icon: string; label: () => string; surface: () => string | undefined }> = {
  approved: {
    tone: "text-[var(--severity-success-fg)]",
    icon: mdiCheck,
    label: () => i18nT("supervised.card.allowedOnce", undefined, "Allowed once"),
    surface: () => i18nT("supervised.card.surfaceDashboard", undefined, "Dashboard"),
  },
  denied: {
    tone: "text-[var(--severity-error-fg)]",
    icon: mdiClose,
    label: () => i18nT("supervised.card.denied", undefined, "Denied"),
    surface: () => i18nT("supervised.card.surfaceDashboard", undefined, "Dashboard"),
  },
  timeout: {
    tone: "text-[var(--severity-warning-fg)]",
    icon: mdiClockOutline,
    label: () => i18nT("supervised.card.timedOut", undefined, "No answer in time, denied"),
    surface: () => undefined,
  },
  dismissed: {
    tone: "text-[var(--severity-warning-fg)]",
    icon: mdiClose,
    label: () => i18nT("supervised.card.dismissed", undefined, "Closed without an answer"),
    surface: () => i18nT("supervised.card.surfaceElsewhere", undefined, "Terminal or another surface"),
  },
};

function ResolvedRow({ outcome, tool, detail, reason }: { outcome: Outcome; tool: string; detail?: string; reason?: string }) {
  const view = OUTCOME_VIEW[outcome];
  const surface = view.surface();
  return (
    <div
      data-testid="tool-approval-resolved"
      data-outcome={outcome}
      className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <Icon path={mdiAccountEyeOutline} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
      <span className={`inline-flex items-center gap-1 font-medium ${view.tone}`}>
        <Icon path={view.icon} size={0.5} />
        {view.label()}
      </span>
      {tool && <span className="font-mono text-[var(--text-secondary)]">{tool}</span>}
      {detail && <code className="font-mono text-[var(--text-secondary)] truncate max-w-full">{detail}</code>}
      {surface && <span className="ml-auto text-[var(--text-tertiary)]" data-testid="tool-approval-surface">{surface}</span>}
      {reason && (
        <span className="basis-full text-[var(--text-secondary)]">
          {i18nT("supervised.card.reasonSent", undefined, "Reason sent:")} <q>{reason}</q>
        </span>
      )}
    </div>
  );
}

/** What the bridge put in the prompt metadata, normalised once. */
interface Facts {
  tool: string;
  title: string;
  command?: string;
  path?: string;
  diffStat?: string;
  diff?: string;
  cwd?: string;
  summary?: string;
  deadline?: number;
}

function readFacts(params: Record<string, unknown>): Facts {
  const tool = str(params.tool) ?? "";
  const deadline = typeof params.deadline === "number" && Number.isFinite(params.deadline) ? params.deadline : undefined;
  return {
    tool,
    title: str(params.title) ?? defaultTitle(tool),
    command: str(params.command),
    path: str(params.path),
    diffStat: str(params.diffStat),
    diff: str(params.diff),
    cwd: str(params.cwd),
    summary: str(params.summary),
    deadline,
  };
}

function ApprovalHeader({ facts, remaining }: { facts: Facts; remaining: number | null }) {
  const low = remaining !== null && remaining <= WARN_SECONDS;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <span className="inline-flex shrink-0 text-[var(--severity-warning-fg)]">
        <Icon path={mdiAlertOutline} size={0.65} />
      </span>
      <span className="text-sm font-medium text-[var(--text-primary)]" data-testid="tool-approval-title">{facts.title}</span>
      {facts.tool && (
        <span
          data-testid="tool-approval-tool"
          className="px-1.5 py-0.5 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] font-mono text-[11px] text-[var(--text-secondary)]"
        >
          {facts.tool}
        </span>
      )}
      {remaining !== null && (
        <span
          data-testid="tool-approval-clock"
          title={i18nT("supervised.card.clockTitle", undefined, "Denied automatically if nobody answers")}
          className={`ml-auto inline-flex items-center gap-1 text-xs ${low ? "text-[var(--severity-warning-fg)]" : "text-[var(--text-secondary)]"}`}
        >
          <Icon path={mdiClockOutline} size={0.5} />
          {remaining <= 0
            ? i18nT("supervised.card.expired", undefined, "Time is up, denying…")
            : i18nT("supervised.card.clock", { time: formatClock(remaining) }, "Denies in {time}")}
        </span>
      )}
    </div>
  );
}

/** Collapsed-by-default change view: toggle + diff block. */
function DiffToggle({ diff }: { diff: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        data-testid="tool-approval-diff-toggle"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring inline-flex items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Icon path={mdiChevronRight} size={0.55} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? i18nT("supervised.card.hideChanges", undefined, "Hide changes") : i18nT("supervised.card.showChanges", undefined, "Show changes")}
      </button>
      {open && <DiffBlock diff={diff} />}
    </div>
  );
}

/** What will run: command / task text, or path + stat + collapsed diff; cwd; the Agent caveat. */
function ApprovalBody({ facts }: { facts: Facts }) {
  const { command, path, diffStat, diff, cwd, summary } = facts;
  return (
    <>
      {command !== undefined && (
        <pre
          data-testid="tool-approval-command"
          className="m-0 p-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-code)] font-mono text-[12px] text-[var(--text-primary)] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto"
        >
          {command}
        </pre>
      )}
      {command === undefined && path === undefined && summary && (
        <p className="m-0 font-mono text-[12px] text-[var(--text-primary)] break-all" data-testid="tool-approval-summary">{summary}</p>
      )}
      {path !== undefined && (
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-mono text-[12px] text-[var(--text-primary)] break-all" data-testid="tool-approval-path">{path}</span>
          {diffStat && <DiffStat stat={diffStat} />}
        </div>
      )}
      {diff !== undefined && <DiffToggle diff={diff} />}
      {cwd && (
        <p className="mt-1.5 mb-0 text-[var(--text-tertiary)]" data-testid="tool-approval-cwd">
          {i18nT("supervised.card.cwd", undefined, "in")} <code className="font-mono">{cwd}</code>
        </p>
      )}
      {facts.tool.toLowerCase() === "agent" && (
        <p data-testid="tool-approval-agent-caveat" className="mt-2 mb-0 flex items-start gap-1.5 text-[var(--severity-warning-fg)]">
          <Icon path={mdiInformationOutline} size={0.6} className="shrink-0 mt-px" />
          <span>
            {i18nT(
              "supervised.card.agentCaveat",
              undefined,
              "The subagent's own commands and edits are not approved one by one. Approve only if you are fine with it acting on its own.",
            )}
          </span>
        </p>
      )}
    </>
  );
}

const BTN =
  "focus-ring inline-flex items-center justify-center gap-1 px-3 min-h-[44px] sm:min-h-[36px] text-[13px] font-semibold rounded-md border transition-colors max-[520px]:w-full";

/** Inline "Deny with a reason": the text becomes the block reason; a button label is refused. */
function ReasonForm({ onSend, onBack }: { onSend: (reason: string) => void; onBack: () => void }) {
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();
  const collides = reasonCollidesWithOption(trimmed);
  const submit = () => {
    if (trimmed && !collides) onSend(trimmed);
  };
  // Mounted by the operator's own click, so taking focus here is user-initiated (never on card mount).
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="mt-3">
      <label className="block mb-1 text-[var(--text-secondary)]" htmlFor="tool-approval-reason">
        {i18nT("supervised.card.reasonLabel", undefined, "Why? The agent gets this as the reason.")}
      </label>
      <textarea
        ref={ref}
        id="tool-approval-reason"
        data-testid="tool-approval-reason"
        value={reason}
        rows={2}
        aria-invalid={collides}
        aria-describedby={collides ? "tool-approval-reason-error" : undefined}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[13px] text-[var(--text-primary)] focus-ring"
      />
      {collides && (
        <p id="tool-approval-reason-error" data-testid="tool-approval-reason-error" className="mt-1 mb-0 text-[var(--severity-error-fg)]">
          {i18nT("supervised.card.reasonReserved", undefined, "That is a button label, not a reason. Write why you are denying it.")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" data-testid="tool-approval-deny-send" disabled={!trimmed} onClick={submit} className={`${BTN} tint-action-red disabled:opacity-40 disabled:cursor-not-allowed`}>
          <Icon path={mdiClose} size={0.55} />
          {i18nT("supervised.card.reasonSend", undefined, "Deny and send")}
        </button>
        <button type="button" data-testid="tool-approval-reason-back" onClick={onBack} className={`${BTN} border-[var(--border-secondary)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]`}>
          {i18nT("supervised.card.reasonBack", undefined, "Back")}
        </button>
      </div>
    </div>
  );
}

function ActionButtons({ onRespond, onReason }: { onRespond: (value: string) => void; onReason: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" data-testid="tool-approval-approve" onClick={() => onRespond(ALLOW_ONCE)} className={`${BTN} border-transparent bg-[var(--accent-solid)] text-white hover:brightness-110`}>
        <Icon path={mdiCheck} size={0.55} />
        {i18nT("supervised.card.allowOnce", undefined, "Allow once")}
      </button>
      <button type="button" data-testid="tool-approval-deny" onClick={() => onRespond(DENY)} className={`${BTN} tint-action-red`}>
        <Icon path={mdiClose} size={0.55} />
        {i18nT("supervised.card.deny", undefined, "Deny")}
      </button>
      <button type="button" data-testid="tool-approval-deny-reason" onClick={onReason} className={`${BTN} border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]`}>
        {i18nT("supervised.card.denyWithReason", undefined, "Deny with a reason…")}
      </button>
    </div>
  );
}

function PendingCard({ facts, onRespond }: { facts: Facts; onRespond: (result: unknown) => void }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const remaining = useRemainingSeconds(facts.deadline);
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    if (remaining !== null && remaining <= WARN_SECONDS && remaining > 0) setAnnounced(true);
  }, [remaining]);
  const answer = (value: string) => onRespond({ value });
  return (
    <div
      role="group"
      aria-label={i18nT("supervised.card.group", undefined, "Approval needed")}
      data-testid="tool-approval-card"
      className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg"
    >
      <ApprovalHeader facts={facts} remaining={remaining} />
      {/* Announced once when the clock crosses 30 s — never per tick. */}
      <span className="sr-only" role="status" data-testid="tool-approval-announce">
        {announced ? i18nT("supervised.card.thirtySeconds", undefined, "30 seconds left to answer") : ""}
      </span>
      <div className="ml-6 text-xs">
        <ApprovalBody facts={facts} />
        {reasonOpen ? <ReasonForm onSend={answer} onBack={() => setReasonOpen(false)} /> : <ActionButtons onRespond={answer} onReason={() => setReasonOpen(true)} />}
      </div>
    </div>
  );
}

export function ToolApprovalCard({ params, status, result, onRespond }: InteractiveRendererProps) {
  const facts = readFacts(params);
  if (status === "pending") return <PendingCard facts={facts} onRespond={onRespond} />;
  const value = (result as { value?: unknown } | undefined)?.value;
  const picked = typeof value === "string" ? value : undefined;
  const outcome = resolvedOutcome(status, picked, facts.deadline);
  const reason = outcome === "denied" && picked && picked !== DENY ? picked : undefined;
  return <ResolvedRow outcome={outcome} tool={facts.tool} detail={facts.command ?? facts.path ?? facts.summary} reason={reason} />;
}
