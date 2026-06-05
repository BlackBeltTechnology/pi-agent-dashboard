import React from "react";
import { Icon } from "@mdi/react";
import { mdiShieldAlert } from "@mdi/js";
import type { InteractiveRendererProps } from "./types.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { AnsweredOption } from "./AnsweredOption.js";

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
        <div className="flex gap-2 ml-6">
          <AnsweredOption title="Yes" picked={!!confirmed} />
          <AnsweredOption title="No" picked={!confirmed} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg">
      <div className="flex items-center gap-2 mb-1">
        <Icon path={mdiShieldAlert} size={0.6} className="text-yellow-400 shrink-0" />
        <span className="text-sm font-medium text-[var(--text-primary)]"><InlineMarkdown content={title} /></span>
      </div>
      {message && (
        <div className="text-xs text-[var(--text-secondary)] mb-3 ml-6"><MarkdownContent content={message} /></div>
      )}
      <div className="flex gap-2 ml-6">
        <button
          onClick={() => onRespond({ confirmed: true })}
          className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
        >
          Yes
        </button>
        <button
          onClick={() => onRespond({ confirmed: false })}
          className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
        >
          No
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs rounded bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
