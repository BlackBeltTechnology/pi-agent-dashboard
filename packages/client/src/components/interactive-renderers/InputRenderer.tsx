import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiCheckCircle, mdiFormTextbox } from "@mdi/js";
import type { InteractiveRendererProps } from "./types.js";
import { InlineMarkdown } from "./InlineMarkdown.js";
import { MarkdownContent } from "../MarkdownContent.js";

export function InputRenderer({ params, status, result, onRespond, onCancel }: InteractiveRendererProps) {
  const title = params.title as string;
  const message = params.message as string | undefined;
  const placeholder = params.placeholder as string | undefined;
  const enteredValue = (result as any)?.value as string | undefined;
  const [text, setText] = useState("");

  if (status === "cancelled" || status === "dismissed") {
    return (
      <div className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex items-center gap-2">
        <Icon path={mdiFormTextbox} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-[var(--text-secondary)]"><InlineMarkdown content={title} /></span>
        <span className="ml-1 text-[var(--text-tertiary)]">
          {status === "cancelled" ? "Cancelled" : "Answered in terminal"}
        </span>
      </div>
    );
  }

  if (status === "resolved") {
    const isBlank = enteredValue === undefined || enteredValue === "";
    return (
      <div className="mx-4 my-1 p-3 bg-[var(--bg-hover)] rounded-lg text-xs">
        <div className="flex items-center gap-2 mb-2">
          <Icon path={mdiCheckCircle} size={0.55} className="text-green-400 shrink-0" />
          <span className="text-[var(--text-primary)] font-medium"><InlineMarkdown content={title} /></span>
        </div>
        <div
          className={
            isBlank
              ? "ml-6 px-3 py-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] italic whitespace-pre-wrap break-words"
              : "ml-6 px-3 py-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-primary)] whitespace-pre-wrap break-words"
          }
        >
          {isBlank ? "(left blank)" : enteredValue}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon path={mdiFormTextbox} size={0.6} className="text-blue-400 shrink-0" />
        <span className="text-sm font-medium text-[var(--text-primary)]"><InlineMarkdown content={title} /></span>
      </div>
      {message && (
        <div className="text-xs text-[var(--text-secondary)] mb-3 ml-6"><MarkdownContent content={message} /></div>
      )}
      <div className="flex gap-2 ml-6">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onRespond({ value: text }); }}
          placeholder={placeholder}
          className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-blue-500"
        />
        <button
          onClick={() => onRespond({ value: text })}
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
        >
          Submit
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
