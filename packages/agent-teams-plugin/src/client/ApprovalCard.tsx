/**
 * ApprovalCard — lazy `custom-entry-renderer` for `agent-teams-approval`. Branches
 * on the envelope kind: `plan_request` carries Approve / Reject (with optional
 * feedback) controls that post the plan id parsed from the server-built header
 * line (never from the plan text); `plan_decision`, `hook_feedback` and any other
 * kind render text only, no control. The card reads only the row body: no entry
 * id, no payload, no fetch until a control is pressed. A stale or superseded card
 * gets `already_decided` and shows the final state; the outcome survives a remount
 * (virtualised list) in a module-level map. Peer text is plain React text
 * (`pre-wrap`, `overflow-wrap:anywhere`) — no markdown, HTML or links.
 * See change: add-agent-teams-templates-hooks (design D11).
 */
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { type ReactElement, type ReactNode, useId, useRef, useState } from "react";
import { APPROVAL_TABLES } from "./approval-i18n.js";
import { type ApprovalParse, type PlanRef, parseApprovalBody } from "./approval-parse.js";
import { useLazyT } from "./lazy-i18n.js";
import { MAIL_TABLES } from "./mail-i18n.js";
import { formatTime, LINKBTN } from "./recipes.js";
import { decidePlan, type RestFailure } from "./start-api.js";

const PLAIN = "whitespace-pre-wrap [overflow-wrap:anywhere]";
const BTN = "inline-flex min-h-[44px] items-center justify-center rounded border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]";

type Outcome = "approved" | "rejected" | "already_decided" | "unknown_plan";
/** Final outcomes seen on this page, keyed by team / member / plan. */
const MAX_REMEMBERED_OUTCOMES = 200;
const outcomes = new Map<string, Outcome>();
const refKey = (r: PlanRef): string => `${r.teamId}\u0000${r.member}\u0000${r.planId}`;
/** Test seam: forget the remembered outcomes. */
export function resetApprovalOutcomes(): void {
  outcomes.clear();
}

/** A failed decision either settles the plan (controls go away) or is a retryable error key. */
function failureKey(f: RestFailure): { outcome: Outcome } | { error: string } {
  if (f.code === "already_decided") return { outcome: "already_decided" };
  if (f.code === "unknown_plan" || f.status === 404) return { outcome: "unknown_plan" };
  if (f.code === "message_too_long") return { error: "plan.feedbackTooLong" };
  if (f.status === 403) return { error: "plan.forbidden" };
  return { error: "plan.error" };
}

const OUTCOME_KEY: Record<Outcome, string> = {
  approved: "plan.state.approved",
  rejected: "plan.state.rejected",
  already_decided: "plan.alreadyDecided",
  unknown_plan: "plan.unknown",
};

