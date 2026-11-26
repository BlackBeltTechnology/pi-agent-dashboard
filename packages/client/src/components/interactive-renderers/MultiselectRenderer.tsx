import { isOtherAllowed, isOwnOtherOption } from "@blackbelt-technology/pi-dashboard-shared/prompt-answer.js";
import { mdiCheckboxMarkedOutline, mdiCheckCircle } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useMemo, useState } from "react";
import { usePromptDraft, usePromptDraftSync } from "../../hooks/usePromptDraft.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { AnsweredOption } from "./AnsweredOption.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import { OtherOption } from "./OtherOption.js";
import type { InteractiveRendererProps } from "./types.js";

/** Persisted multiselect state: checked listed options + the inline Other row. */
interface MultiselectDraft {
  checked: string[];
  otherActive: boolean;
  otherText: string;
}

function parseMultiselectDraft(raw: unknown): MultiselectDraft | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.checked) || !r.checked.every((c) => typeof c === "string")) return undefined;
  if (typeof r.otherActive !== "boolean" || typeof r.otherText !== "string") return undefined;
  return { checked: r.checked as string[], otherActive: r.otherActive, otherText: r.otherText };
}

/** Re-keyed per (session, prompt) so a reused element re-initialises from that prompt's draft. */
export function MultiselectRenderer(props: InteractiveRendererProps) {
  return <MultiselectRendererBody key={`${props.sessionId ?? ""}\u0000${props.requestId}`} {...props} />;
}

function MultiselectRendererBody({ params, status, result, onRespond, onCancel, sessionId, requestId }: InteractiveRendererProps) {
  const title = params.title as string;
  const message = params.message as string | undefined;
  const rawOptions = (params.options as string[]) ?? [];
  const selectedValues = (result as any)?.values as string[] | undefined;

  // Inline "Other" (opt-in). See change: add-ask-user-inline-other.
  const otherAllowed = isOtherAllowed({ allowOther: params.allowOther as boolean | undefined, options: rawOptions });
  // The inline row replaces the caller's own "Other…" option: list once, use for rows,
  // select-all, counts and value filtering. See change: fix-input-state-consistency (#1116).
  const options = otherAllowed ? rawOptions.filter((o) => !isOwnOtherOption(o)) : rawOptions;
  const draftSession = status === "pending" ? sessionId : undefined;
  const draft = usePromptDraft(draftSession, requestId, parseMultiselectDraft);
  // A restored draft only re-selects options still listed, and only reopens Other while it is allowed.
  const [checked, setChecked] = useState<Set<string>>(() => new Set((draft?.checked ?? []).filter((c) => options.includes(c))));
  const [otherActive, setOtherActive] = useState(otherAllowed && draft?.otherActive === true);
  const [otherText, setOtherText] = useState(draft?.otherText ?? "");
  const draftState = useMemo<MultiselectDraft>(() => ({ checked: [...checked], otherActive, otherText }), [checked, otherActive, otherText]);
  usePromptDraftSync(draftSession, requestId, draftState);
  const otherTrimmed = otherText.trim();
  const otherBlocked = otherAllowed && otherActive && !otherTrimmed;
  // Select all touches only the listed options; the custom value is appended on submit, de-duplicated.
  const submitValues = Array.from(new Set([...[...checked].filter((v) => options.includes(v)), ...(otherAllowed && otherActive && otherTrimmed ? [otherTrimmed] : [])]));

  // Derived: are all real options currently checked? Drives the synthetic
  // "Select all" row's checkbox state and its click behavior.
  const allChecked = options.length > 0 && options.every((o) => checked.has(o));

  function toggle(option: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(options));
  }

  if (status === "cancelled" || status === "dismissed") {
    return (
      <div className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex items-center gap-2">
        <Icon path={mdiCheckboxMarkedOutline} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-[var(--text-secondary)]"><InlineMarkdown content={title} /></span>
        <span className="ml-1 text-[var(--text-tertiary)]">
          {status === "cancelled" ? "Cancelled" : "Answered in terminal"}
        </span>
      </div>
    );
  }

  if (status === "resolved") {
    const picks = selectedValues ?? [];
    return (
      <div className="mx-4 my-1 p-3 bg-[var(--bg-hover)] rounded-lg text-xs">
        <div className="flex items-center gap-2 mb-2">
          <Icon path={mdiCheckboxMarkedOutline} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
          <span className="text-[var(--text-primary)] font-medium"><InlineMarkdown content={title} /></span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-green-400">
            <Icon path={mdiCheckCircle} size={0.5} /> {picks.length} of {options.length}
          </span>
        </div>
        {message && (
          <div className="text-xs text-[var(--text-secondary)] mb-2 ml-6"><MarkdownContent content={message} /></div>
        )}
        <div className="flex flex-col gap-1 ml-6">
          {options.map((option) => (
            <AnsweredOption key={option} title={option} picked={picks.includes(option)} />
          ))}
          {picks
            .filter((v) => !options.includes(v))
            .map((v) => (
              <AnsweredOption key={`other:${v}`} title={v} label={i18nT("common.other", undefined, "Other")} picked />
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon path={mdiCheckboxMarkedOutline} size={0.6} className="text-blue-400 shrink-0" />
        <span className="text-sm font-medium text-[var(--text-primary)]"><InlineMarkdown content={title} /></span>
      </div>
      {message && (
        <div className="text-xs text-[var(--text-secondary)] mb-3 ml-6"><MarkdownContent content={message} /></div>
      )}
      <div className="flex flex-col gap-1 ml-6 mb-2">
        {options.length > 0 && (
          <>
            <label
              data-testid="select-all-row"
              className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--bg-surface)] rounded px-2 py-1 transition-colors text-[var(--text-tertiary)] italic"
            >
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="accent-blue-500"
              />
              <span>{i18nT("common.selectAll", undefined, "Select all")}</span>
            </label>
            <div className="border-t border-[var(--border-subtle)] my-1" />
          </>
        )}
        {options.map((option) => (
          <label
            key={option}
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--bg-surface)] rounded px-2 py-1 transition-colors"
          >
            <input
              type="checkbox"
              checked={checked.has(option)}
              onChange={() => toggle(option)}
              className="accent-blue-500"
            />
            <span className="text-[var(--text-primary)]">{option}</span>
          </label>
        ))}
        {otherAllowed && (
          <OtherOption
            variant="checkbox"
            active={otherActive}
            text={otherText}
            onActiveChange={setOtherActive}
            onTextChange={setOtherText}
            onSubmit={() => onRespond({ values: submitValues })}
          />
        )}
      </div>
      <div className="flex gap-2 ml-6">
        <button
          onClick={() => onRespond({ values: submitValues })}
          disabled={otherBlocked}
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          {i18nT("common.submit", undefined, "Submit")}{submitValues.length > 0 ? ` (${submitValues.length})` : ""}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs rounded bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] transition-colors"
        >
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </div>
  );
}
