/**
 * Per-session vault binding state (change: add-credential-vault).
 *
 * A chip in the session header, shown only when the session has at least one
 * vault binding. It opens a dialog listing each binding NAME with its state
 * (never a value): delivered, local-override, inherited, pending-confirmation,
 * no-account, revoked, and so on, plus the last time the hub contacted this
 * session. A `revoked` row says running processes may still hold the old value.
 * A pending checkout confirmation can be confirmed right here.
 *
 * The state is polled while the chip is mounted so a confirmation converges to
 * `delivered` without a page reload.
 */
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { confirmCheckout, fetchSessionBindings, type SessionBindingState } from "../../lib/vault/vault-api.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

const POLL_MS = 2500;

const STATE_LABEL_EN: Record<string, string> = {
  delivered: "Delivered",
  "local-override": "Local value kept",
  inherited: "Inherited from parent pi",
  "pending-confirmation": "Pending confirmation",
  "no-account": "No account",
  "blocked-name": "Name not allowed",
  revoked: "Revoked",
};

function stateLabel(state: string): string {
  return i18nT(`vault.state.${state}`, undefined, STATE_LABEL_EN[state] ?? state);
}

function stateTone(state: string): string {
  if (state === "delivered" || state === "inherited") return "text-[var(--accent-green-text)]";
  if (state === "local-override") return "text-[var(--text-secondary)]";
  return "text-[var(--accent-yellow-text)]";
}

export function VaultBindingsChip({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<SessionBindingState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchSessionBindings(sessionId);
      setState(res.ok && res.data ? res.data : null);
    } catch {
      setState(null);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!state || state.bindings.length === 0) return null;

  const pending = state.bindings.some((b) => b.state === "pending-confirmation");
  const confirmable = state.project?.repoKey !== undefined && pending;

  const confirm = async () => {
    const p = state.project;
    if (!p?.repoKey) return;
    setError(null);
    const res = await confirmCheckout({ deviceId: p.deviceId, dir: p.dir, repoKey: p.repoKey });
    if (!res.ok) return setError(res.error ?? `HTTP ${res.status}`);
    await load();
  };

  return (
    <>
      <button
        type="button"
        data-testid="vault-chip"
        data-pending={pending ? "true" : "false"}
        onClick={() => setOpen(true)}
        className={`text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] hover:text-[var(--text-primary)] ${pending ? "text-[var(--accent-yellow-text)]" : "text-[var(--text-secondary)]"}`}
        title={i18nT("vault.chipTitle", undefined, "Vault keys for this session")}
      >
        {i18nT("vault.chip", { count: state.bindings.length }, "Vault · {count}")}
      </button>
      {open && (
        <DialogPortal>
          <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/40" onClick={() => setOpen(false)} data-testid="vault-bindings-backdrop">
            <div
              role="dialog"
              aria-label={i18nT("vault.sessionTitle", undefined, "Vault keys for this session")}
              className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md shadow-xl w-[min(560px,92vw)] max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              data-testid="vault-bindings-dialog"
            >
              <div className="px-3 py-2 border-b border-[var(--border-primary)] flex items-center justify-between">
                <span className="text-[11px] text-[var(--text-secondary)]">{i18nT("vault.sessionTitle", undefined, "Vault keys for this session")}</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
                  data-testid="vault-bindings-close"
                >
                  {i18nT("common.close", undefined, "Close")}
                </button>
              </div>
              <div className="overflow-y-auto p-2 space-y-1">
                {state.bindings.map((b) => (
                  <div key={b.name} className="flex flex-wrap items-center gap-2 text-[11px] px-1" data-testid="vault-binding-row" data-state={b.state}>
                    <span className="font-mono text-[var(--text-primary)]">{b.name}</span>
                    <span className={stateTone(b.state)} data-testid="vault-binding-state">
                      {stateLabel(b.state)}
                    </span>
                    {b.state === "revoked" && (
                      <span className="text-[var(--text-tertiary)]" data-testid="vault-revoked-note">
                        {i18nT("vault.revokedNote", undefined, "Processes already running may still hold the old value.")}
                      </span>
                    )}
                  </div>
                ))}
                {state.project?.repoKey && pending && (
                  <p className="text-[11px] text-[var(--text-secondary)] px-1 pt-1" data-testid="vault-pending-copy">
                    {i18nT(
                      "vault.pendingCopy",
                      { repo: state.project.repoKey, dir: state.project.dir, device: state.project.deviceId },
                      "Deliver the granted keys to {repo} at {dir} on {device}?",
                    )}
                  </p>
                )}
                {error && (
                  <div role="alert" className="text-[11px] text-[var(--accent-red-text)] px-1" data-testid="vault-confirm-error">
                    {error}
                  </div>
                )}
                {confirmable && (
                  <button
                    type="button"
                    data-testid="vault-confirm"
                    onClick={() => void confirm()}
                    className="text-[11px] px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)]"
                  >
                    {i18nT("vault.confirmCheckout", undefined, "Confirm this checkout")}
                  </button>
                )}
                <p className="text-[10px] text-[var(--text-tertiary)] px-1 pt-1" data-testid="vault-last-contact">
                  {state.lastContactAt
                    ? i18nT("vault.lastContact", { time: new Date(state.lastContactAt).toLocaleTimeString() }, "Last vault contact: {time}")
                    : i18nT("vault.noContact", undefined, "No vault contact yet.")}
                </p>
              </div>
            </div>
          </div>
        </DialogPortal>
      )}
    </>
  );
}
