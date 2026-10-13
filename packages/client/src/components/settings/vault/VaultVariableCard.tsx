/**
 * One variable card on the Variables tab: its default account (impact shown before saving), the
 * projects granted it (status pill, account used, confirmed checkouts of a repository grant), the
 * project picker, the plugin approvals for that name and a two-step delete.
 *
 * A grant whose account was revoked shows `no-account`: it delivers nothing and never falls back
 * to the default. `data-state` stays the server's grant state (`ok` | `no-account`); the status
 * shown on this page is `data-status`.
 * See change: add-credential-vault; retro-ux-credential-vault (D1, D6, D9).
 */
import { mdiAlertOutline, mdiCogOutline, mdiFolderOutline, mdiInformationOutline, mdiPlus, mdiPuzzleOutline, mdiSourceRepository, mdiTrashCanOutline } from "@mdi/js";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  createGrant,
  deleteBinding,
  deleteGrant,
  describeSubject,
  fetchVault,
  repoSubject,
  revokeConfirmation,
  setBindingDefault,
  setPluginApproval,
  type VaultAccountView,
  type VaultBindingView,
  type VaultConfirmationView,
  type VaultGrantView,
  type VaultOverview,
  type VaultPluginDeclaration,
} from "../../../lib/vault/vault-api.js";
import { VaultProjectPicker } from "./VaultProjectPicker.js";
import {
  ApprovalSwitch,
  BUTTON_CLASS,
  ConfirmImpact,
  deviceName,
  GHOST_BUTTON_CLASS,
  type GrantStatus,
  GrantStatusPill,
  HELP_CLASS,
  type ImpactResult,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  ROW_CLASS,
  runOp,
  SECTION_TITLE_CLASS,
  StatusPill,
  usedByLine,
  VIcon,
} from "./vault-ui.js";

interface Shared {
  overview: VaultOverview;
  disabled: boolean;
  onChanged: () => void | Promise<void>;
  onError: (message: string | null) => void;
}

const accountName = (overview: VaultOverview, id: string | undefined): string | undefined => {
  const a = overview.accounts.find((x) => x.id === id);
  return a ? `${a.provider} / ${a.label}` : undefined;
};

/** Status of a project row, or null for a subject this page does not deliver to. */
function grantStatus(g: VaultGrantView, binding: VaultBindingView, overview: VaultOverview): GrantStatus | null {
  const s = describeSubject(g.subject);
  if (s.kind === "other") return null;
  if (g.state === "no-account") return "no-account";
  if (!g.accountId && !binding.defaultAccountId) return "no-default";
  if (s.kind === "repo" && !overview.confirmations.some((c) => repoSubject(c.repoKey) === g.subject)) return "pending";
  return "delivering";
}

/** What deleting `name` removes, from an overview read just now. */
function deleteImpact(ov: VaultOverview, name: string): string[] {
  const items: string[] = [];
  const projects = ov.grants.filter((g) => g.bindingName === name).map((g) => describeSubject(g.subject).name);
  if (projects.length === 1) items.push(i18nT("vault.impact.removeFromOne", { projects: projects[0] }, "Removes it from 1 project: {projects}."));
  else if (projects.length > 1) items.push(i18nT("vault.impact.removeFromMany", { count: projects.length, projects: projects.join(", ") }, "Removes it from {count} projects: {projects}."));
  const approvals = ov.pluginApprovals.filter((a) => a.bindingName === name).map((a) => a.pluginId);
  if (approvals.length) {
    items.push(i18nT("vault.impact.removeApprovals", { count: approvals.length, plugins: approvals.join(", ") }, "Removes {count} plugin approval(s): {plugins}."));
  }
  items.push(i18nT("vault.impact.sessionsLose", undefined, "Connected sessions lose it within seconds. Processes already running keep the old value."));
  return items;
}

