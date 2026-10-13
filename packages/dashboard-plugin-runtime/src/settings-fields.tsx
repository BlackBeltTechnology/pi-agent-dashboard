/**
 * Settings field family — the one field contract for core settings pages and
 * plugin settings sections.
 *
 * Every field owes its control an accessible NAME (a `<label htmlFor>` with the
 * unit chip inside) and an accessible DESCRIPTION (`hint`, then `error`, both
 * referenced from `aria-describedby`). `hint` is REQUIRED so that adding a field
 * without deciding about its description is a type error; `hint={null}` is the
 * explicit "nothing useful to add here". An `error` marks the control
 * `aria-invalid` and renders a `role="alert"` line.
 *
 * Presentation only: it carries no save model. Core pages and the context-mode /
 * hermes plugins buffer edits into the host Save bar; Gmail saves immediately.
 * Plugins import this directly (like `SlotPill`), never through the UI primitive
 * registry. Paints only through theme tokens and the 11 / 12 / 14 px type steps.
 *
 * Must not import from `packages/client` or `client-utils` (the runtime sits
 * below both).
 *
 * See change: retro-ux-plugin-settings-forms (design D2).
 */
import { mdiAlertCircleOutline, mdiAlertOutline, mdiCheckCircleOutline, mdiChevronRight, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useId } from "react";
import { useRuntimeT } from "./plugin-context.js";

/** `default` = value comes from the built-in default; `changed` = overridden. */
export type SettingsFieldState = "default" | "changed";

export interface SettingsFieldTestIds {
  control?: string;
  state?: string;
  reset?: string;
  error?: string;
}

export type FieldContract = {
  /** Accessible description. Required: pass `null` to state there is none. */
  hint: ReactNode;
  /** Short unit rendered as a chip inside the label (e.g. "ms", "s"). */
  unit?: string;
  /** Validation message: renders below the hint, links the control, sets `aria-invalid`. */
  error?: string | null;
  /** Monospace setting key shown beside the label (e.g. `search.windowMs`). */
  keyLabel?: string;
  /** Pill in the label row ("Default" / "Changed"). */
  state?: SettingsFieldState;
  /** Overrides the pill text (callers with a scoped translator pass their own). */
  stateLabel?: string;
  /** Renders a reset control in the label row. */
  onReset?: () => void;
  resetLabel?: string;
  /** Caller `data-testid`s so existing tests keep resolving. */
  testIds?: SettingsFieldTestIds;
  /** Extra `data-*` attributes for the error element (e.g. the wizard step that fixes it). */
  errorAttrs?: Record<`data-${string}`, string>;
  disabled?: boolean;
};

/** True when a hint should render and be referenced by aria-describedby. */
function hasHint(hint: ReactNode): boolean {
  return hint !== null && hint !== undefined;
}

function hasError(error: string | null | undefined): error is string {
  return typeof error === "string" && error !== "";
}

