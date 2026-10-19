/**
 * Small presentational primitives shared by the browser settings groups
 * (change: add-dedicated-agent-browser, design D12; retro-ux-plugin-settings-wave-2).
 *
 * Token-only styling: every colour is a theme CSS variable (no raw hex). Status
 * pills, notices, switches and selects come from the runtime settings kit
 * (`SettingsStatusPill`, `SettingsNotice`, `ToggleField`, `SelectField`); this
 * file keeps only the button/link class recipes, `HELP`, the segmented `Seg`
 * and `BlurTextField` (the kit's `TextField` has no blur hook or trailing action).
 * Buttons keep a 44px target below 640px (`min-h-[44px] sm:min-h-[36px]`).
 */
import { type FieldContract, FieldShell } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useId } from "react";

const BTN_BASE =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md px-3 min-h-[44px] sm:min-h-[36px] text-xs font-semibold disabled:cursor-not-allowed";
/** Secondary button (contract recipe). */
export const BTN = `${BTN_BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60`;
export const BTN_PRIMARY = `${BTN_BASE} bg-[var(--accent-solid)] text-white hover:brightness-110 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`;
/** Danger button: `--severity-error-*` tokens. */
export const BTN_DANGER = `${BTN_BASE} border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] hover:brightness-110 disabled:opacity-60`;
/** Link recipe (`--link`). */
export const LINK =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded text-xs font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline";
/** Section card used by the Agent browsing group and the dedicated-profile panel. */
export const GROUP = "rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 space-y-4";
export const HELP = "text-xs text-[var(--text-secondary)]";

const CONTROL =
  "focus-ring min-w-0 flex-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-sm text-[var(--text-primary)] " +
  "disabled:cursor-not-allowed aria-[invalid=true]:border-[var(--severity-error-border)]";

/**
 * Stacked text field on the kit's `FieldShell` with what `TextField` lacks:
 * `onBlur` (write-on-blur editors) and a trailing `action` (the token "Save"
 * button). Optional `testId` lands on the `<input>`.
 */
export function BlurTextField({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  testId,
  action,
  ...contract
}: FieldContract & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  type?: "text" | "password";
  placeholder?: string;
  testId?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <FieldShell
      label={label}
      stacked
      {...contract}
      control={({ id, describedBy, invalid }) => (
        <span className="flex items-center gap-2">
          <input
            id={id}
            data-testid={testId}
            type={type}
            autoComplete={type === "password" ? "off" : undefined}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            disabled={contract.disabled}
            className={CONTROL}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
          {action}
        </span>
      )}
    />
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
