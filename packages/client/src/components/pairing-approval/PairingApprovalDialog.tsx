/**
 * App-wide pairing approval dialog (change: add-pairing-approval-dialog,
 * mockups/pairing-approval states D1–D6).
 *
 * D12 invariant: approval = the operator TYPES the 8-digit code shown on the
 * device. This dialog never receives nor displays that code and has no
 * one-click accept. Built on the client-utils `Dialog` (`size="md"`) so focus
 * trap, escape stack and backdrop come for free; initial focus is moved to the
 * code field (APG: first control needed for the task).
 *
 * Redeemer metadata (UA / host / addresses) is attacker-controlled: rendered
 * as React text children only, never HTML, never a link.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { mdiAlertCircle, mdiCellphoneLink, mdiCheckCircle, mdiClockAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { describeUserAgent, deviceNameFromUserAgent } from "../../lib/pairing/describe-user-agent.js";
import type { ApprovePendingOutcome, PendingPairing } from "../../lib/pairing/pairing-approval-api.js";

const CODE_DIGITS = 8;
/** Server bound on the device label (UTF-8 bytes, `MAX_DEVICE_LABEL_BYTES`). */
const MAX_NAME_BYTES = 64;
/** D5: the success state stays visible, then closes on its own. */
export const SUCCESS_AUTO_CLOSE_MS = 4000;

type Phase = "form" | "locked" | "expired" | "success";

export interface PairingApprovalDialogProps {
  entry: PendingPairing;
  /** Epoch ms, ticked by the host; drives the advisory countdown + age. */
  now: number;
  /** Other requests waiting behind this one. */
  queued: number;
  /** Approve with the typed code; rejects only on a transport failure. */
  onApprove(confirmCode: string, label: string | undefined): Promise<ApprovePendingOutcome>;
  onDeny(): Promise<void>;
  /** Closed without answering — the request stays pending ("decide later"). */
  onDismiss(): void;
  /** A terminal state (success / locked / expired) was closed. */
  onDone(): void;
  /** Server says the request no longer exists (answered elsewhere). */
  onHandledElsewhere(): void;
}

/** Keep digits only (max 8), grouped 4+4 for reading (Miller chunking). */
export function formatCode(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, CODE_DIGITS);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function age(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return min < 1
    ? i18nT("pairingApproval.justNow", undefined, "just now")
    : i18nT("pairingApproval.minutesAgo", { count: min }, "{count} min ago");
}

function mismatchText(left: number): string {
  return left === 1
    ? i18nT(
        "pairingApproval.mismatchOne",
        undefined,
        "That code doesn't match the device. Check the device screen and retype it. 1 attempt left.",
      )
    : i18nT(
        "pairingApproval.mismatch",
        { count: left },
        "That code doesn't match the device. Check the device screen and retype it. {count} attempts left.",
      );
}

interface NextState {
  phase?: Phase;
  pairedName?: string;
  fieldError?: string;
  formError?: string;
  handledElsewhere?: true;
}

/** Server approve outcome → dialog state (design D6). */
function nextFromOutcome(outcome: ApprovePendingOutcome): NextState {
  if (outcome.ok) return { phase: "success", pairedName: outcome.device.label };
  if (outcome.error === "mismatch" && "attemptsLeft" in outcome) return { fieldError: mismatchText(outcome.attemptsLeft) };
  if (outcome.error === "locked_out") return { phase: "locked" };
  if (outcome.error === "expired") return { phase: "expired" };
  if (outcome.error === "no_pending") return { handledElsewhere: true };
  return { formError: i18nT("pairingApproval.failed", undefined, "Couldn't approve this device. Try again.") };
}

/** Redeemer context — untrusted, rendered as text children only (D4). */
function DeviceDetails({ entry, now }: { entry: PendingPairing; now: number }) {
  return (
    <dl
      data-testid="pairing-dialog-device"
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]"
    >
      <dt className="text-[var(--text-tertiary)]">{i18nT("pairingApproval.browser", undefined, "Browser")}</dt>
      <dd data-testid="pairing-dialog-browser" className="text-[var(--text-primary)] break-all">
        {describeUserAgent(entry.userAgent)}
      </dd>
      <dt className="text-[var(--text-tertiary)]">{i18nT("pairingApproval.via", undefined, "Came in via")}</dt>
      <dd data-testid="pairing-dialog-via" className="font-mono text-[var(--text-primary)] break-all">
        {entry.viaHost ?? "—"}
      </dd>
      <dt className="text-[var(--text-tertiary)]">{i18nT("pairingApproval.from", undefined, "From")}</dt>
      <dd data-testid="pairing-dialog-from" className="font-mono text-[var(--text-primary)] break-all">
        {entry.forwardedFor ? (
          <>
            {entry.forwardedFor}{" "}
            <span className="font-sans text-[var(--text-tertiary)]">
              {i18nT("pairingApproval.reportedByProxy", undefined, "(reported by proxy)")}
            </span>
          </>
        ) : (
          (entry.remoteAddress ?? "—")
        )}
      </dd>
      <dt className="text-[var(--text-tertiary)]">{i18nT("pairingApproval.when", undefined, "When")}</dt>
      <dd className="text-[var(--text-primary)]">{age(now - entry.createdAt)}</dd>
    </dl>
  );
}