/** Space-separated ids for `aria-describedby`; `undefined` when there is none. */
function describedBy(hint: ReactNode, hintId: string, error: string | null | undefined, errorId: string): string | undefined {
  const ids = [hasHint(hint) ? hintId : null, hasError(error) ? errorId : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

const CONTROL_BASE =
  "focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-sm text-[var(--text-primary)] " +
  "disabled:cursor-not-allowed aria-[invalid=true]:border-[var(--severity-error-border)]";

/** What `FieldShell` hands a custom control. */
export interface FieldControlProps {
  id: string;
  /** `aria-describedby` value (hint id, then error id), or `undefined`. */
  describedBy: string | undefined;
  invalid: boolean;
}

export function FieldShell({
  label,
  unit,
  hint,
  error,
  keyLabel,
  state,
  stateLabel,
  onReset,
  resetLabel,
  testIds,
  errorAttrs,
  disabled,
  stacked,
  control,
}: FieldContract & {
  label: string;
  /** Label above the control (text inputs) instead of beside it. */
  stacked?: boolean;
  /** Render prop for the control: wiring is handed in, so it cannot be forgotten. */
  control: (p: FieldControlProps) => ReactNode;
}) {
  const t = useRuntimeT();
  const controlId = useId();
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const invalid = hasError(error);
  const pillText =
    stateLabel ??
    (state === "changed" ? t("settingsField.changed", undefined, "Changed") : t("settingsField.default", undefined, "Default"));
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className={stacked ? "" : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1"}>
        {/* A <span>, not a <div>: `label.closest("div")` is the row that also holds the control. */}
        <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 ${stacked ? "mb-1" : ""}`}>
          <label htmlFor={controlId} className="text-xs font-semibold text-[var(--text-primary)]">
            {label}
            {unit ? (
              <span className="ml-1.5 px-1.5 py-px rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[12px] font-semibold align-middle text-[var(--text-secondary)]">
                {unit}
              </span>
            ) : null}
          </label>
          {keyLabel ? <code className="font-mono text-[11px] text-[var(--text-secondary)]">{keyLabel}</code> : null}
          {state ? (
            <span
              data-testid={testIds?.state}
              className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-semibold ${
                state === "changed"
                  ? "bg-[var(--severity-info-bg)] border-[var(--severity-info-border)] text-[var(--severity-info-fg)]"
                  : "bg-[var(--severity-neutral-bg)] border-[var(--severity-neutral-border)] text-[var(--severity-neutral-fg)]"
              }`}
            >
              {pillText}
            </span>
          ) : null}
          {onReset ? (
            <button
              type="button"
              data-testid={testIds?.reset}
              onClick={onReset}
              className="focus-ring rounded text-[12px] font-semibold text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
            >
              {resetLabel ?? t("settingsField.reset", undefined, "Reset to default")}
            </button>
          ) : null}
        </span>
        {control({ id: controlId, describedBy: describedBy(hint, hintId, error, errorId), invalid })}
      </div>
      {hasHint(hint) ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--text-secondary)]">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p
          id={errorId}
          role="alert"
          data-testid={testIds?.error}
          {...errorAttrs}
          className="mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]"
        >
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  decimal,
  allowEmpty,
  step,
  ...rest
}: FieldContract & {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Accept fractions (default: whole numbers, `parseInt`). */
  decimal?: boolean;
  /** Emit `NaN` for an empty input instead of `0`, and show `NaN` as empty. */
  allowEmpty?: boolean;
  step?: number | "any";
}) {
  return (
    <FieldShell
      label={label}
      {...rest}
      control={({ id, describedBy: dby, invalid }) => (
        <input
          id={id}
          data-testid={rest.testIds?.control}
          aria-describedby={dby}
          aria-invalid={invalid || undefined}
          type="number"
          step={step}
          disabled={rest.disabled}
          className={`${CONTROL_BASE} w-24 text-right`}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(allowEmpty ? Number.NaN : 0);
            onChange(decimal ? Number(raw) : Number.parseInt(raw, 10) || 0);
          }}
        />
      )}
    />
  );
}

