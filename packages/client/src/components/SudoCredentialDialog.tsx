/**
 * Modal that asks the operator for a sudo password on behalf of a bash tool
 * call (SUDO_ASKPASS bridge helper), plus the host that mounts it and the
 * "Forget" chip for the server-held cache.
 *
 * Contracts:
 * - The password lives only in this component's state while typing; it is
 *   cleared the moment `sudo_credential_response` is handed to the socket and
 *   never touches storage, the URL or logs.
 * - Command(s) and sudo's prompt text are rendered as inert text (React
 *   escapes it); the prompt text is agent-controlled (`sudo -p`), so it sits in a
 *   box labelled "text supplied by the command". Bidi/control characters are
 *   shown as visible escapes. Nothing is truncated: the command region scrolls.
 * - Cancel is sticky server-side, so a backdrop click does NOT cancel — only
 *   Esc and the Cancel button do.
 * - `sudo_credential_*` frames are never queued: a rejected send keeps the
 *   dialog open with a retry message (see `useWebSocket` outbox exclusion).
 *
 * See change: add-sudo-credential-prompt.
 */
import { DialogPortal } from "@blackbelt-technology/pi-dashboard-client-utils/DialogPortal";
import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { useFocusTrap } from "@blackbelt-technology/pi-dashboard-client-utils/useFocusTrap";
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH } from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import { mdiLockOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId, useRef, useState } from "react";
import type { SendVerdict } from "../hooks/useWebSocket.js";
import { useI18n } from "../lib/i18n/i18n.js";
import {
  dismissSudoCredentialRequest,
  type SudoCredentialRequest,
  type SudoCredentialSnapshot,
  subscribeSudoCredential,
} from "../lib/state/sudo-credential-bus.js";

type Send = (msg: BrowserToServerMessage) => SendVerdict;

function isUnsafe(cp: number): boolean {
  return (
    (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x61c ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/** Replace control/bidi characters with visible `\uXXXX` escapes. */
function showEscapes(text: string): string {
  return Array.from(text, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return isUnsafe(cp) ? `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}` : ch;
  }).join("");
}

type FormError = "empty" | "tooLong" | "connection" | null;

export function SudoCredentialDialog({
  request,
  send,
  onDone,
  sessionLabel,
}: {
  request: SudoCredentialRequest;
  send: Send;
  /** Called once the answer (response or cancel) was handed to the socket. */
  onDone: () => void;
  sessionLabel?: string;
}) {
  const { t } = useI18n();
  const { sessionId, callId } = request;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FormError>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const titleId = useId();
  const promptLabelId = useId();

  useFocusTrap(panelRef, true);
  // After the trap (effects run in declaration order): the password field, not
  // the first focusable, takes initial focus.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (settledRef.current) return;
    if (password.length === 0) return setError("empty");
    if (password.length > SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH) return setError("tooLong");
    const verdict = send({ type: "sudo_credential_response", sessionId, callId, password });
    if (verdict.status !== "handed") return setError("connection");
    settledRef.current = true;
    setPassword("");
    setError(null);
    onDone();
  };

  const cancel = () => {
    if (settledRef.current) return;
    const verdict = send({ type: "sudo_credential_cancel", sessionId, callId });
    if (verdict.status !== "handed") return setError("connection");
    settledRef.current = true;
    setPassword("");
    onDone();
  };

  useEscapeDismiss(true, cancel);

  const errorText =
    error === "empty"
      ? t("sudo.errorEmpty", undefined, "Enter a password.")
      : error === "tooLong"
        ? t("sudo.errorTooLong", { max: SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH }, "Password is too long (max {max} characters).")
        : error === "connection"
          ? t("sudo.errorConnection", undefined, "Connection lost — retry once reconnected.")
          : null;

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-dialog flex items-center justify-center">
        <div className="absolute inset-0 bg-[var(--bg-overlay)]" data-testid="sudo-credential-dialog-overlay" />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid="sudo-credential-dialog"
          className="relative w-full mx-4 max-w-lg max-h-[80vh] overflow-y-auto p-4 space-y-3 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-xl focus:outline-none"
        >
          <div className="flex items-center gap-2">
            <Icon path={mdiLockOutline} size={0.8} aria-hidden="true" />
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
              {t("sudo.title", undefined, "A command is asking for your sudo password")}
            </h2>
            {sessionLabel && <span className="ml-auto text-xs text-[var(--text-muted)] truncate">{sessionLabel}</span>}
          </div>

          <div
            role="region"
            tabIndex={0}
            aria-label={t("sudo.commandsLabel", undefined, "Commands currently running")}
            data-testid="sudo-credential-commands"
            className="max-h-40 overflow-auto rounded border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-2 space-y-2 font-mono text-[11px] text-[var(--text-primary)]"
          >
            {request.commands.map((cmd, i) => (
              // Position is the identity: the list is static for a prompt's lifetime.
              <pre key={i} className="whitespace-pre-wrap break-all">
                {showEscapes(cmd)}
              </pre>
            ))}
          </div>

          <div
            role="group"
            aria-labelledby={promptLabelId}
            className="rounded border border-dashed border-[var(--severity-warning-fg)] p-2"
          >
            <div id={promptLabelId} className="text-[10px] uppercase tracking-wide text-[var(--severity-warning-fg)]">
              {t("sudo.promptLabel", undefined, "Text supplied by the command")}
            </div>
            <pre
              data-testid="sudo-credential-prompt-text"
              className="whitespace-pre-wrap break-all font-mono text-[11px] italic text-[var(--text-secondary)]"
            >
              {showEscapes(request.prompt)}
            </pre>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              data-testid="sudo-credential-password"
              type="password"
              autoComplete="new-password"
              aria-label={t("sudo.passwordLabel", undefined, "sudo password")}
              aria-invalid={error === "empty" || error === "tooLong"}
              className="flex-1 min-w-0 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error !== "connection") setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                submit();
              }}
            />
            <button
              type="button"
              data-testid="sudo-credential-cancel"
              className="px-3 py-1 text-sm rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
              onClick={cancel}
            >
              {t("sudo.cancel", undefined, "Cancel")}
            </button>
            <button
              type="button"
              data-testid="sudo-credential-submit"
              className="px-3 py-1 text-sm rounded bg-[var(--accent-solid)] text-white hover:opacity-90"
              onClick={submit}
            >
              {t("sudo.submit", undefined, "Send")}
            </button>
          </div>
          {errorText && (
            <p role="alert" className="text-xs text-[var(--severity-error-fg)]">
              {errorText}
            </p>
          )}
        </div>
      </div>
    </DialogPortal>
  );
}

