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
 * Wave 2 adds the read-only / repeated-content members `SettingsStatusPill`,
 * `SettingsItem`, `SettingsFacts` and `SettingsTable`, and moves the group meta
 * to 12 px (interactive-text floor).
 *
 * See change: retro-ux-plugin-settings-forms (design D2),
 * retro-ux-plugin-settings-wave-2 (design D2).
 */
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiContentCopy,
  mdiInformationOutline,
  mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
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
  /** `disabled` options stay listed (put the reason in `label`). */
  options: { value: string; label: string; disabled?: boolean }[];
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
            <option key={o.value} value={o.value} disabled={o.disabled}>
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
  autoComplete,
  ...rest
}: FieldContract & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** e.g. `"off"` / `"new-password"` for write-only secrets. */
  autoComplete?: string;
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
          autoComplete={autoComplete}
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

const SMALL_BTN =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Copies `text` to the clipboard ("Copy details", "Copy command"). The copied
 * text is never rendered: raw codes, HTTP statuses and parser messages live
 * only in the clipboard payload.
 */
export function SettingsCopyButton({
  text,
  label,
  copiedLabel,
  testId,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  testId?: string;
}) {
  const t = useRuntimeT();
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const settle = (next: "copied" | "failed") => {
    setResult(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult("idle"), 1500);
  };
  const copy = () => {
    // A missing clipboard (insecure context) and a rejected or throwing write are
    // the same outcome: say so, never "Copied".
    try {
      const write = navigator.clipboard?.writeText(text);
      if (!write) return settle("failed");
      write.then(
        () => settle("copied"),
        () => settle("failed"),
      );
    } catch {
      settle("failed");
    }
  };
  const resultLabel =
    result === "copied"
      ? (copiedLabel ?? t("settingsField.copied", undefined, "Copied"))
      : result === "failed"
        ? t("settingsField.copyFailed", undefined, "Copy failed")
        : null;
  return (
    <>
      <button type="button" data-testid={testId} className={SMALL_BTN} onClick={copy}>
        <Icon path={result === "copied" ? mdiCheck : mdiContentCopy} size={0.55} aria-hidden="true" />
        {resultLabel ?? label}
      </button>
      {/* A label swap on a focused button is not announced; a standing live region is. */}
      <span role="status" className="sr-only">
        {resultLabel}
      </span>
    </>
  );
}

/** Action row of a notice: "Try again", caller actions, "Copy details". Empty → nothing. */
function NoticeActions({
  testId,
  retryTestId,
  onRetry,
  retryLabel,
  retrying,
  details,
  actions,
}: {
  testId?: string;
  retryTestId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  details?: string | null;
  actions?: ReactNode;
}) {
  const t = useRuntimeT();
  if (!onRetry && !details && !actions) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {onRetry ? (
        <button
          type="button"
          className={SMALL_BTN}
          disabled={retrying}
          data-testid={retryTestId ?? (testId ? `${testId}-retry` : undefined)}
          onClick={onRetry}
        >
          <Icon path={mdiRefresh} size={0.55} aria-hidden="true" />
          {retryLabel ?? t("settingsField.tryAgain", undefined, "Try again")}
        </button>
      ) : null}
      {actions}
      {details ? (
        <SettingsCopyButton
          text={details}
          label={t("settingsField.copyDetails", undefined, "Copy details")}
          testId={testId ? `${testId}-copy-details` : undefined}
        />
      ) : null}
    </div>
  );
}

/** One "what to do" row: `id` becomes `data-remedy` so tests and e2e can tell rows apart. */
export interface SettingsRemedy {
  icon: string;
  content: ReactNode;
  id?: string;
}

