/**
 * The generic OAuth sign-in flow body: auth-URL link, device code with
 * countdown, `manual_code` / `text` paste field, `select` options, and Cancel.
 * Driven by an `OAuthFlowStatus` snapshot; no provider-specific logic and no
 * dialog chrome. Renders while `flow.phase` is `starting` / `waiting`; the host
 * owns polling and the terminal outcome.
 *
 * Used directly by the provider dialog's `SignInPane`, and registered as the
 * `ui:oauth-flow` UI primitive for plugin settings sections.
 * See change: expose-plugin-credential-and-oauth-seams (D6); extracted from
 * ProviderAddDialog.tsx (redesign-providers-settings-page).
 */

import type { UiOAuthFlowViewProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiContentCopy, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** mm:ss rendering of a remaining duration. */
function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Remaining life of the current device code, ticking every second.
 *
 * Anchored ONCE per flow (`expiresInSeconds` is the code's TOTAL life, echoed
 * unchanged by every poll), so re-reads do not reset the clock to full — which
 * is what a per-render `formatCountdown(expiresInSeconds)` did.
 */
function useDeviceCodeRemaining(totalSeconds: number | undefined, flowId: string | undefined): number | undefined {
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (typeof totalSeconds !== "number" || totalSeconds <= 0 || !flowId) {
      setRemaining(undefined);
      return;
    }
    const deadline = Date.now() + totalSeconds * 1000;
    setRemaining(totalSeconds);
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
    // `flowId` restarts the clock for a NEW flow; `totalSeconds` only ever
    // appears once per flow, so it cannot re-anchor the same one.
  }, [totalSeconds, flowId]);
  return remaining;
}

export function OAuthFlowView({ flow, onSendInput, onCancel }: UiOAuthFlowViewProps) {
  // The paste field's value is local-only: cleared after submit and never
  // repopulated from a later status read (pending.message is the LABEL).
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const status = flow.status;
  const pending = status?.pending;
  const flowId = status?.flowId;
  const waiting = flow.phase === "starting" || flow.phase === "waiting";
  /** Identity of the step on screen: a change means the answer was consumed. */
  const promptKey =
    pending === undefined
      ? "none"
      : `${flowId}|${pending.kind}|${pending.kind === "device_code" ? pending.userCode : pending.message}`;
  // Un-latch the answer guard when the step advances (or the flow ends).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `promptKey` is the deliberate trigger — the body reads nothing from it.
  useEffect(() => {
    setSubmitting(false);
  }, [promptKey]);
  const deviceRemaining = useDeviceCodeRemaining(
    pending?.kind === "device_code" ? pending.expiresInSeconds : undefined,
    flowId,
  );

  /**
   * A `select` answer, guarded like the text field: a double-click must not
   * answer the NEXT prompt with the previous option's id.
   */
  /**
   * One answer per prompt STEP. A successful POST deliberately leaves the guard
   * LATCHED: the next poll has not necessarily replaced the step yet, and
   * re-enabling here would let a second click answer the FOLLOWING prompt with
   * the previous answer. The latch clears when the step itself changes
   * (`promptKey`) or when the POST is refused (nothing was answered, so
   * retrying is correct).
   */
  const chooseOption = async (optionId: string) => {
    if (!flowId || submitting) return;
    setSubmitting(true);
    try {
      await onSendInput(flowId, optionId);
    } catch {
      // Silent — the poll renders the flow's real state within one tick.
      setSubmitting(false);
    }
  };

  const submitInput = async () => {
    const value = inputValue.trim();
    if (!flowId || !value || submitting) return;
    setSubmitting(true);
    try {
      await onSendInput(flowId, value);
      // Cleared after submit; a later status read never repopulates it.
      setInputValue("");
    } catch {
      setSubmitting(false);
    }
  };

  if (!waiting) return null;

  return (
    <div className="space-y-2" data-testid="dialog-flow-waiting">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Icon path={mdiLoading} size={0.5} className="animate-spin" />
        {i18nT("status.waitingForAuthorization", undefined, "Waiting for authorization…")}
      </div>
      {/* The link renders in EVERY pending state whenever the server has
          an authUrl — pop-up blockers and remote browsers need it. */}
      {status?.authUrl && (
        <div className="text-[11px] text-[var(--text-muted)] break-all">
          {i18nT("providers.authUrlFallback", undefined, "If the browser did not open, use this link:")}{" "}
          <a href={status.authUrl} target="_blank" rel="noopener" className="underline break-all">{status.authUrl}</a>
        </div>
      )}
      {pending?.kind === "device_code" && (
        <div>
          <div className="text-xs text-[var(--text-secondary)]">{i18nT("common.enterThisCodeAt", undefined, "Enter this code at:")}</div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-lg font-bold text-[var(--text-primary)] tracking-wider">{pending.userCode}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(pending.userCode)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              title={i18nT("common.copyCode", undefined, "Copy code")}>
              <Icon path={mdiContentCopy} size={0.5} />
            </button>
          </div>
          <a href={pending.verificationUri} target="_blank" rel="noopener" className="block mt-1 text-xs underline break-all">{pending.verificationUri}</a>
          {/* The user must click — the verification URL is never opened automatically. */}
          <button type="button" onClick={() => window.open(pending.verificationUri, "_blank")}
            className="mt-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
            {i18nT("common.openRegistrationPage", undefined, "Open Registration Page")}
          </button>
          {typeof deviceRemaining === "number" && (
            <div className="mt-1 text-[11px] text-[var(--text-muted)]" aria-live="polite">
              {i18nT("providers.deviceCodeExpiresIn", { time: formatCountdown(deviceRemaining) }, `Code expires in ${formatCountdown(deviceRemaining)}`)}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--text-muted)]">
            <Icon path={mdiLoading} size={0.45} className="animate-spin" />
            {i18nT("providers.deviceWaiting", undefined, "Waiting for authorization… you can close this dialog — the sign-in will finish in the background.")}
          </div>
        </div>
      )}
      {(pending?.kind === "manual_code" || pending?.kind === "text") && (
        <div>
          <label htmlFor="provider-flow-input" className="block text-xs text-[var(--text-secondary)] mb-1">
            {pending.message || i18nT("providers.flowInputLabel", undefined, "Paste the code or link")}
          </label>
          <input
            id="provider-flow-input"
            type="text"
            data-testid="dialog-input-field"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitInput(); }}
            placeholder={pending.placeholder}
            disabled={submitting}
            autoComplete="off"
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] font-mono disabled:opacity-50"
          />
          <button type="button" data-testid="dialog-input-submit" onClick={() => void submitInput()} disabled={submitting}
            className="mt-2 px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
            {i18nT("providers.flowInputSubmit", undefined, "Submit")}
          </button>
        </div>
      )}
      {pending?.kind === "select" && (
        <div>
          <div className="text-xs text-[var(--text-secondary)]">{pending.message || i18nT("providers.flowSelectPrompt", undefined, "Choose an option")}</div>
          <div className="flex flex-col gap-1.5 mt-2">
            {pending.options.map((o) => (
              <button key={o.id} type="button" data-testid={`dialog-option-${o.id}`} onClick={() => void chooseOption(o.id)} disabled={submitting}
                className="px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)] text-left disabled:opacity-50">
                <span className="block">{o.label}</span>
                {o.description && <span className="block text-[11px] text-[var(--text-muted)]">{o.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Cancel is first-class in every pending state. */}
      {flowId && (
        <button type="button" data-testid="dialog-cancel" onClick={() => onCancel(flowId)}
          className="px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      )}
    </div>
  );
}
