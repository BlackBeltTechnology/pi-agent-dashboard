/**
 * Shared bits for the Vault settings page and the session chip: control recipes, the status
 * pill, the callout, the inline two-step confirm with a freshly read impact, and field errors.
 * Theme tokens only (severity pills / callouts per ui-contract); text inside controls is at
 * least 12 px; touch targets are 32 / 36 px (44 px below `sm` for buttons).
 * See change: add-credential-vault; retro-ux-credential-vault (D6, D8, D9).
 */
import { mdiAlertCircleOutline, mdiAlertOutline, mdiCheckCircleOutline, mdiInformationOutline, mdiProgressClock } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";

export type Tone = "success" | "info" | "warning" | "error" | "neutral";

const TONE_PILL: Record<Tone, string> = {
  success: "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border-[var(--severity-success-border)]",
  info: "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)] border-[var(--severity-info-border)]",
  warning: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
  error: "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border-[var(--severity-error-border)]",
  neutral: "bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)] border-[var(--severity-neutral-border)]",
};

// ── control recipes ───────────────────────────────────────────────────────
export const INPUT_CLASS =
  "focus-ring w-full min-w-0 min-h-[36px] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1 text-sm text-[var(--text-primary)] aria-[invalid=true]:border-[var(--severity-error-border)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed";
const BUTTON_BASE =
  "focus-ring inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 min-h-[32px] max-sm:min-h-[44px] text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed";
export const BUTTON_CLASS = `${BUTTON_BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-secondary)] disabled:hover:bg-[var(--bg-tertiary)]`;
export const PRIMARY_BUTTON_CLASS = `${BUTTON_BASE} bg-[var(--accent-solid)] text-white hover:brightness-110 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:hover:brightness-100`;
export const GHOST_BUTTON_CLASS = `${BUTTON_BASE} text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-60 disabled:hover:bg-transparent`;
const DANGER_BUTTON_CLASS = `${BUTTON_BASE} border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] disabled:opacity-60`;
export const LABEL_CLASS = "block text-xs font-semibold text-[var(--text-primary)] mb-1";
export const HELP_CLASS = "text-xs text-[var(--text-secondary)]";
export const SECTION_TITLE_CLASS = "flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]";
export const INSET_CLASS = "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3";
export const ROW_CLASS = "flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2";
const SWITCH_CLASS =
  "focus-ring relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--border-strong)] bg-[var(--bg-secondary)] transition-colors checked:border-[var(--accent-solid)] checked:bg-[var(--accent-solid)] disabled:cursor-not-allowed disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-[var(--text-secondary)] after:transition-transform after:content-[''] checked:after:translate-x-4 checked:after:bg-white motion-reduce:transition-none motion-reduce:after:transition-none";

/** The hub's own device id reads as "this dashboard"; any other device shows its id. */
export const deviceName = (deviceId: string): string => (deviceId === "hub" ? i18nT("vault.thisDashboard", undefined, "this dashboard (hub)") : deviceId);

export function VIcon({ path, size = 0.65, className = "" }: { path: string; size?: number; className?: string }) {
  return <Icon path={path} size={size} className={`shrink-0 ${className}`} aria-hidden="true" />;
}

/** Runs one write; reports its failure through `onError`, and reloads the overview on success. */
export async function runOp(
  op: () => Promise<{ ok: boolean; error?: string; status: number }>,
  onError: (message: string | null) => void,
  onChanged: () => void | Promise<void>,
): Promise<boolean> {
  onError(null);
  const res = await op();
  if (!res.ok) {
    onError(res.error ?? `HTTP ${res.status}`);
    return false;
  }
  await onChanged();
  return true;
}

