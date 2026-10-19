import type React from "react";
import { useEffect, useRef } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * OtherOption — the inline "Other" answer row shared by SelectRenderer,
 * MultiselectRenderer and the BatchRenderer select/multiselect steps.
 *
 * Controlled. `variant="radio"` is a button row that reveals a text field;
 * `variant="checkbox"` is a checkbox row that reveals one. The typed text is
 * only ever a React text node (never markdown). Escape inside the field
 * collapses it and is consumed (preventDefault + stopPropagation) so an
 * enclosing dialog does not also close; `data-other-input` lets the dialog's
 * own capture handler recognise the field.
 *
 * See change: add-ask-user-inline-other.
 */
export interface OtherOptionProps {
  variant: "radio" | "checkbox";
  active: boolean;
  text: string;
  onActiveChange: (active: boolean) => void;
  onTextChange: (text: string) => void;
  /** Enter with non-empty trimmed text. */
  onSubmit?: () => void;
}

export function OtherOption({ variant, active, text, onActiveChange, onTextChange, onSubmit }: OtherOptionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLElement>(null);
  // Focus moves only when the user themselves activates the row, not when a
  // wizard step remounts with a draft that was already open.
  const focusNext = useRef(false);

  useEffect(() => {
    if (active && focusNext.current) inputRef.current?.focus();
    focusNext.current = false;
  }, [active]);

  const label = i18nT("common.other", undefined, "Other");

  function toggle() {
    focusNext.current = !active;
    onActiveChange(!active);
  }

  const field = active && (
    <input
      ref={inputRef}
      type="text"
      data-other-input=""
      value={text}
      aria-label={i18nT("common.otherAnswer", undefined, "Other answer")}
      placeholder={i18nT("common.otherPlaceholder", undefined, "Type your answer")}
      onChange={(e) => onTextChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onActiveChange(false);
          rowRef.current?.focus();
        } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (text.trim() && onSubmit) onSubmit();
        }
      }}
      className="w-full px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[13px] text-[var(--text-primary)] focus-ring"
    />
  );

  if (variant === "checkbox") {
    return (
      <div className="flex flex-col gap-1" data-testid="other-option">
        <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--bg-surface)] rounded px-2 py-1 transition-colors">
          <input
            ref={rowRef as React.RefObject<HTMLInputElement>}
            type="checkbox"
            checked={active}
            onChange={toggle}
            className="accent-blue-500"
          />
          <span className="text-[var(--text-primary)]">{label}</span>
        </label>
        {field}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="other-option">
      <button
        ref={rowRef as React.RefObject<HTMLButtonElement>}
        type="button"
        aria-expanded={active}
        onClick={toggle}
        className="w-full text-left flex items-start gap-2.5 px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-lg border border-dashed transition-colors focus-ring border-[var(--border-secondary)] bg-transparent text-[var(--text-primary)] hover:border-[var(--tint-blue-border)] hover:bg-[var(--tint-blue-bg)]"
      >
        <span className="block text-[13px] font-medium">{label}</span>
      </button>
      {field}
    </div>
  );
}
