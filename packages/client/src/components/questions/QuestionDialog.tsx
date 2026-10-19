/**
 * QuestionDialog — answer an open agent question in place, with context.
 *
 * Opened for sessions that are not visible on the board (hidden / headless /
 * automation / goal). Lazy-fetches `GET /api/questions/:id`, shows the labelled
 * brief (+ on-demand Summarize / Retry), a collapsible context snapshot, and the
 * SAME interactive renderers the chat uses (confirm, select, multiselect, input,
 * editor, batch). File-access prompts are read-only with a link to the Access
 * page. Brief + snapshot are model/agent-derived and render as PLAIN TEXT only.
 *
 * a11y: `role=dialog`, `aria-modal`, `aria-labelledby` → title; focus trap +
 * Esc via client-utils; Esc is intercepted in the capture phase so an answer
 * box's own Esc-cancels shortcut can never cancel the agent's question from
 * here. Mobile tier: full screen with a sticky footer.
 * See change: add-pending-question-stack.
 */

import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { useFocusTrap } from "@blackbelt-technology/pi-dashboard-client-utils/useFocusTrap";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
import type { QuestionDetail, QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { mdiAlertOutline, mdiInformationOutline, mdiLoading, mdiShieldAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { encodeDialogAnswer } from "../../lib/questions/dialog-answer.js";
import { answerQuestion, fetchQuestionDetail, summarizeQuestion } from "../../lib/questions/questions-api.js";
import { useNow } from "../../lib/time/use-now.js";
import { formatRelativeTime } from "../../lib/util/format.js";
import { getInteractiveRenderer } from "../interactive-renderers/registry.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

const ACCESS_PAGE = "/settings/access";
const MAX_TOOL_LINES = 5;
const TOOL_LINE_MAX = 160;

export interface QuestionDialogProps {
  /** Latest known row (kept current by the stack while the question is open). */
  row: QuestionRow;
  /** The row left the stack while the dialog was open (answered elsewhere / timed out). */
  gone: boolean;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
}

type Load = { phase: "loading" } | { phase: "ready"; detail: QuestionDetail } | { phase: "missing" } | { phase: "error"; message: string };

const isGenerated = (d: QuestionDetail | undefined) => d?.briefLabel === "generated" || d?.briefLabel === "generated-limited";

function briefLabelText(d: QuestionDetail): string | null {
  switch (d.briefLabel) {
    case "provided":
      return i18nT("questions.brief.provided", undefined, "From the agent");
    case "generated":
      return i18nT("questions.brief.generated", undefined, "Generated · @fast");
    case "generated-limited":
      return i18nT("questions.brief.limited", undefined, "Limited context");
    default:
      return null;
  }
}

function summarizeErrorText(reason: string | undefined): string {
  if (reason === "unavailable") {
    return i18nT("questions.brief.error.unavailable", undefined, "Summaries aren't available — the @fast model role isn't set up.");
  }
  return i18nT("questions.brief.error.failed", undefined, "Couldn't generate a summary. The current text is unchanged.");
}

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Plain-text lines for the workflow-run summary (shape is producer-defined). */
function workflowLines(run: unknown): string[] {
  if (run === null || run === undefined) return [];
  if (typeof run !== "object") return [String(run)];
  const entries = Object.entries(run as Record<string, unknown>);
  const lines = entries
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k}: ${String(v)}`);
  if (lines.length > 0) return lines;
  return [oneLine(JSON.stringify(run), 500)];
}

function Callout({ tone, testId, icon, children }: { tone: "info" | "warning" | "error"; testId?: string; icon: string; children: ReactNode }) {
  const cls = {
    info: "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]",
    warning: "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]",
    error: "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]",
  }[tone];
  return (
    <div data-testid={testId} className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${cls}`}>
      <Icon path={icon} size={0.6} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function BriefSection({
  detail,
  pending,
  busy,
  error,
  canSummarize,
  onSummarize,
  buttonClass,
}: {
  detail: QuestionDetail;
  pending: boolean;
  busy: boolean;
  error: string | undefined;
  canSummarize: boolean;
  onSummarize: () => void;
  buttonClass: string;
}) {
  const label = briefLabelText(detail);
  const showAction = !isGenerated(detail) && !pending && canSummarize;
  return (
    <section
      data-testid="question-brief"
      aria-label={i18nT("questions.brief.label", undefined, "Summary")}
      className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-3"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {i18nT("questions.brief.label", undefined, "Summary")}
        </span>
        {label && <span className="rounded border border-[var(--border-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">{label}</span>}
        {(pending || busy) && (
          <span role="status" className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <Icon path={mdiLoading} size={0.5} className="animate-spin motion-reduce:animate-none" />
            {i18nT("questions.summarizing", undefined, "Summarizing…")}
          </span>
        )}
      </div>
      {detail.brief ? (
        <p className="whitespace-pre-wrap break-words text-[13px] text-[var(--text-primary)]">{detail.brief}</p>
      ) : (
        !pending && <p className="text-xs text-[var(--text-secondary)]">{i18nT("questions.brief.none", undefined, "No summary available.")}</p>
      )}
      {error && (
        <div className="mt-2">
          <Callout tone="error" icon={mdiAlertOutline}>
            <span role="alert">{error}</span>
          </Callout>
        </div>
      )}
      {showAction && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid={error ? "question-brief-retry" : "question-brief-summarize"}
            onClick={onSummarize}
            disabled={busy}
            className={buttonClass}
          >
            {error ? i18nT("common.retry", undefined, "Retry") : i18nT("questions.brief.summarize", undefined, "Summarize")}
          </button>
        </div>
      )}
    </section>
  );
}