// ── status pills (design D9) ──────────────────────────────────────────────
export function StatusPill({ tone, icon, label, testId, labelTestId }: { tone: Tone; icon?: string; label: string; testId?: string; labelTestId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_PILL[tone]}`}
    >
      {icon && <VIcon path={icon} size={0.55} />}
      <span data-testid={labelTestId}>{label}</span>
    </span>
  );
}

/** Settings-page status of one project row. */
export type GrantStatus = "delivering" | "pending" | "no-default" | "no-account";

export function GrantStatusPill({ status }: { status: GrantStatus }) {
  switch (status) {
    case "delivering":
      return <StatusPill tone="success" icon={mdiCheckCircleOutline} label={i18nT("vault.status.delivering", undefined, "Delivering")} />;
    case "pending":
      return <StatusPill tone="warning" icon={mdiProgressClock} label={i18nT("vault.status.pending", undefined, "Waiting for a checkout confirmation")} />;
    case "no-default":
      return <StatusPill tone="warning" icon={mdiAlertOutline} label={i18nT("vault.status.noDefault", undefined, "Delivers nothing until the variable has a default")} />;
    case "no-account":
      return (
        <StatusPill tone="error" icon={mdiAlertCircleOutline} label={i18nT("vault.noAccountState", undefined, "No account: delivers nothing")} testId="vault-grant-no-account" />
      );
  }
}

const STATE_LABEL_EN: Record<string, string> = {
  delivered: "Delivered",
  "local-override": "Local value kept",
  inherited: "Inherited from parent pi",
  "pending-confirmation": "Waiting for confirmation",
  "no-account": "No account",
  "blocked-name": "Name not allowed",
  revoked: "Revoked",
  "hub-unreachable": "Hub unreachable",
  "vault-unavailable": "Vault unavailable",
};

const STATE_HELP_EN: Record<string, string> = {
  delivered: "Set in this session's environment.",
  "local-override": "The session already had this variable, so the vault left it alone.",
  inherited: "Delivered to the parent session; this one only passes it on.",
  "pending-confirmation": "Confirm the checkout above to receive it.",
  "no-account": "The variable or this project's account has no key. Fix it in Settings → Vault.",
  "blocked-name": "This name is reserved by the system and is never delivered.",
  revoked: "Processes already running may still hold the old value.",
  "hub-unreachable": "The dashboard can't reach this session right now. It keeps the keys it has for a limited time.",
  "vault-unavailable": "The vault file can't be read, so nothing changes until it is repaired.",
};

const STATE_PILL: Record<string, { tone: Tone; icon: string }> = {
  delivered: { tone: "success", icon: mdiCheckCircleOutline },
  "pending-confirmation": { tone: "warning", icon: mdiProgressClock },
  revoked: { tone: "warning", icon: mdiAlertOutline },
  "hub-unreachable": { tone: "warning", icon: mdiAlertOutline },
  "vault-unavailable": { tone: "warning", icon: mdiAlertOutline },
  "no-account": { tone: "error", icon: mdiAlertCircleOutline },
  "blocked-name": { tone: "error", icon: mdiAlertCircleOutline },
};

const stateLabel = (state: string): string => i18nT(`vault.state.${state}`, undefined, STATE_LABEL_EN[state] ?? state);
/** One line saying what a state means; a state this build does not know explains itself with its label. */
export const stateHelp = (state: string): string => i18nT(`vault.stateHelp.${state}`, undefined, STATE_HELP_EN[state] ?? stateLabel(state));

/** Session-chip state pill. The icon sits outside `vault-binding-state`, which keeps exactly the label. */
export function BindingStatePill({ state }: { state: string }) {
  const { tone, icon } = STATE_PILL[state] ?? { tone: "neutral" as const, icon: mdiInformationOutline };
  return <StatusPill tone={tone} icon={icon} label={stateLabel(state)} labelTestId="vault-binding-state" />;
}

/** "Used by N projects that don't pick their own account" — the reach of a variable's default account. */
export function usedByLine(count: number): string {
  if (count === 0) return i18nT("vault.defaultImpactNone", undefined, "No project uses this default yet.");
  if (count === 1) return i18nT("vault.defaultImpactOne", undefined, "Used by 1 project that doesn't pick its own account.");
  return i18nT("vault.defaultImpactMany", { count }, "Used by {count} projects that don't pick their own account.");
}

// ── callout + field error ─────────────────────────────────────────────────
export function Callout({
  tone,
  icon,
  role,
  testId,
  children,
}: {
  tone: "info" | "warning" | "error";
  icon: string;
  role?: "alert" | "status";
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} role={role} className={`flex items-start gap-2 rounded-md border p-3 text-xs ${TONE_PILL[tone]}`}>
      <VIcon path={icon} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ErrorLine({ error, testId }: { error: string | null; testId: string }) {
  if (!error) return null;
  return (
    <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId={testId}>
      {error}
    </Callout>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]">
      <VIcon path={mdiAlertCircleOutline} className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

/** Plugin approval: an `<input type="checkbox" role="switch">` styled as a switch (its `checked` state is the contract). */
export function ApprovalSwitch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        data-testid="vault-plugin-approve"
        className={SWITCH_CLASS}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {checked ? i18nT("vault.approved", undefined, "Approved") : i18nT("vault.notApproved", undefined, "Not approved")}
    </label>
  );
}

// ── two-step destructive action with a freshly read impact (design D6) ─────
export type ImpactResult = { ok: true; items: string[] } | { ok: false; error: string };

type ImpactState = { phase: "loading" } | { phase: "ready"; items: string[] } | { phase: "error"; error: string };

/**
 * Inline `role="alertdialog"`. It reads the impact when it opens (`loadImpact`, from a re-fetched
 * overview), lists it, and only then enables the danger button. A failed read shows the error with
 * Retry and leaves the danger button disabled. Cancel takes focus; Esc or Cancel returns focus to
 * the trigger. The list is a best-effort preview: the server stays the source of truth.
 */
export function ConfirmImpact({
  title,
  confirmLabel,
  loadImpact,
  onConfirm,
  onCancel,
  returnFocusTo,
}: {
  title: string;
  confirmLabel: string;
  loadImpact: () => Promise<ImpactResult>;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const loadRef = useRef(loadImpact);
  loadRef.current = loadImpact;
  const [state, setState] = useState<ImpactState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const r = await loadRef.current();
      setState(r.ok ? { phase: "ready", items: r.items } : { phase: "error", error: r.error });
    } catch (err) {
      setState({ phase: "error", error: String((err as Error)?.message ?? err) });
    }
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
    void load();
  }, [load]);

  const cancel = () => {
    onCancel();
    returnFocusTo?.current?.focus();
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-labelledby={headingId}
      aria-busy={state.phase === "loading"}
      data-testid="vault-confirm-impact"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
      className={`flex items-start gap-2 rounded-md border p-3 text-xs ${TONE_PILL.warning}`}
    >
      <VIcon path={mdiAlertOutline} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <strong id={headingId} className="block text-sm font-semibold">
          {title}
        </strong>
        {state.phase === "loading" && <p className="mt-1">{i18nT("vault.impact.loading", undefined, "Reading the current state…")}</p>}
        {state.phase === "error" && (
          <p role="alert" className="mt-1">
            {state.error}
          </p>
        )}
        {state.phase === "ready" && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {state.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={DANGER_BUTTON_CLASS} disabled={state.phase !== "ready" || busy} onClick={() => void confirm()}>
            {confirmLabel}
          </button>
          {state.phase === "error" && (
            <button type="button" className={BUTTON_CLASS} onClick={() => void load()}>
              {i18nT("vault.retry", undefined, "Retry")}
            </button>
          )}
          <button type="button" ref={cancelRef} className={BUTTON_CLASS} onClick={cancel}>
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