/** A plugin's read approval for a variable name; `action` (e.g. Create) sits beside the switch. */
export function PluginApprovalRow({
  plugin,
  name,
  approved,
  disabled,
  onChanged,
  onError,
  action,
  compact = false,
}: {
  plugin: VaultPluginDeclaration;
  name: string;
  approved: boolean;
  disabled: boolean;
  onChanged: () => void | Promise<void>;
  onError: (message: string | null) => void;
  action?: ReactNode;
  compact?: boolean;
}) {
  const toggle = (next: boolean) => void runOp(() => setPluginApproval(plugin.pluginId, name, next), onError, onChanged);
  return (
    <div
      data-testid={`vault-plugin-${plugin.pluginId}-${name}`}
      className={compact ? "mt-2 flex flex-wrap items-center gap-3" : `${ROW_CLASS} items-center`}
    >
      {!compact && <VIcon path={mdiPuzzleOutline} size={0.8} className="text-[var(--text-secondary)]" />}
      {!compact && (
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{plugin.displayName}</div>
          <p className={HELP_CLASS}>
            {i18nT("vault.pluginReads", { name }, "Reads the default account of {name} for the whole server, not one project.")}
          </p>
        </div>
      )}
      {action}
      <ApprovalSwitch checked={approved} disabled={disabled} onChange={toggle} />
    </div>
  );
}

function RepairAccount({ name, accounts, disabled, onPick }: { name: string; accounts: VaultAccountView[]; disabled: boolean; onPick: (accountId?: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <select
        className={`${INPUT_CLASS} w-auto min-h-[32px]`}
        aria-label={i18nT("vault.accountFor", { project: name }, "Account for {project}")}
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onPick(e.target.value)}
      >
        <option value="">{i18nT("vault.chooseAccount", undefined, "Choose an account…")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.provider} / {a.label}
          </option>
        ))}
      </select>
      <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={() => onPick(undefined)}>
        {i18nT("vault.useDefault", undefined, "Use variable default")}
      </button>
    </div>
  );
}