/** Terminal outcome block: locked (D3), expired (D4) or success (D5). */
function ResultBlock({ phase, pairedName }: { phase: Exclude<Phase, "form">; pairedName: string }) {
  if (phase === "locked") {
    return (
      <div
        role="alert"
        data-testid="pairing-dialog-locked"
        className="flex items-start gap-2 px-3 py-2 rounded text-sm bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border border-[var(--severity-error-border)]"
      >
        <Icon path={mdiAlertCircle} size={0.75} className="shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            {i18nT("pairingApproval.lockedTitle", undefined, "Request blocked after 5 wrong codes.")}
          </p>
          <p>
            {i18nT(
              "pairingApproval.lockedBody",
              undefined,
              "The device was not paired. To try again, open a new pairing link on the device.",
            )}
          </p>
        </div>
      </div>
    );
  }
  if (phase === "expired") {
    return (
      <div
        role="alert"
        data-testid="pairing-dialog-expired"
        className="flex items-start gap-2 px-3 py-2 rounded text-sm bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border border-[var(--severity-warning-border)]"
      >
        <Icon path={mdiClockAlertOutline} size={0.75} className="shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{i18nT("pairingApproval.expiredTitle", undefined, "This request expired.")}</p>
          <p>
            {i18nT(
              "pairingApproval.expiredBody",
              undefined,
              "The device was not paired. Open a new pairing link on the device to try again.",
            )}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="pairing-dialog-success"
      className="flex items-start gap-2 px-3 py-2 rounded text-sm bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border border-[var(--severity-success-border)]"
    >
      <Icon path={mdiCheckCircle} size={0.75} className="shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">
          {i18nT("pairingApproval.paired", { name: pairedName }, 'Paired "{name}".')}
        </p>
        <p>
          {i18nT(
            "pairingApproval.pairedBody",
            undefined,
            "It's connecting now. Manage it in Settings ▸ Security ▸ Paired devices.",
          )}
        </p>
      </div>
    </div>
  );
}

export function PairingApprovalDialog({
  entry,
  now,
  queued,
  onApprove,
  onDeny,
  onDismiss,
  onDone,
  onHandledElsewhere,
}: PairingApprovalDialogProps) {
  const [phase, setPhase] = useState<Phase>("form");
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => deviceNameFromUserAgent(entry.userAgent));
  const [pairedName, setPairedName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const nameId = useId();

  // Initial focus → code field. The Dialog's focus trap (a parent effect) runs
  // after this component's effects and focuses the ✕, so defer one task.
  useEffect(() => {
    const t = setTimeout(() => codeRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(onDone, SUCCESS_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  const submit = async () => {
    if (busy) return;
    const digits = code.replace(/\D/g, "");
    setFormError(null);
    if (digits.length !== CODE_DIGITS) {
      setFieldError(i18nT("pairingApproval.enterAll", undefined, "Enter all 8 digits"));
      codeRef.current?.focus();
      return;
    }
    setFieldError(null);
    const trimmed = name.trim();
    if (new TextEncoder().encode(trimmed).length > MAX_NAME_BYTES) {
      setFormError(
        i18nT("pairingApproval.nameTooLong", undefined, "Device name is too long (at most 64 bytes)."),
      );
      return;
    }
    setBusy(true);
    let outcome: ApprovePendingOutcome;
    try {
      outcome = await onApprove(digits, trimmed.length > 0 ? trimmed : undefined);
    } catch {
      setBusy(false);
      setFormError(i18nT("pairingApproval.transport", undefined, "Couldn't reach the dashboard. Try again."));
      return;
    }
    setBusy(false);
    applyNext(nextFromOutcome(outcome));
  };

  const applyNext = (next: NextState) => {
    if (next.handledElsewhere) return onHandledElsewhere();
    if (next.pairedName !== undefined) setPairedName(next.pairedName);
    if (next.phase) setPhase(next.phase);
    if (next.fieldError) {
      setFieldError(next.fieldError);
      codeRef.current?.focus();
    }
    if (next.formError) setFormError(next.formError);
  };

  const deny = async () => {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await onDeny();
    } catch {
      setBusy(false);
      setFormError(i18nT("pairingApproval.transport", undefined, "Couldn't reach the dashboard. Try again."));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const form = phase === "form";

  return (
    <Dialog
      open
      onClose={form ? onDismiss : onDone}
      title={i18nT("pairingApproval.title", undefined, "A device wants to connect")}
      icon={mdiCellphoneLink}
      size="md"
      testId="pairing-dialog"
    >
      <p className="text-sm text-[var(--text-secondary)]">
        {i18nT(
          "pairingApproval.subtitle",
          undefined,
          "Someone opened a pairing link. Approve only if it's your device.",
        )}
      </p>

      {form && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            data-testid="pairing-dialog-expires"
            className="px-1.5 py-0.5 rounded bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]"
          >
            {i18nT(
              "pairingApproval.expires",
              { time: mmss(entry.expiresAt - now) },
              "Request expires in {time}",
            )}
          </span>
          {queued > 0 && (
            <span data-testid="pairing-dialog-queued" className="ml-auto text-[var(--text-tertiary)]">
              {i18nT("pairingApproval.queued", { count: queued }, "+{count} more waiting")}
            </span>
          )}
        </div>
      )}


      <DeviceDetails entry={entry} now={now} />

      {form && (
        <form id={`${codeId}-form`} onSubmit={onSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor={codeId} className="block text-sm font-medium text-[var(--text-primary)]">
              {i18nT("pairingApproval.codeLabel", undefined, "Code shown on the device")}
            </label>
            <p id={`${codeId}-hint`} className="text-xs text-[var(--text-tertiary)] mb-1">
              {i18nT("pairingApproval.codeHint", undefined, "8 digits, on the other browser's screen")}
            </p>
            <input
              ref={codeRef}
              id={codeId}
              data-testid="pairing-code-input"
              value={code}
              onChange={(e) => {
                setCode(formatCode(e.target.value));
                setFieldError(null);
              }}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={CODE_DIGITS + 1}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={`${codeId}-hint${fieldError ? ` ${codeId}-err` : ""}`}
              className={`w-full font-mono text-lg tracking-widest px-3 py-2 rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] border focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] ${
                fieldError ? "border-[var(--severity-error-border)]" : "border-[var(--border-primary)]"
              }`}
            />
            {fieldError && (
              <div
                id={`${codeId}-err`}
                role="alert"
                data-testid="pairing-code-error"
                className="flex items-start gap-1.5 mt-1 text-xs text-[var(--severity-error-fg)]"
              >
                <Icon path={mdiAlertCircle} size={0.6} className="shrink-0 mt-px" aria-hidden="true" />
                <span>{fieldError}</span>
              </div>
            )}
          </div>
          <div>
            <label htmlFor={nameId} className="block text-sm font-medium text-[var(--text-primary)]">
              {i18nT("pairingApproval.nameLabel", undefined, "Device name")}{" "}
              <span className="font-normal text-[var(--text-tertiary)]">
                {i18nT("pairingApproval.optional", undefined, "(optional)")}
              </span>
            </label>
            <p className="text-xs text-[var(--text-tertiary)] mb-1">
              {i18nT("pairingApproval.nameHint", undefined, "Shown in Settings ▸ Security ▸ Paired devices")}
            </p>
            <input
              id={nameId}
              data-testid="pairing-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
          </div>
          {/* Hidden submit so Enter in either field submits (validates first). */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}

      {phase !== "form" && <ResultBlock phase={phase} pairedName={pairedName} />}

      {formError && (
        <p role="alert" data-testid="pairing-dialog-error" className="text-xs text-[var(--severity-error-fg)]">
          {formError}
        </p>
      )}

      {form && (
        <p data-testid="pairing-dialog-consequence" className="text-xs text-[var(--text-secondary)]">
          {i18nT(
            "pairingApproval.consequence",
            undefined,
            "Approving gives this browser full control of the dashboard (operate). You can revoke it any time.",
          )}
        </p>
      )}

      {form ? (
        <>
          <p className="text-xs text-[var(--text-tertiary)]">
            {i18nT(
              "pairingApproval.decideLater",
              undefined,
              "Close to decide later. It stays under Settings ▸ Gateway until it expires.",
            )}
          </p>
          <Dialog.Footer>
            <Dialog.Cancel onClick={() => void deny()} testId="pairing-deny">
              {i18nT("pairingApproval.deny", undefined, "Deny")}
            </Dialog.Cancel>
            <Dialog.Action intent="primary" onClick={() => void submit()} disabled={busy} testId="pairing-approve">
              {i18nT("pairingApproval.approve", undefined, "Approve device")}
            </Dialog.Action>
          </Dialog.Footer>
        </>
      ) : (
        <Dialog.Footer>
          <Dialog.Cancel onClick={onDone} testId="pairing-dialog-done">
            {i18nT("pairingApproval.close", undefined, "Close")}
          </Dialog.Cancel>
        </Dialog.Footer>
      )}
    </Dialog>
  );
}
