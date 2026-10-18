/**
 * Small presentational primitives shared by the browser settings groups
 * (change: add-dedicated-agent-browser, design D12 / `mockups/index.html`).
 *
 * Token-only styling: every colour is a theme CSS variable (no raw hex), the
 * same `--severity-*` / `--accent-*` family the mockup and sibling plugins use.
 * Buttons keep a 44px target below 640px (`min-h-[44px] sm:min-h-0`).
 */
import type React from "react";
import { useId } from "react";

export const BTN =
  "px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_PRIMARY =
  "px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs rounded border border-[var(--accent-solid)] bg-[var(--accent-solid)] text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_DANGER =
  "px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs rounded border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
export const INPUT =
  "w-full min-h-[44px] sm:min-h-0 px-2 py-1.5 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] disabled:opacity-60";
export const GROUP = "rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 space-y-4";
export const HELP = "text-xs text-[var(--text-tertiary)]";

type Tone = "ok" | "neutral" | "warn" | "info";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border-[var(--severity-success-border)]",
  neutral: "bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)] border-[var(--severity-neutral-border)]",
  warn: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
  info: "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)] border-[var(--severity-info-border)]",
};

export function Pill({
  tone,
  children,
  testId,
}: {
  tone: Tone;
  children: React.ReactNode;
  testId?: string;
}): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone,
  children,
  testId,
  role = "status",
}: {
  tone: "warn" | "info";
  children: React.ReactNode;
  testId?: string;
  role?: "status" | "alert";
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      role={role}
      className={`rounded-lg border px-3 py-2 text-xs ${TONE_CLASS[tone]}`}
    >
      {children}
    </div>
  );
}

export interface SegOption<V extends string | number> {
  value: V;
  label: string;
  testId: string;
}

/**
 * Segmented single-choice control: a native `radiogroup` (arrow-key navigation
 * for free) whose radios are visually hidden; the label carries the look and a
 * focus ring via `:focus-within`.
 */
export function Seg<V extends string | number>({
  labelledBy,
  value,
  options,
  disabled,
  onChange,
}: {
  labelledBy: string;
  value: V;
  options: readonly SegOption<V>[];
  disabled?: boolean;
  onChange: (value: V) => void;
}): React.ReactElement {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)]"
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <label
            key={String(option.value)}
            className={`flex min-h-[44px] sm:min-h-0 items-center px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-inset focus-within:ring-[color:var(--focus-ring)] ${
              i > 0 ? "border-l border-[var(--border-secondary)]" : ""
            } ${
              selected
                ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]"
            } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              data-testid={option.testId}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