function QuestionSection({
  detail,
  readOnly,
  disabled,
  answerError,
  onAnswer,
  onAccess,
}: {
  detail: QuestionDetail;
  readOnly: boolean;
  disabled: boolean;
  answerError: string | undefined;
  onAnswer: (body: { answer: string } | { cancelled: true }) => void;
  onAccess: (e: React.MouseEvent) => void;
}) {
  const Renderer = getInteractiveRenderer(detail.type);
  return (
    <section aria-label={i18nT("questions.dialog.question", undefined, "Question")}>
      {readOnly ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm font-medium text-[var(--text-primary)]">{detail.question}</p>
          <Callout tone="warning" icon={mdiShieldAlertOutline}>
            <p>{i18nT("questions.file.body", undefined, "This is a file-access request. It can't be answered here — approve or deny it on the Access page.")}</p>
            <a href={ACCESS_PAGE} onClick={onAccess} data-testid="question-access-link" className="mt-1 inline-block underline focus-ring">
              {i18nT("questions.file.link", undefined, "Open Access")}
            </a>
          </Callout>
        </div>
      ) : (
        <fieldset disabled={disabled} className={`m-0 min-w-0 border-0 p-0 ${disabled ? "opacity-60" : ""}`}>
          <legend className="sr-only">{i18nT("questions.dialog.question", undefined, "Question")}</legend>
          <Renderer
            requestId={detail.id}
            method={detail.type}
            params={{
              title: detail.question,
              options: detail.options,
              questions: detail.questions,
              ...(detail.allowOther ? { allowOther: true } : {}),
            }}
            status="pending"
            onRespond={(result) => onAnswer({ answer: encodeDialogAnswer(result) })}
            onCancel={() => onAnswer({ cancelled: true })}
          />
        </fieldset>
      )}
      {answerError && (
        <div className="mt-2" data-testid="question-answer-error">
          <Callout tone="error" icon={mdiAlertOutline}>
            <span role="alert">{answerError}</span>
          </Callout>
        </div>
      )}
    </section>
  );
}

