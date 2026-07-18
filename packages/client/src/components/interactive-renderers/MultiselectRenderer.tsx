import { mdiCheckboxMarkedOutline, mdiCheckCircle } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { AnsweredOption } from "./AnsweredOption.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import type { InteractiveRendererProps } from "./types.js";

export function MultiselectRenderer({ params, status, result, onRespond, onCancel }: InteractiveRendererProps) {
  const title = params.title as string;
  const message = params.message as string | undefined;
  const options = (params.options as string[]) ?? [];
  const selectedValues = (result as any)?.values as string[] | undefined;

  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Derived: are all real options currently checked? Drives the synthetic
  // "Select all" row's checkbox state and its click behavior.
  const allChecked = options.length > 0 && checked.size === options.length;

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
      </div>
      <div className="flex gap-2 ml-6">
        <button
          onClick={() => onRespond({ values: Array.from(checked) })}
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {i18nT("common.submit", undefined, "Submit")}{checked.size > 0 ? ` (${checked.size})` : ""}
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
