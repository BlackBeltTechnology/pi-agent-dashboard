import { mdiCheckCircle, mdiTextBoxEdit } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { InteractiveRendererProps } from "./types.js";

export function EditorRenderer({ params, status, result, onRespond, onCancel }: InteractiveRendererProps) {
  const title = params.title as string;
  const prefill = params.prefill as string | undefined;
  const editedValue = (result as any)?.value as string | undefined;
  const [text, setText] = useState(prefill ?? "");

  if (status !== "pending") {
    const preview = editedValue
      ? editedValue.length > 100 ? editedValue.slice(0, 100) + "…" : editedValue
      : undefined;
    return (
      <div className="mx-4 my-1 p-2 bg-[var(--bg-hover)] rounded text-xs flex items-center gap-2">
        <Icon path={mdiTextBoxEdit} size={0.55} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-[var(--text-secondary)]">{title}</span>
        {status === "resolved" && preview && (
          <span className="ml-1 inline-flex items-center gap-0.5 text-green-400">
            <Icon path={mdiCheckCircle} size={0.55} /> <span className="truncate max-w-[200px]">{preview}</span>
          </span>
        )}
        {status === "cancelled" && (
          <span className="ml-1 text-[var(--text-tertiary)]">{i18nT("status.cancelled", undefined, "Cancelled")}</span>
        )}
        {status === "dismissed" && (
          <span className="ml-1 text-[var(--text-tertiary)]">{i18nT("terminal.answeredInTerminal", undefined, "Answered in terminal")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon path={mdiTextBoxEdit} size={0.6} className="text-blue-400 shrink-0" />
        <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
      </div>
      <div className="ml-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-blue-500 font-mono resize-y"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onRespond({ value: text })}
            className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {i18nT("common.submit", undefined, "Submit")}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs rounded bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] transition-colors"
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
