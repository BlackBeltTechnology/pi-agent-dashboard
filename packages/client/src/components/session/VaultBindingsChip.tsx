/**
 * Per-session vault binding state (change: add-credential-vault; retro-ux-credential-vault).
 *
 * A chip in the session header, shown when the session holds a vault binding, or when the caller
 * may manage the vault and a variable is not yet granted to the session's project. It opens a
 * dialog with: the project the session resolves to (or why the vault does not deliver here), a
 * checkout-confirmation callout, each binding NAME with a state pill and one-line explanation
 * (never a value), the variables that could be granted to this project, and the last time the hub
 * contacted this session. A `revoked` row says running processes may still hold the old value.
 *
 * The state is polled while the chip is mounted so a grant or a confirmation converges to
 * `delivered` without a page reload. Everything inside the chip and dialog is at least 12 px.
 */
import { mdiArrowRight, mdiCheck, mdiClose, mdiCogOutline, mdiPlus, mdiProgressClock, mdiShieldKeyOutline } from "@mdi/js";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { confirmCheckout, createGrant, dirSubject, fetchSessionBindings, repoSubject, type SessionBindingState } from "../../lib/vault/vault-api.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import {
  BindingStatePill,
  BUTTON_CLASS,
  Callout,
  deviceName,
  GHOST_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  stateHelp,
  VIcon,
} from "../settings/vault/vault-ui.js";

const POLL_MS = 2500;

type Project = NonNullable<SessionBindingState["project"]>;

function ProjectLine({ project, outcome }: { project?: Project; outcome?: string }) {
  if (!project) {
    if (!outcome) return null;
    return (
      <p className="m-0 text-[var(--text-secondary)]" data-testid="vault-project-line">
        {i18nT("vault.noProject", { outcome }, "The vault does not deliver to this session ({outcome}).")}
      </p>
    );
  }
  return (
    <p className="m-0 text-[var(--text-secondary)]" data-testid="vault-project-line">
      {project.repoKey && (
        <>
          {i18nT("vault.projectRepo", undefined, "Project")} <code className="font-mono text-[var(--text-primary)]">{project.repoKey}</code>
          <br />
        </>
      )}
      {i18nT("vault.projectCheckout", { device: deviceName(project.deviceId) }, "Checkout on {device}:")}{" "}
      <code className="break-all font-mono text-[var(--text-primary)]">{project.dir}</code>
    </p>
  );
}

/** Checkout confirmation: a trust decision (any clone can claim an origin), so it is the primary action. */
function ConfirmCallout({
  project,
  count,
  disabled,
  error,
  onConfirm,
}: {
  project: Project;
  count: number;
  disabled: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Callout tone="warning" icon={mdiProgressClock} testId="vault-confirm-callout">
      <strong className="block text-sm">{i18nT("vault.confirmTitle", undefined, "Confirm this checkout?")}</strong>
      <p className="m-0 mt-1" data-testid="vault-pending-copy">
        {i18nT(
          "vault.pendingCopy",
          { repo: project.repoKey ?? "", dir: project.dir, device: deviceName(project.deviceId) },
          "Deliver the granted keys to {repo} at {dir} on {device}?",
        )}{" "}
        {i18nT("vault.trustCopy", undefined, "Its git remote says this repository, but any clone can claim that. Confirm only if you trust the code in this checkout.")}{" "}
        {i18nT("vault.confirmScope", undefined, "Applies to every session in this checkout.")}
      </p>
      {error && (
        <div role="alert" className="mt-1" data-testid="vault-confirm-error">
          {error}
        </div>
      )}
      <div className="mt-2">
        <button type="button" data-testid="vault-confirm" disabled={disabled} onClick={onConfirm} className={PRIMARY_BUTTON_CLASS}>
          <VIcon path={mdiCheck} size={0.6} />
          {count === 1
            ? i18nT("vault.confirmDeliverOne", undefined, "Confirm and deliver 1 key")
            : i18nT("vault.confirmDeliverMany", { count }, "Confirm and deliver {count} keys")}
        </button>
      </div>
    </Callout>
  );
}

function BindingRow({ name, state }: { name: string; state: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="vault-binding-row" data-state={state}>
      <code className="font-mono text-[var(--text-primary)]">{name}</code>
      <BindingStatePill state={state} />
      <span className="text-xs text-[var(--text-secondary)]" data-explanation="" data-testid={state === "revoked" ? "vault-revoked-note" : "vault-binding-help"}>
        {stateHelp(state)}
      </span>
    </div>
  );
}

/** Variables with no grant for this project, for a caller that may manage the vault. */
function UngrantedSection({
  names,
  project,
  disabled,
  error,
  onGrant,
}: {
  names: string[];
  project: Project;
  disabled: boolean;
  error: string | null;
  onGrant: (name: string) => void;
}) {
  const projectName = (project.repoKey ?? project.dir).replace(/\/+$/, "").split("/").pop() || project.dir;
  return (
    <div data-testid="vault-ungranted" className="space-y-1.5">
      <h4 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
        <VIcon path={mdiCogOutline} size={0.6} />
        {i18nT("vault.ungrantedTitle", undefined, "Not granted to this project")}
      </h4>
      {names.map((name) => (
        <div key={name} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="vault-ungranted-row">
          <code className="font-mono text-[var(--text-primary)]">{name}</code>
          <button
            type="button"
            data-testid="vault-grant-from-session"
            className={BUTTON_CLASS}
            disabled={disabled}
            aria-label={i18nT("vault.grantToAria2", { name, project: projectName }, "Grant {name} to {project}")}
            onClick={() => onGrant(name)}
          >
            <VIcon path={mdiPlus} size={0.6} />
            {i18nT("vault.grant", undefined, "Grant")}
          </button>
          {project.repoKey && <span className="text-[var(--text-secondary)]">{i18nT("vault.repoGrantNeedsConfirm", undefined, "Repository grants need this checkout confirmed.")}</span>}
        </div>
      ))}
      {error && (
        <div role="alert" className="text-[var(--severity-error-fg)]" data-testid="vault-grant-error">
          {error}
        </div>
      )}
    </div>
  );
}