function Checkouts({
  checkouts,
  disabled,
  onError,
  onChanged,
}: {
  checkouts: VaultConfirmationView[];
  disabled: boolean;
  onError: Shared["onError"];
  onChanged: Shared["onChanged"];
}) {
  if (checkouts.length === 0) {
    return (
      <p className={`${HELP_CLASS} mt-1`}>
        {i18nT("vault.noCheckouts", undefined, "Open a session in a checkout of this repository and confirm it from the session's Vault chip.")}
      </p>
    );
  }
  return (
    <details className="mt-1.5 text-xs text-[var(--text-primary)]">
      <summary className="focus-ring flex min-h-[32px] cursor-pointer items-center font-semibold">
        {checkouts.length === 1
          ? i18nT("vault.checkoutsOne", undefined, "1 confirmed checkout")
          : i18nT("vault.checkoutsMany", { count: checkouts.length }, "{count} confirmed checkouts")}
      </summary>
      <ul className="mt-1 space-y-1">
        {checkouts.map((c) => (
          <li key={`${c.deviceId}|${c.dir}`} data-testid="vault-confirmation-row" className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all font-mono">{c.dir}</code>
            <span className={HELP_CLASS}>{i18nT("vault.onDevice", { device: deviceName(c.deviceId) }, "on {device}")}</span>
            <button
              type="button"
              data-testid="vault-checkout-revoke"
              className={GHOST_BUTTON_CLASS}
              disabled={disabled}
              aria-label={i18nT("vault.revokeCheckoutAria", { dir: c.dir }, "Revoke checkout {dir}")}
              onClick={() => void runOp(() => revokeConfirmation(c), onError, onChanged)}
            >
              {i18nT("vault.revoke", undefined, "Revoke")}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** "Uses …" line: the grant's own account, else the variable default. */
function usesLabel(grant: VaultGrantView, binding: VaultBindingView, overview: VaultOverview): string {
  if (grant.accountId) return accountName(overview, grant.accountId) ?? i18nT("vault.missingAccount", undefined, "revoked account");
  const usesDefault = accountName(overview, binding.defaultAccountId) ?? i18nT("vault.defaultNone", undefined, "none");
  return i18nT("vault.variableDefault", { account: usesDefault }, "variable default ({account})");
}

function SubjectLine({ subject }: { subject: ReturnType<typeof describeSubject> }) {
  return (
    <p className={`${HELP_CLASS} break-all`}>
      {subject.kind === "repo" && i18nT("vault.subjectRepo", { key: subject.key }, "Repository · {key}")}
      {subject.kind === "dir" && i18nT("vault.subjectDir", { device: deviceName(subject.deviceId ?? ""), path: subject.key }, "Folder on {device} · {path}")}
      {subject.kind === "other" && subject.text}
    </p>
  );
}

function GrantRow({ grant, binding, shared }: { grant: VaultGrantView; binding: VaultBindingView; shared: Shared }) {
  const { overview, disabled, onChanged, onError } = shared;
  const subject = describeSubject(grant.subject);
  const status = grantStatus(grant, binding, overview);
  const checkouts = subject.kind === "repo" ? overview.confirmations.filter((c) => repoSubject(c.repoKey) === grant.subject) : [];
  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const uses = usesLabel(grant, binding, overview);

  const setAccount = (accountId?: string) =>
    void runOp(() => createGrant({ subject: grant.subject, bindingName: grant.bindingName, accountId }), onError, onChanged);

  return (
    <li className={ROW_CLASS} data-testid="vault-grant-row" data-state={grant.state} data-status={status ?? undefined}>
      <VIcon
        path={subject.kind === "repo" ? mdiSourceRepository : subject.kind === "dir" ? mdiFolderOutline : mdiCogOutline}
        size={0.8}
        className="mt-0.5 text-[var(--text-secondary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <span className="min-w-0 break-all">{subject.name}</span>
          {status ? (
            <GrantStatusPill status={status} />
          ) : (
            <StatusPill tone="neutral" icon={mdiInformationOutline} label={i18nT("vault.notDelivered", undefined, "Not delivered to sessions")} testId="vault-grant-not-delivered" />
          )}
        </div>
        <SubjectLine subject={subject} />
        {status && <p className={HELP_CLASS}>{i18nT("vault.uses", { account: uses }, "Uses {account}")}</p>}
        {status === "no-account" && <RepairAccount name={subject.name} accounts={keyAccounts} disabled={disabled} onPick={setAccount} />}
        {subject.kind === "repo" && <Checkouts checkouts={checkouts} disabled={disabled} onError={onError} onChanged={onChanged} />}
      </div>
      <button
        type="button"
        data-testid="vault-grant-remove"
        className={GHOST_BUTTON_CLASS}
        disabled={disabled}
        aria-label={i18nT("vault.removeFromAria", { binding: binding.name, project: subject.name }, "Remove {binding} from {project}")}
        onClick={() => void runOp(() => deleteGrant({ subject: grant.subject, bindingName: grant.bindingName }), onError, onChanged)}
      >
        {i18nT("vault.remove", undefined, "Remove")}
      </button>
    </li>
  );
}

export function VaultVariableCard({ binding, overview, disabled, onChanged, onError }: { binding: VaultBindingView } & Shared) {
  const shared: Shared = { overview, disabled, onChanged, onError };
  const [draftDefault, setDraftDefault] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const grantRef = useRef<HTMLButtonElement>(null);
  const restoreGrantFocus = useRef(false);
  const selectId = useId();

  useEffect(() => {
    if (!picking && restoreGrantFocus.current) {
      restoreGrantFocus.current = false;
      grantRef.current?.focus();
    }
  }, [picking]);
  const closePicker = () => {
    restoreGrantFocus.current = true;
    setPicking(false);
  };

  const grants = overview.grants.filter((g) => g.bindingName === binding.name);
  const plugins = overview.plugins.filter((p) => p.declared.includes(binding.name));
  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const current = binding.defaultAccountId ?? "";
  const selected = draftDefault ?? current;

  const loadImpact = async (): Promise<ImpactResult> => {
    const res = await fetchVault();
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
    return { ok: true, items: deleteImpact(res.data, binding.name) };
  };

  return (
    <article data-testid={`vault-binding-${binding.name}`} aria-label={binding.name} className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{binding.name}</span>
        {!binding.defaultAccountId && (
          <StatusPill tone="warning" icon={mdiAlertOutline} label={i18nT("vault.needsRepair", undefined, "No default account")} testId="vault-binding-repair" />
        )}
        <button
          type="button"
          ref={deleteRef}
          data-testid="vault-variable-delete"
          className={`${GHOST_BUTTON_CLASS} ml-auto`}
          disabled={disabled}
          aria-label={i18nT("vault.deleteVariableAria", { name: binding.name }, "Delete variable {name}")}
          onClick={() => setDeleting(true)}
        >
          <VIcon path={mdiTrashCanOutline} size={0.6} />
          {i18nT("common.delete", undefined, "Delete")}
        </button>
      </header>
      <div className="space-y-4 p-3">
        {deleting && (
          <ConfirmImpact
            title={i18nT("vault.deleteTitle", { name: binding.name }, "Delete {name}?")}
            confirmLabel={i18nT("vault.deleteVariable", undefined, "Delete variable")}
            loadImpact={loadImpact}
            onConfirm={async () => {
              if (await runOp(() => deleteBinding(binding.name), onError, onChanged)) setDeleting(false);
            }}
            onCancel={() => setDeleting(false)}
            returnFocusTo={deleteRef}
          />
        )}

        <div>
          <label className={LABEL_CLASS} htmlFor={selectId}>
            {i18nT("vault.defaultAccount", undefined, "Default account")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={selectId}
              data-testid="vault-binding-default"
              className={`${INPUT_CLASS} w-auto`}
              value={selected}
              disabled={disabled}
              onChange={(e) => setDraftDefault(e.target.value === current ? null : e.target.value)}
            >
              <option value="">{i18nT("vault.noDefaultAccount", undefined, "No default account")}</option>
              {keyAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.provider} / {a.label}
                </option>
              ))}
            </select>
            {draftDefault !== null && (
              <>
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS}
                  disabled={disabled}
                  onClick={async () => {
                    if (await runOp(() => setBindingDefault(binding.name, draftDefault || null), onError, onChanged)) setDraftDefault(null);
                  }}
                >
                  {i18nT("vault.saveDefault", undefined, "Save default")}
                </button>
                <button type="button" className={BUTTON_CLASS} onClick={() => setDraftDefault(null)}>
                  {i18nT("common.cancel", undefined, "Cancel")}
                </button>
              </>
            )}
          </div>
          <p data-testid={draftDefault !== null ? "vault-binding-default-impact" : undefined} className={`${HELP_CLASS} mt-1`}>
            {draftDefault !== null ? usedByLine(grants.filter((g) => !g.accountId).length) : i18nT("vault.defaultHint", undefined, "Used by every project below that doesn't pick its own account.")}
          </p>
        </div>

        <div>
          <h4 className={SECTION_TITLE_CLASS}>
            <VIcon path={mdiFolderOutline} size={0.6} />
            {i18nT("vault.projects", { count: grants.length }, "Projects ({count})")}
          </h4>
          {grants.length === 0 ? (
            <p className={`${HELP_CLASS} mt-1.5`}>{i18nT("vault.noGrants", undefined, "No project gets this variable yet.")}</p>
          ) : (
            <ul className="mt-1.5 space-y-2">
              {grants.map((g) => (
                <GrantRow key={g.subject} grant={g} binding={binding} shared={shared} />
              ))}
            </ul>
          )}
          <div className="mt-2">
            {picking ? (
              <VaultProjectPicker
                binding={binding}
                overview={overview}
                onCancel={closePicker}
                onGranted={async () => {
                  closePicker();
                  await onChanged();
                }}
              />
            ) : (
              <button type="button" ref={grantRef} data-testid="vault-grant-open" className={BUTTON_CLASS} disabled={disabled} onClick={() => setPicking(true)}>
                <VIcon path={mdiPlus} size={0.6} />
                {i18nT("vault.grantToProject", undefined, "Grant to a project")}
              </button>
            )}
          </div>
        </div>

        {plugins.length > 0 && (
          <div>
            <h4 className={SECTION_TITLE_CLASS}>
              <VIcon path={mdiPuzzleOutline} size={0.6} />
              {i18nT("vault.plugins", undefined, "Plugins")}
            </h4>
            <div className="mt-1.5 space-y-2">
              {plugins.map((p) => (
                <PluginApprovalRow
                  key={p.pluginId}
                  plugin={p}
                  name={binding.name}
                  approved={overview.pluginApprovals.some((a) => a.pluginId === p.pluginId && a.bindingName === binding.name)}
                  disabled={disabled}
                  onChanged={onChanged}
                  onError={onError}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