export function ToggleField({
  label,
  value,
  onChange,
  onLabel,
  offLabel,
  ...rest
}: FieldContract & {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  /** Optional state word beside the switch (callers pass translated text). */
  onLabel?: string;
  offLabel?: string;
}) {
  const word = value ? onLabel : offLabel;
  return (
    <FieldShell
      label={label}
      {...rest}
      control={({ id, describedBy: dby, invalid }) => (
        <span className="inline-flex items-center gap-2">
          {word ? <span className="text-[12px] text-[var(--text-secondary)]">{word}</span> : null}
          {/* role="switch" + aria-checked expose the ON/OFF STATE; type="button"
              keeps it from submitting an enclosing form. */}
          <button
            id={id}
            data-testid={rest.testIds?.control}
            type="button"
            role="switch"
            aria-checked={value}
            aria-describedby={dby}
            aria-invalid={invalid || undefined}
            disabled={rest.disabled}
            onClick={() => onChange(!value)}
            className={`focus-ring relative h-[22px] w-10 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed ${
              value ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)] bg-[var(--bg-tertiary)]"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform ${
                value ? "translate-x-[18px] bg-white" : "translate-x-0 bg-[var(--text-secondary)]"
              }`}
            />
          </button>
        </span>
      )}
    />
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  ...rest
}: FieldContract & {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell
      label={label}
      {...rest}
      control={({ id, describedBy: dby, invalid }) => (
        <select
          id={id}
          data-testid={rest.testIds?.control}
          aria-describedby={dby}
          aria-invalid={invalid || undefined}
          disabled={rest.disabled}
          className={CONTROL_BASE}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    />
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
  ...rest
}: FieldContract & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** Monospace value (ids, paths, keys). Stays on the 12 px step. */
  mono?: boolean;
}) {
  return (
    <FieldShell
      label={label}
      stacked
      {...rest}
      control={({ id, describedBy: dby, invalid }) => (
        <input
          id={id}
          data-testid={rest.testIds?.control}
          aria-describedby={dby}
          aria-invalid={invalid || undefined}
          type={type}
          disabled={rest.disabled}
          className={`${CONTROL_BASE} w-full ${mono ? "font-mono text-[12px]" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    />
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  mono,
  ...rest
}: FieldContract & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <FieldShell
      label={label}
      stacked
      {...rest}
      control={({ id, describedBy: dby, invalid }) => (
        <textarea
          id={id}
          data-testid={rest.testIds?.control}
          aria-describedby={dby}
          aria-invalid={invalid || undefined}
          rows={rows}
          disabled={rest.disabled}
          className={`${CONTROL_BASE} w-full resize-y ${mono ? "font-mono text-[12px]" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    />
  );
}

export type SettingsNoticeTone = "info" | "warning" | "error" | "success";

const NOTICE_TONE: Record<SettingsNoticeTone, { cls: string; icon: string }> = {
  info: {
    cls: "bg-[var(--severity-info-bg)] border-[var(--severity-info-border)] text-[var(--severity-info-fg)]",
    icon: mdiInformationOutline,
  },
  warning: {
    cls: "bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]",
    icon: mdiAlertOutline,
  },
  error: {
    cls: "bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]",
    icon: mdiAlertCircleOutline,
  },
  success: {
    cls: "bg-[var(--severity-success-bg)] border-[var(--severity-success-border)] text-[var(--severity-success-fg)]",
    icon: mdiCheckCircleOutline,
  },
};

/** Severity callout (`ui-contract.md` recipe). `error` announces itself (`role="alert"`). */
export function SettingsNotice({
  tone,
  children,
  testId,
  role,
  className,
}: {
  tone: SettingsNoticeTone;
  children: ReactNode;
  testId?: string;
  role?: "status" | "alert";
  className?: string;
}) {
  const { cls, icon } = NOTICE_TONE[tone];
  return (
    <div
      data-testid={testId}
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : undefined)}
      className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${cls} ${className ?? ""}`}
    >
      <Icon path={icon} size={0.65} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Collapsible group: 14 px semibold summary, ≥ 44 px tall, visible focus ring. */
export function SettingsGroup({
  title,
  meta,
  defaultOpen = true,
  testId,
  summaryTestId,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  summaryTestId?: string;
  children: ReactNode;
}) {
  return (
    <details
      data-testid={testId}
      open={defaultOpen}
      className="group mb-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
    >
      <summary
        data-testid={summaryTestId}
        className="focus-ring flex min-h-[44px] cursor-pointer select-none list-none items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[var(--text-primary)] [&::-webkit-details-marker]:hidden"
      >
        <Icon path={mdiChevronRight} size={0.7} className="transition-transform group-open:rotate-90" aria-hidden="true" />
        {title}
        {meta ? <span className="ml-auto text-[11px] font-semibold text-[var(--text-secondary)]">{meta}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