function DialogFooter({ lastContactAt, onManage }: { lastContactAt?: number; onManage: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-primary)] px-3 py-2 text-xs">
      <span className="text-xs text-[var(--text-secondary)]" data-testid="vault-last-contact">
        {lastContactAt
          ? i18nT("vault.lastContact", { time: new Date(lastContactAt).toLocaleTimeString() }, "Last vault contact: {time}")
          : i18nT("vault.noContact", undefined, "No vault contact yet.")}
      </span>
      <a
        href="/settings/vault"
        data-testid="vault-manage-link"
        className="focus-ring inline-flex min-h-[32px] items-center gap-1 font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline"
        onClick={(e) => {
          e.preventDefault();
          onManage();
        }}
      >
        {i18nT("vault.manageLink", undefined, "Manage in Settings → Vault")}
        <VIcon path={mdiArrowRight} size={0.55} />
      </a>
    </div>
  );
}

function chipLabel(pending: boolean, count: number): string {
  if (pending) return i18nT("vault.chipConfirm", undefined, "Vault: confirm");
  return count === 0 ? i18nT("vault.chipNone", undefined, "Vault") : i18nT("vault.chip", { count }, "Vault · {count}");
}

export function VaultBindingsChip({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<SessionBindingState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  /** Names granted from this dialog, hidden until the next poll reflects them. */
  const [grantedNow, setGrantedNow] = useState<ReadonlySet<string>>(new Set());
  const [, navigate] = useLocation();

  const load = useCallback(async () => {
    const res = await fetchSessionBindings(sessionId);
    setState(res.ok && res.data ? res.data : null);
    setGrantedNow(new Set());
  }, [sessionId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!state || (state.bindings.length === 0 && (state.ungranted ?? []).length === 0)) return null;

  const project = state.project;
  const ungranted = (state.ungranted ?? []).filter((n) => !grantedNow.has(n));
  const pendingCount = state.bindings.filter((b) => b.state === "pending-confirmation").length;
  const pending = pendingCount > 0;
  const unavailable = state.outcome === "vault-unavailable";

  const confirm = async () => {
    if (!project?.repoKey) return;
    setError(null);
    const res = await confirmCheckout({ deviceId: project.deviceId, dir: project.dir, repoKey: project.repoKey });
    if (!res.ok) return setError(res.error ?? `HTTP ${res.status}`);
    await load();
  };

  // A repository grant when the session has a repository key, else a folder grant on its device.
  const grant = async (name: string) => {
    if (!project) return;
    setGrantError(null);
    const subject = project.repoKey ? repoSubject(project.repoKey) : dirSubject(project.deviceId, project.dir);
    const res = await createGrant({ subject, bindingName: name });
    if (!res.ok) return setGrantError(res.error ?? `HTTP ${res.status}`);
    setGrantedNow((prev) => new Set(prev).add(name));
  };

  const chipClass = pending
    ? "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]"
    : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";

  return (
    <>
      <button
        type="button"
        data-testid="vault-chip"
        data-pending={pending ? "true" : "false"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`focus-ring inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${chipClass}`}
        title={i18nT("vault.chipTitle", undefined, "Vault keys for this session")}
      >
        <VIcon path={pending ? mdiProgressClock : mdiShieldKeyOutline} size={0.55} />
        {chipLabel(pending, state.bindings.length)}
      </button>
      {open && (
        <DialogPortal>
          <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/40" onClick={() => setOpen(false)} data-testid="vault-bindings-backdrop">
            <div
              role="dialog"
              aria-label={i18nT("vault.sessionTitle", undefined, "Vault keys for this session")}
              className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="vault-bindings-dialog"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border-primary)] px-3 py-2">
                <h3 className="m-0 text-sm font-semibold text-[var(--text-primary)]">{i18nT("vault.sessionTitle", undefined, "Vault keys for this session")}</h3>
                <button type="button" onClick={() => setOpen(false)} className={GHOST_BUTTON_CLASS} data-testid="vault-bindings-close" aria-label={i18nT("common.close", undefined, "Close")}>
                  <VIcon path={mdiClose} size={0.6} />
                  {i18nT("common.close", undefined, "Close")}
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto p-3 text-xs text-[var(--text-primary)]">
                <ProjectLine project={project} outcome={state.outcome} />
                {pending && project?.repoKey && (
                  <ConfirmCallout project={project} count={pendingCount} disabled={unavailable} error={error} onConfirm={() => void confirm()} />
                )}
                <div className="space-y-1.5">
                  {state.bindings.map((b) => (
                    <BindingRow key={b.name} name={b.name} state={b.state} />
                  ))}
                </div>
                {ungranted.length > 0 && project && (
                  <UngrantedSection names={ungranted} project={project} disabled={unavailable} error={grantError} onGrant={(n) => void grant(n)} />
                )}
              </div>
              <DialogFooter
                lastContactAt={state.lastContactAt}
                onManage={() => {
                  setOpen(false);
                  navigate("/settings/vault");
                }}
              />
            </div>
          </div>
        </DialogPortal>
      )}
    </>
  );
}
