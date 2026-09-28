import { mdiShieldAlert } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { AnsweredOption } from "./AnsweredOption.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import type { InteractiveRendererProps } from "./types.js";

export function ConfirmRenderer({ params, status, result, onRespond, onCancel }: InteractiveRendererProps) {
  const title = params.title as string;
  const message = params.message as string | undefined;
  const confirmed = (result as any)?.confirmed;

  if (status === "cancelled" || status === "dismissed") {
    return (
      <div className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex items-center gap-2">
        <Icon path={mdiShieldAlert} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-[var(--text-secondary)]"><InlineMarkdown content={title} /></span>
        <span className="ml-1 text-[var(--text-tertiary)]">
          {status === "cancelled" ? "Cancelled" : "Answered in terminal"}
        </span>
      </div>
    );
  }

  if (status === "resolved") {
    return (
      <div className="mx-4 my-1 p-3 bg-[var(--bg-hover)] rounded-lg text-xs">
        <div className="flex items-center gap-2 mb-2">
          <Icon path={mdiShieldAlert} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
          <span className="text-[var(--text-primary)] font-medium"><InlineMarkdown content={title} /></span>
        </div>
        {message && (
          <div className="text-xs text-[var(--text-secondary)] mb-2 ml-6"><MarkdownContent content={message} /></div>
        )}
        <div className="flex gap-2 ml-6">
          <AnsweredOption title={i18nT("common.yes", undefined, "Yes")} picked={!!confirmed} />
          <AnsweredOption title={i18nT("common.no", undefined, "No")} picked={!confirmed} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg">
      <div className="flex items-center gap-2 mb-1">
        <Icon path={mdiShieldAlert} size={0.6} className="text-[var(--severity-warning-fg)] shrink-0" />
        <span className="text-sm font-medium text-[var(--text-primary)]"><InlineMarkdown content={title} /></span>
      </div>
      {message && (
        <div className="text-xs text-[var(--text-secondary)] mb-3 ml-6"><MarkdownContent content={message} /></div>
      )}
      <div className="flex flex-wrap gap-2 ml-6">
        <button
          type="button"
          onClick={() => onRespond({ confirmed: true })}
          className="focus-ring inline-flex items-center justify-center px-3 min-w-[44px] min-h-[44px] sm:min-h-[36px] text-[13px] font-semibold rounded-md transition-colors bg-[var(--accent-solid)] text-white hover:brightness-110"
        >
          {i18nT("common.yes", undefined, "Yes")}
        </button>
        <button
          type="button"
          onClick={() => onRespond({ confirmed: false })}
          className="focus-ring inline-flex items-center justify-center px-3 min-w-[44px] min-h-[44px] sm:min-h-[36px] text-[13px] font-semibold rounded-md transition-colors border tint-action-red"
        >
          {i18nT("common.no", undefined, "No")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring inline-flex items-center justify-center px-3 min-w-[44px] min-h-[44px] sm:min-h-[36px] text-[13px] font-semibold rounded-md transition-colors border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
        >
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </div>
  );
}