/** "What to do" rows of a notice: icon + content, in the caller's order. */
function RemedyList({
  remedies,
  label,
  rowTestId,
}: {
  remedies?: SettingsRemedy[];
  label?: string;
  rowTestId?: string;
}) {
  const t = useRuntimeT();
  if (!remedies || remedies.length === 0) return null;
  return (
    <ul aria-label={label ?? t("settingsField.remediesLabel", undefined, "What you can do")} className="mt-1.5 space-y-1">
      {remedies.map((r, i) => (
        <li key={r.id ?? i} data-testid={rowTestId} data-remedy={r.id} className="flex items-start gap-1.5">
          <Icon path={r.icon} size={0.55} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{r.content}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Severity callout (`ui-contract.md` recipe). `error` announces itself (`role="alert"`),
 * the other tones as `role="status"`; `role` overrides.
 * Optional action row: `onRetry` → "Try again", `details` → "Copy details"
 * (the raw text is only copied, never shown), `actions` → caller buttons.
 */
export function SettingsNotice({
  tone,
  children,
  testId,
  role,
  className,
  onRetry,
  retryLabel,
  retrying,
  details,
  actions,
  remedies,
  remediesLabel,
  remedyTestId,
  retryTestId,
  icon: iconOverride,
}: {
  tone: SettingsNoticeTone;
  children: ReactNode;
  testId?: string;
  role?: "status" | "alert";
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  /** Raw detail (codes, HTTP status, body) copied by "Copy details"; never rendered. */
  details?: string | null;
  actions?: ReactNode;
  /**
   * "What to do" rows under `children`, in the order given (icon + content; `content`
   * may hold links). Callers filter out remedies they do not recognise.
   */
  remedies?: SettingsRemedy[];
  /** Accessible name of the remedy list (default "What you can do"). */
  remediesLabel?: string;
  /** `data-testid` placed on every remedy row. */
  remedyTestId?: string;
  /** Overrides the derived `<testId>-retry` test id of the retry button. */
  retryTestId?: string;
  /** Replaces the tone's default icon (an MDI path) when the icon carries meaning, e.g. a lock. */
  icon?: string;
}) {
  const { cls, icon: toneIcon } = NOTICE_TONE[tone];
  const icon = iconOverride ?? toneIcon;
  return (
    <div
      data-testid={testId}
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : "status")}
      aria-busy={retrying}
      className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${cls} ${className ?? ""}`}
    >
      <Icon path={icon} size={0.65} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {children}
        <RemedyList remedies={remedies} label={remediesLabel} rowTestId={remedyTestId} />
        <NoticeActions
          testId={testId}
          retryTestId={retryTestId}
          onRetry={onRetry}
          retryLabel={retryLabel}
          retrying={retrying}
          details={details}
          actions={actions}
        />
      </div>
    </div>
  );
}

/**
 * Inline error shown AT the control that failed (`ui-contract.md` "inline action
 * error"): one human sentence, optional "Copy details" for the raw code. Point the
 * control's `aria-describedby` at `id` — unique per page, so derive it from the row id.
 * The raw `details` are copied, never rendered.
 */
export function SettingsActionError({
  id,
  children,
  details,
  testId,
}: {
  id: string;
  children: ReactNode;
  details?: string | null;
  testId?: string;
}) {
  const t = useRuntimeT();
  return (
    <div
      id={id}
      data-testid={testId}
      role="alert"
      className="mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]"
    >
      <Icon path={mdiAlertCircleOutline} size={0.55} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {details ? (
        <SettingsCopyButton
          text={details}
          label={t("settingsField.copyDetails", undefined, "Copy details")}
          testId={testId ? `${testId}-copy-details` : undefined}
        />
      ) : null}
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
        <InteractiveTextContext.Provider value={true}>{title}</InteractiveTextContext.Provider>
        {meta ? <span className="ml-auto text-[12px] font-semibold text-[var(--text-secondary)]">{meta}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

// ── Wave 2: read-only and repeated content ───────────────────────────────

/** True inside an interactive summary: pills there step up to the 12 px floor. */
const InteractiveTextContext = createContext(false);

export type SettingsStatusTone = "success" | "info" | "warning" | "error" | "neutral";

const PILL_TONE: Record<SettingsStatusTone, { cls: string; icon: string | null }> = {
  success: {
    cls: "bg-[var(--severity-success-bg)] border-[var(--severity-success-border)] text-[var(--severity-success-fg)]",
    icon: mdiCheckCircleOutline,
  },
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
  neutral: {
    cls: "bg-[var(--severity-neutral-bg)] border-[var(--severity-neutral-border)] text-[var(--severity-neutral-fg)]",
    icon: null,
  },
};

/**
 * Status pill: severity tone + optional decorative icon + a REQUIRED word.
 * Colour is never the only signal (WCAG 1.4.1). 11 px; 12 px when it sits in an
 * interactive element — automatic inside a `SettingsItem` / `SettingsGroup`
 * summary, or forced with `interactive`. `icon` defaults per tone; `null` hides it.
 */
export function SettingsStatusPill({
  tone,
  children,
  icon,
  interactive,
  testId,
  status,
  spinning,
}: {
  tone: SettingsStatusTone;
  children: ReactNode;
  icon?: string | null;
  interactive?: boolean;
  /**
   * Rotate the icon (progress states); static under `prefers-reduced-motion`. No effect
   * without an icon, so pair it with a progress glyph (`mdiLoading`), not a meaning glyph.
   */
  spinning?: boolean;
  testId?: string;
  /** Raw machine status kept for tests/diagnostics as `data-status` (never shown). */
  status?: string;
}) {
  const inInteractive = useContext(InteractiveTextContext);
  const big = interactive ?? inInteractive;
  const { cls, icon: toneIcon } = PILL_TONE[tone];
  const path = icon === undefined ? toneIcon : icon;
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      data-status={status}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px font-semibold ${
        big ? "text-[12px]" : "text-[11px]"
      } ${cls}`}
    >
      {path ? <Icon
          path={path}
          size={0.5}
          className={spinning ? "shrink-0 animate-spin motion-reduce:animate-none" : "shrink-0"}
          aria-hidden="true"
        /> : null}
      {children}
    </span>
  );
}

/**
 * Card for one repeated entity (profile, instance, server, binding).
 * `collapsible` renders `<details>` whose `<summary>` holds the title AND the
 * status area, so a collapsed card still shows its state. Actions never sit
 * inside the summary (a control inside a `role=button` summary is a nested
 * interactive element): collapsible items render them at the top of the body,
 * non-collapsible items in the header row.
 */
export function SettingsItem({
  title,
  subtitle,
  status,
  actions,
  collapsible,
  defaultOpen = true,
  testId,
  summaryTestId,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
  summaryTestId?: string;
  children?: ReactNode;
}) {
  const heading = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-[var(--text-primary)] break-words">{title}</span>
      {subtitle ? <span className="block text-[12px] text-[var(--text-secondary)] break-words">{subtitle}</span> : null}
    </span>
  );
  const statusRow = status ? <span className="flex flex-wrap items-center gap-1">{status}</span> : null;
  const actionRow = actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null;
  const shell = "rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]";
  if (collapsible) {
    return (
      <details data-testid={testId} open={defaultOpen} className={`group ${shell}`}>
        <summary
          data-testid={summaryTestId}
          className="focus-ring flex min-h-[44px] cursor-pointer select-none list-none items-center gap-2 rounded-lg px-3 py-1.5 [&::-webkit-details-marker]:hidden"
        >
          <Icon path={mdiChevronRight} size={0.7} className="shrink-0 transition-transform group-open:rotate-90 text-[var(--text-secondary)]" aria-hidden="true" />
          {heading}
          <InteractiveTextContext.Provider value={true}>{statusRow}</InteractiveTextContext.Provider>
        </summary>
        {actionRow || children ? (
          <div className="space-y-3 px-3 pb-3 pt-1">
            {actionRow}
            {children}
          </div>
        ) : null}
      </details>
    );
  }
  return (
    <div data-testid={testId} className={shell}>
      <div data-testid={summaryTestId} className="flex min-h-[44px] flex-wrap items-center gap-2 px-3 py-1.5">
        {heading}
        {statusRow}
        {actionRow}
      </div>
      {children ? <div className="space-y-3 px-3 pb-3 pt-1">{children}</div> : null}
    </div>
  );
}

/** Read-only term/value list: `<dl>`, terms `--text-secondary`, values `--text-primary`, 12 px. */
export function SettingsFacts({ rows, testId }: { rows: readonly (readonly [ReactNode, ReactNode])[]; testId?: string }) {
  return (
    <dl data-testid={testId} className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
      {rows.map(([term, value], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static read-only rows, order is the identity
        <div key={i} className="contents">
          <dt className="text-[var(--text-secondary)]">{term}</dt>
          <dd className="min-w-0 break-words text-[var(--text-primary)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface SettingsTableRow {
  key: string;
  cells: readonly ReactNode[];
  testId?: string;
}

/**
 * Read-only table: `th scope="col"`, 12 px, scrolls horizontally inside its
 * wrapper instead of widening the page. The caption names the table for
 * assistive tech (visually hidden: the enclosing group already shows a title).
 */
export function SettingsTable({
  columns,
  rows,
  caption,
  testId,
}: {
  columns: readonly ReactNode[];
  rows: readonly SettingsTableRow[];
  caption: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="max-w-full overflow-x-auto rounded-md border border-[var(--border-secondary)]">
      <table className="w-full border-collapse text-left text-[12px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-[var(--bg-tertiary)]">
            {columns.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: column order is the identity
              <th key={i} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold text-[var(--text-secondary)]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid={r.testId} className="border-t border-[var(--border-secondary)]">
              {r.cells.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cell order follows the columns
                <td key={i} className="px-2 py-1.5 align-top text-[var(--text-primary)]">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