const EMPTY_SNAPSHOT: SudoCredentialSnapshot = { requests: [], cache: {} };

/** Mounted once near the app root: oldest pending prompt as a modal + one Forget chip per cached session. */
export function SudoCredentialHost({
  send,
  connected,
  sessionLabel,
}: {
  send: Send;
  /** Socket-open flag; a false→true flip re-sends acks the closed socket rejected. */
  connected?: boolean;
  /** Resolves a session id to a display name (optional). */
  sessionLabel?: (sessionId: string) => string | undefined;
}) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<SudoCredentialSnapshot>(EMPTY_SNAPSHOT);
  useEffect(() => subscribeSudoCredential(setSnap), []);

  // Ack EVERY pending request (not just the one rendered): the ack means "this
  // client can render it", and the server's ack timer otherwise refuses a queued
  // second-session request as unanswerable. One ack per callId once handed off;
  // a rejected send (socket not OPEN — never queued) is retried when `send` or
  // `connected` changes. Refs persist across StrictMode's double effect.
  const ackedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (connected === false) return; // known-closed socket: wait for the flip
    const acked = ackedRef.current;
    const live = new Set<string>();
    for (const { sessionId, callId } of snap.requests) {
      const key = `${sessionId}:${callId}`;
      live.add(key);
      if (acked.has(key)) continue;
      if (send({ type: "sudo_credential_shown", sessionId, callId }).status === "handed") acked.add(key);
    }
    for (const key of acked) if (!live.has(key)) acked.delete(key);
  }, [snap.requests, send, connected]);

  const active = snap.requests[0];
  const cachedSessions = Object.keys(snap.cache);

  return (
    <>
      {active && (
        <SudoCredentialDialog
          key={`${active.sessionId}:${active.callId}`}
          request={active}
          send={send}
          sessionLabel={sessionLabel?.(active.sessionId)}
          onDone={() => dismissSudoCredentialRequest(active.sessionId, active.callId)}
        />
      )}
      {cachedSessions.length > 0 && (
        <div className="fixed bottom-4 left-4 z-toast flex flex-col gap-1">
          {cachedSessions.map((sid) => (
            <button
              key={sid}
              type="button"
              data-testid="sudo-credential-forget"
              className="px-2 py-1 text-xs rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              onClick={() => send({ type: "sudo_credential_forget", sessionId: sid })}
            >
              {t("sudo.forget", { session: sessionLabel?.(sid) ?? sid }, "Forget sudo password ({session})")}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
