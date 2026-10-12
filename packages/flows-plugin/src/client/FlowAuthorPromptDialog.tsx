import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiPencil } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Intent-capture step for the manage-flows authoring launcher.
 * Mirrors FlowLaunchDialog's two-step pattern: after the user picks "+ New flow"
 * or an existing flow, this dialog asks what the flow should do (new) or what to
 * change (edit) before the skill is launched. The text is forwarded to the
 * `/skill:manage-flows` prompt so the agent starts with stated intent.
 *
 * New mode requires a description (the whole point is to seed intent); edit mode
 * leaves the instruction optional.
 */
export function FlowAuthorPromptDialog({
  mode,
  flowName,
  onSubmit,
  onCancel,
}: {
  mode: "new" | "edit";
  /** Present for edit mode; the flow being changed. */
  flowName?: string;
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
}) {
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isNew = mode === "new";
  const trimmed = instruction.trim();
  const canSubmit = isNew ? trimmed.length > 0 : true;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={isNew ? "New flow" : `Edit flow: ${flowName}`}
      size="md"
      testId="flow-author-prompt-dialog"
    >
      <p className="text-[11px] text-[var(--text-tertiary)]">
        {isNew
          ? "Describe what the flow should do. The agent uses this to author it."
          : "Describe what to change. Leave blank to open the flow without a specific instruction."}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={4}
          placeholder={
            isNew
              ? "e.g. Research an invoice, extract line items, and draft a summary email…"
              : "e.g. Add a review step after extraction…"
          }
          className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-purple-500/50 resize-y"
        />
        <Dialog.Footer>
          <Dialog.Cancel onClick={onCancel} />
          <button
            type="submit"
            disabled={!canSubmit}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              canSubmit
                ? "bg-[var(--accent-primary)] text-white hover:opacity-90"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
            }`}
            data-testid="flow-author-submit"
          >
            <Icon path={mdiPencil} size={0.45} className="inline mr-0.5" />
            {isNew ? "Create" : "Edit"}
          </button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