function ContextSection({ snapshot, pending, mobile }: { snapshot: QuestionDetail["snapshot"]; pending: boolean; mobile: boolean }) {
  const tools = snapshot.toolCalls.slice(0, MAX_TOOL_LINES);
  const wfLines = snapshot.workflowRun !== undefined ? workflowLines(snapshot.workflowRun) : [];
  const absent =
    snapshot.assistantAbsentReason === "evicted"
      ? i18nT("questions.context.evicted", undefined, "The earlier assistant message is no longer retained.")
      : i18nT("questions.context.none", undefined, "No assistant message came before this question.");
  return (
    <details data-testid="question-context" open={pending ? true : undefined} className="rounded border border-[var(--border-secondary)] px-3 py-2">
      <summary className={`cursor-pointer text-xs font-medium text-[var(--text-secondary)] focus-ring ${mobile ? "min-h-[44px] leading-[44px]" : ""}`}>
        {i18nT("questions.context.heading", undefined, "Context")}
      </summary>
      <div className="mt-2 space-y-3 text-xs text-[var(--text-secondary)]">
        <ContextBlock heading={i18nT("questions.context.assistant", undefined, "Last assistant message")}>
          <p className="whitespace-pre-wrap break-words">{snapshot.assistantText || absent}</p>
        </ContextBlock>
        {tools.length > 0 && (
          <ContextBlock heading={i18nT("questions.context.tools", undefined, "Recent tool calls")}>
            <ul className="space-y-0.5 font-mono">
              {tools.map((tc, i) => (
                <li key={`${i}-${tc.name}`} className="truncate">
                  {oneLine(`${tc.name} — ${tc.summary}`, TOOL_LINE_MAX)}
                </li>
              ))}
            </ul>
          </ContextBlock>
        )}
        {wfLines.length > 0 && (
          <ContextBlock heading={i18nT("questions.context.workflow", undefined, "Workflow run")}>
            <ul className="space-y-0.5">
              {wfLines.map((l) => (
                <li key={l} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          </ContextBlock>
        )}
      </div>
    </details>
  );
}

function ContextBlock({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 font-medium text-[var(--text-primary)]">{heading}</h3>
      {children}
    </div>
  );
}

/** Detail fetch + Summarize + answer state for one open question. */
function useQuestionDialogState(row: QuestionRow, gone: boolean, onClose: () => void) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [summarize, setSummarize] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [answer, setAnswer] = useState<{ busy: boolean; error?: string; answered: boolean }>({ busy: false, answered: false });
  const submitting = useRef(false);

  // Lazy detail; refetch when the server reports a brief change for this row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `row.briefStatus` is the deliberate refetch trigger.
  useEffect(() => {
    let cancelled = false;
    void fetchQuestionDetail(row.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setLoad({ phase: "ready", detail: res.data });
      else if (res.status === 404) setLoad({ phase: "missing" });
      else setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "error", message: res.error }));
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.briefStatus]);

  const detail = load.phase === "ready" ? load.detail : undefined;
  const answeredElsewhere = answer.answered || load.phase === "missing" || (gone && !submitting.current);
  const readOnly = row.origin === "file" || detail?.answerable === false;
  const inputsDisabled = answeredElsewhere || answer.busy;

  const runSummarize = useCallback(async () => {
    setSummarize({ busy: true });
    const res = await summarizeQuestion(row.id);
    if (res.ok) {
      setLoad({ phase: "ready", detail: res.data });
      setSummarize({ busy: false });
    } else if (res.reason === "already-generated") {
      const fresh = await fetchQuestionDetail(row.id);
      if (fresh.ok) setLoad({ phase: "ready", detail: fresh.data });
      setSummarize({ busy: false });
    } else if (res.status === 404) {
      setLoad({ phase: "missing" });
      setSummarize({ busy: false });
    } else {
      setSummarize({ busy: false, error: summarizeErrorText(res.reason) });
    }
  }, [row.id]);

  const send = useCallback(
    async (body: { answer: string } | { cancelled: true }) => {
      submitting.current = true;
      setAnswer({ busy: true, answered: false });
      const res = await answerQuestion(row.id, body);
      if (res.ok && res.data.transmitted) {
        onClose();
        return;
      }
      submitting.current = false;
      if (res.ok) {
        setAnswer({ busy: false, answered: false, error: i18nT("questions.answer.notDelivered", undefined, "The session couldn't be reached. Try again.") });
      } else if (res.status === 409 || res.status === 404) {
        setAnswer({ busy: false, answered: true });
      } else {
        setAnswer({ busy: false, answered: false, error: i18nT("questions.answer.failed", { error: res.error }, "Couldn't send the answer: {error}") });
      }
    },
    [row.id, onClose],
  );

  return { load, detail, summarize, answer, answeredElsewhere, readOnly, inputsDisabled, runSummarize, send };
}

