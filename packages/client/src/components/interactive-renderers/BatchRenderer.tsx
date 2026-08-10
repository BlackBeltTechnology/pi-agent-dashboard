import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCheck, mdiCheckCircle, mdiImageMultiple, mdiViewListOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import { InputComposer } from "./InputComposer.js";
import { isCancelOption, parseOption } from "./parseOption.js";
import type { InteractiveRendererProps } from "./types.js";

/**
 * BatchRenderer — renders a `batch` ask_user request as a single wizard card:
 * stepper header, one sub-question per page, Back/Next, a Review page with
 * per-row Edit, and a final Submit. Answers are held in component state and
 * sent only on Submit (one `{answers}` response). A multiselect step yields
 * multiple values (rendered as pills).
 *
 * See change: redesign-ask-user-question-cards.
 */

interface SubQuestion {
  method: "confirm" | "select" | "multiselect" | "input";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
}

type Answer =
  | { confirmed: boolean }
  | { value: string; images?: ImageContent[] }
  | { values: string[] };

function initialAnswer(q: SubQuestion): Answer | undefined {
  if (q.method === "input") return { value: "" };
  if (q.method === "multiselect") return { values: [] };
  return undefined; // confirm / select require an explicit pick
}

function answerToText(q: SubQuestion, a: Answer | undefined): React.ReactNode {
  if (!a) return <span className="text-[var(--text-tertiary)] italic">(unanswered)</span>;
  if ("confirmed" in a) return a.confirmed ? "Yes" : "No";
  if ("values" in a) {
    if (a.values.length === 0) return <span className="text-[var(--text-tertiary)] italic">(none)</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {a.values.map((v) => (
          <span key={v} className="inline-block rounded px-2 py-0.5 text-[11px] bg-blue-500/15 text-blue-300">
            {v}
          </span>
        ))}
      </span>
    );
  }
  if ("value" in a) {
    const imgCount = a.images?.length ?? 0;
    const pill = imgCount > 0 ? (
      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] align-middle">
        <Icon path={mdiImageMultiple} size={0.5} />+{imgCount}
      </span>
    ) : null;
    if (a.value === "" && imgCount === 0) return <span className="text-[var(--text-tertiary)] italic">{i18nT("common.leftBlank", undefined, "(left blank)")}</span>;
    return <span>{a.value === "" ? <span className="text-[var(--text-tertiary)] italic">{i18nT("common.noText", undefined, "(no text)")}</span> : a.value}{pill}</span>;
  }
  return null;
}