function PlanControls({ plan, member }: { plan: PlanRef; member: string }): ReactElement {
  const t = useLazyT(APPROVAL_TABLES);
  const key = refKey(plan);
  const [outcome, setOutcome] = useState<Outcome | undefined>(() => outcomes.get(key));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [feedback, setFeedback] = useState("");
  const inflight = useRef(false);
  const fieldId = useId();

  const decide = async (approve: boolean): Promise<void> => {
    if (inflight.current) return; // exactly one POST per press, however fast the clicks
    inflight.current = true;
    setSending(true);
    setError(undefined);
    const text = feedback.trim();
    const res = await decidePlan(plan.teamId, plan.member, { planId: plan.planId, approve, ...(text ? { feedback: text } : {}) });
    inflight.current = false;
    setSending(false);
    const next = res.ok ? ({ outcome: approve ? "approved" : "rejected" } as const) : failureKey(res.failure);
    if ("outcome" in next) {
      if (outcomes.size >= MAX_REMEMBERED_OUTCOMES) outcomes.delete(outcomes.keys().next().value as string);
      outcomes.set(key, next.outcome);
      setOutcome(next.outcome);
    } else {
      setError(next.error);
    }
  };

  if (outcome) {
    return (
      <p role="status" data-testid="team-approval-state" data-outcome={outcome} className="m-0 text-[12px] font-semibold text-[var(--text-primary)]">
        {t(OUTCOME_KEY[outcome])}
      </p>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-testid="team-approval-controls">
      <label htmlFor={fieldId} className="text-[12px] text-[var(--text-secondary)]">
        {t("plan.feedbackLabel", { member })}
      </label>
      <textarea
        id={fieldId}
        value={feedback}
        rows={2}
        readOnly={sending}
        placeholder={t("plan.feedbackPlaceholder")}
        onChange={(e) => setFeedback(e.target.value)}
        data-testid="team-approval-feedback"
        className="focus-ring w-full resize-y rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={sending} onClick={() => void decide(true)} data-testid="team-approval-approve" className={`${BTN} border-transparent bg-[var(--accent-solid)] text-white hover:opacity-90`}>
          {sending ? t("plan.sending") : t("plan.approve")}
        </button>
        <button type="button" disabled={sending} onClick={() => void decide(false)} data-testid="team-approval-reject" className={`${BTN} border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] hover:opacity-90`}>
          {t("plan.reject")}
        </button>
      </div>
      <p role="alert" data-testid="team-approval-error" className="m-0 text-[12px] text-[var(--tint-red-fg)]" hidden={!error}>
        {error ? t(error) : null}
      </p>
    </div>
  );
}

interface ShellProps {
  id: string;
  title: string;
  label: string;
  sender?: string;
  kind: ApprovalParse["type"];
  time: number;
  expanded: boolean;
  onToggle: () => void;
  text: string;
  planRef?: string;
  controls?: ReactNode;
}

function Shell({ id, title, label, sender, kind, time, expanded, onToggle, text, planRef, controls }: ShellProps): ReactElement {
  const mail = useLazyT(MAIL_TABLES);
  const bodyId = `${id}-body`;
  const clock = formatTime(time);
  return (
    <div role="group" aria-label={label} data-testid="team-approval-card" data-kind={kind} className="my-1 mx-2 overflow-hidden rounded-lg border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] bg-[var(--bg-secondary)] text-xs sm:mx-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-1.5">
        <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
          ◆
        </span>
        <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-approval-title">
          {title}
        </span>
        {sender ? (
          <span className="text-[12px] text-[var(--text-secondary)]">
            {mail("card.from")} <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-approval-sender">{sender}</span>
          </span>
        ) : null}
        {planRef ? (
          <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-approval-ref">
            {planRef}
          </span>
        ) : null}
        {clock !== undefined ? <span className="ml-auto text-[12px] text-[var(--text-secondary)]">{clock}</span> : null}
      </div>
      <div className="px-3 pb-1.5 pt-1">
        {expanded ? (
          <div id={bodyId} tabIndex={0} data-testid="team-approval-body" className={`${PLAIN} focus-ring max-h-[60vh] overflow-y-auto rounded bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]`}>
            {text}
          </div>
        ) : (
          <div id={bodyId} data-testid="team-approval-body" className={`${PLAIN} line-clamp-3 text-[12px] text-[var(--text-primary)]`}>
            {text}
          </div>
        )}
        <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle} className={`${LINKBTN} font-semibold`} data-testid="team-approval-toggle">
          {expanded ? mail("card.showLess") : mail("card.showMore")}
        </button>
        {controls}
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useLazyT>;
const senderLabel = (t: Translate, s: { role: string; name: string }): string => (s.role === "lead" ? t("role.lead") : s.role === "server" ? t("role.server") : t("role.member", { name: s.name }));

export function ApprovalCard({ body, timestamp, expanded, onToggle }: CustomEntryRendererProps): ReactElement {
  const t = useLazyT(APPROVAL_TABLES);
  const mail = useLazyT(MAIL_TABLES);
  const id = useId();
  const common = { id, time: timestamp, expanded, onToggle };
  const parsed = parseApprovalBody(body);

  if (parsed.type === "truncated" || parsed.type === "unrecognised") {
    return <Shell {...common} kind={parsed.type} title={mail(parsed.type === "truncated" ? "card.truncatedTitle" : "card.unrecognisedTitle")} label={mail(parsed.type === "truncated" ? "card.truncatedLabel" : "card.unrecognisedTitle")} text={parsed.body} />;
  }
  const sender = senderLabel(mail, parsed.sender);
  if (parsed.type === "plan_request") {
    const member = parsed.ref?.member ?? parsed.sender.name;
    return (
      <Shell
        {...common}
        kind="plan_request"
        title={t("plan.title", { member })}
        label={t("plan.label", { member })}
        sender={sender}
        planRef={parsed.ref ? t("plan.ref", { id: parsed.ref.planId, team: parsed.ref.teamId }) : undefined}
        text={parsed.text}
        controls={parsed.ref ? <PlanControls plan={parsed.ref} member={parsed.ref.member} /> : undefined}
      />
    );
  }
  if (parsed.type === "hook_feedback") {
    return <Shell {...common} kind="hook_feedback" title={t("hookFeedback.title")} label={t("hookFeedback.title")} sender={sender} text={parsed.text} />;
  }
  if (parsed.type === "plan_decision") {
    return <Shell {...common} kind="plan_decision" title={t("decision.title")} label={t("decision.title")} sender={sender} text={parsed.text} />;
  }
  return <Shell {...common} kind="generic" title={mail("card.title")} label={mail("card.groupLabel", { sender })} sender={sender} text={parsed.text} />;
}