export function QuestionDialog({ row, gone, onClose, onOpenSession }: QuestionDialogProps) {
  const mobile = useMobile();
  const [, navigate] = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const now = useNow(true);
  const { load, detail, summarize, answer, answeredElsewhere, readOnly, inputsDisabled, runSummarize, send } = useQuestionDialogState(row, gone, onClose);
  useFocusTrap(panelRef, true);
  useEscapeDismiss(true, onClose);

  const goToAccess = (e: React.MouseEvent) => {
    e.preventDefault();
    onClose();
    navigate(ACCESS_PAGE);
  };

  const pending = (detail?.briefStatus ?? row.briefStatus) === "pending";
  const btn = `inline-flex items-center justify-center rounded border px-3 text-xs focus-ring ${mobile ? "min-h-[44px]" : "min-h-[32px]"}`;
  const secondary = `${btn} border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;

  return (
    <DialogPortal>
      <div className={`fixed inset-0 z-dialog flex ${mobile ? "" : "items-center justify-center"}`}>
        {!mobile && <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} data-testid="question-dialog-overlay" />}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid="question-dialog"
          onKeyDownCapture={(e) => {
            if (e.key !== "Escape") return;
            // Escape inside the inline "Other" field only collapses it (the field consumes the key).
            // See change: add-ask-user-inline-other.
            if ((e.target as HTMLElement | null)?.closest?.("[data-other-input]")) return;
            // Never let an answer box's Esc-cancels shortcut answer the agent's question.
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className={`relative flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none ${
            mobile
              ? "h-full w-full"
              : "mx-4 max-h-[85vh] w-full max-w-xl rounded-lg border border-[var(--border-primary)] shadow-xl"
          }`}
        >
          <header className="shrink-0 border-b border-[var(--border-secondary)] px-4 py-3">
            <h2 id={titleId} className="text-lg font-semibold text-[var(--text-primary)]">
              {row.sessionLabel}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {[row.changeName, i18nT("questions.age", { time: formatRelativeTime(now - row.askedAt) }, "{time} ago")].filter(Boolean).join(" · ")}
            </p>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {load.phase === "loading" && (
              <p role="status" className="text-xs text-[var(--text-secondary)]">
                {i18nT("questions.loading", undefined, "Loading question…")}
              </p>
            )}
            {load.phase === "error" && (
              <Callout tone="error" icon={mdiAlertOutline}>
                <span role="alert">{i18nT("questions.loadError", undefined, "Couldn't load this question.")}</span>
              </Callout>
            )}

            {answeredElsewhere && (
              <Callout tone="info" testId="question-answered" icon={mdiInformationOutline}>
                <span role="status">
                  {i18nT("questions.answered", undefined, "Already answered — this question is no longer open. Inputs are disabled.")}
                </span>
              </Callout>
            )}

            {detail && (
              <BriefSection
                detail={detail}
                pending={pending}
                busy={summarize.busy}
                error={summarize.error}
                canSummarize={!answeredElsewhere}
                onSummarize={() => void runSummarize()}
                buttonClass={secondary}
              />
            )}

            {detail && (
              <QuestionSection
                detail={detail}
                readOnly={readOnly}
                disabled={inputsDisabled}
                answerError={answer.error}
                onAnswer={(body) => void send(body)}
                onAccess={goToAccess}
              />
            )}

            {detail && <ContextSection snapshot={detail.snapshot} pending={pending} mobile={mobile} />}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-secondary)] px-4 py-3">
            {onOpenSession && (
              <button type="button" data-testid="question-open-session" onClick={() => onOpenSession(row.sessionId)} className={secondary}>
                {i18nT("questions.dialog.openSession", undefined, "Open session")}
              </button>
            )}
            <button type="button" data-testid="question-later" onClick={onClose} className={secondary}>
              {i18nT("questions.dialog.later", undefined, "Later")}
            </button>
          </footer>
        </div>
      </div>
    </DialogPortal>
  );
}