export function BatchRenderer({ params, status, result, onRespond, onCancel }: InteractiveRendererProps) {
  const title = (params.title as string) ?? "Questions";
  const questions = ((params.questions as SubQuestion[]) ?? []).filter(Boolean);
  const resolvedAnswers = (result as any)?.answers as Answer[] | undefined;

  const [answers, setAnswers] = useState<Array<Answer | undefined>>(() =>
    questions.map(initialAnswer),
  );
  // step in 0..questions.length-1 are questions; questions.length is Review.
  const [step, setStep] = useState(0);

  // ── Resolved / cancelled / dismissed: read-only summary ──────────
  if (status !== "pending") {
    if (status === "cancelled" || status === "dismissed") {
      return (
        <div className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex items-center gap-2">
          <Icon path={mdiViewListOutline} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
          <span className="text-[var(--text-secondary)]"><InlineMarkdown content={title} /></span>
          <span className="ml-1 text-[var(--text-tertiary)]">
            {status === "cancelled" ? "Cancelled" : "Answered in terminal"}
          </span>
        </div>
      );
    }
    return (
      <div className="mx-4 my-1 bg-[var(--bg-hover)] rounded-lg overflow-hidden text-xs">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
          <Icon path={mdiCheckCircle} size={0.55} className="text-green-400 shrink-0" />
          <span className="text-[var(--text-primary)] font-medium"><InlineMarkdown content={title} /></span>
          <span className="ml-auto text-green-400">{resolvedAnswers?.length ?? 0} answers</span>
        </div>
        <div className="p-3 flex flex-col gap-2">
          {questions.map((q, i) => (
            <ReviewRow key={i} num={i + 1} question={q} answer={resolvedAnswers?.[i]} />
          ))}
        </div>
      </div>
    );
  }

  const onReview = step >= questions.length;
  const current = questions[step];

  function setAnswer(a: Answer) {
    setAnswers((prev) => {
      const next = prev.slice();
      next[step] = a;
      return next;
    });
  }

  const canAdvance = onReview || answers[step] !== undefined;

  return (
    <div className="mx-4 my-2 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-xl overflow-hidden">
      {/* Header + stepper */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Icon path={mdiViewListOutline} size={0.6} className="text-blue-400 shrink-0" />
          <span className="text-sm font-medium text-[var(--text-primary)]"><InlineMarkdown content={title} /></span>
          <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
            {onReview ? "Review" : `Question ${step + 1} of ${questions.length}`}
          </span>
        </div>
        <div className="flex gap-1.5 mt-3">
          {questions.map((q, i) => {
            const done = answers[i] !== undefined;
            const active = i === step;
            return (
              <button
                key={i}
                onClick={() => setStep(i)}
                className="flex-1 flex flex-col gap-1.5 text-left"
                title={q.title}
              >
                <span
                  className={
                    active
                      ? "h-1 rounded bg-blue-500"
                      : done
                        ? "h-1 rounded bg-green-500"
                        : "h-1 rounded bg-[var(--border-secondary)]"
                  }
                />
                <span
                  className={
                    active
                      ? "text-[10px] text-[var(--text-primary)] truncate"
                      : done
                        ? "text-[10px] text-green-400 truncate"
                        : "text-[10px] text-[var(--text-tertiary)] truncate"
                  }
                >
                  {q.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-4">
        {onReview ? (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-[var(--text-primary)] mb-1">{i18nT("common.reviewYourAnswers", undefined, "Review your answers")}</div>
            {questions.map((q, i) => (
              <ReviewRow
                key={i}
                num={i + 1}
                question={q}
                answer={answers[i]}
                onEdit={() => setStep(i)}
              />
            ))}
          </div>
        ) : (
          <StepBody
            question={current}
            answer={answers[step]}
            onChange={setAnswer}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center gap-2">
        {step > 0 ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="px-3 py-1 text-xs rounded bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)] transition-colors"
          >
            {i18nT("common.back22", undefined, "← Back")}
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs rounded bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] transition-colors"
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        )}
        <div className="flex-1" />
        {onReview ? (
          <button
            onClick={() => onRespond({ answers })}
            className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500 text-white transition-colors inline-flex items-center gap-1"
          >
            <Icon path={mdiCheck} size={0.5} /> {i18nT("common.submitAll", undefined, "Submit all")} {questions.length}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
            className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {i18nT("common.next", undefined, "Next →")}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  num,
  question,
  answer,
  onEdit,
}: {
  num: number;
  question: SubQuestion;
  answer: Answer | undefined;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <span className="w-5 h-5 rounded grid place-items-center text-[11px] font-semibold bg-green-500/20 text-green-400 shrink-0">
        {num}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{question.title}</div>
        <div className="text-xs text-[var(--text-primary)] font-medium mt-0.5">{answerToText(question, answer)}</div>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="text-[11px] text-blue-400 hover:text-blue-300 self-center shrink-0">
          {i18nT("common.edit", undefined, "Edit")}
        </button>
      )}
    </div>
  );
}

function StepBody({
  question,
  answer,
  onChange,
}: {
  question: SubQuestion;
  answer: Answer | undefined;
  onChange: (a: Answer) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-[var(--text-primary)] mb-1">{question.title}</div>
      {question.message && (
        <div className="text-[11px] text-[var(--text-tertiary)] mb-3"><InlineMarkdown content={question.message} /></div>
      )}
      {question.method === "input" && (
        <InputComposer
          autoFocus
          value={(answer as { value: string } | undefined)?.value ?? ""}
          images={(answer as { images?: ImageContent[] } | undefined)?.images ?? []}
          placeholder={question.placeholder}
          onChange={(next) => onChange({ value: next.value, images: next.images.length > 0 ? next.images : undefined })}
          onSubmit={() => { /* batch advances via Next/Submit; no per-step submit */ }}
        />
      )}
      {question.method === "confirm" && (
        <div className="flex gap-2">
          {(["Yes", "No"] as const).map((label) => {
            const val = label === "Yes";
            const picked = (answer as { confirmed: boolean } | undefined)?.confirmed === val;
            return (
              <button
                key={label}
                onClick={() => onChange({ confirmed: val })}
                className={
                  picked
                    ? val
                      ? "px-3 py-1 text-xs rounded bg-green-600 text-white"
                      : "px-3 py-1 text-xs rounded bg-red-600 text-white"
                    : "px-3 py-1 text-xs rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {question.method === "select" && (
        <div className="flex flex-col gap-1.5">
          {(question.options ?? []).filter((o) => !isCancelOption(o)).map((option) => {
            const { title: oTitle, description } = parseOption(option);
            const picked = (answer as { value: string } | undefined)?.value === option;
            return (
              <button
                key={option}
                onClick={() => onChange({ value: option })}
                className={
                  picked
                    ? "w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg border border-blue-500 bg-blue-500/10 text-[var(--text-primary)]"
                    : "w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-blue-500"
                }
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{oTitle}</span>
                  {description && <span className="block text-[11px] text-[var(--text-tertiary)] mt-0.5">{description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {question.method === "multiselect" && (
        <MultiselectStep
          options={question.options ?? []}
          values={(answer as { values: string[] } | undefined)?.values ?? []}
          onChange={(values) => onChange({ values })}
        />
      )}
    </div>
  );
}

function MultiselectStep({
  options,
  values,
  onChange,
}: {
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(option: string) {
    onChange(values.includes(option) ? values.filter((v) => v !== option) : [...values, option]);
  }
  return (
    <div className="flex flex-col gap-1">
      {options.map((option) => {
        const on = values.includes(option);
        return (
          <label
            key={option}
            className={
              on
                ? "flex items-center gap-2.5 px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-[var(--text-primary)] text-xs cursor-pointer"
                : "flex items-center gap-2.5 px-3 py-2 rounded-lg border border-transparent text-[var(--text-primary)] text-xs cursor-pointer hover:bg-[var(--bg-surface)]"
            }
          >
            <input type="checkbox" checked={on} onChange={() => toggle(option)} className="accent-blue-500" />
            <span>{option}</span>
          </label>
        );
      })}
    </div>
  );
}
