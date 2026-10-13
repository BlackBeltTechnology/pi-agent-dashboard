/**
 * Vault bindings, per-project grants and checkout confirmations.
 *
 * A binding names an env variable and its default account. A grant gives one
 * binding to one project (a repository key or a directory on a device), with an
 * optional account override. A grant whose account was revoked shows
 * `no-account`: it delivers nothing and never falls back to the default.
 * See change: add-credential-vault.
 */
import { useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  createBinding,
  createGrant,
  deleteBinding,
  deleteGrant,
  describeSubject,
  dirSubject,
  repoSubject,
  revokeConfirmation,
  setBindingDefault,
  type VaultOverview,
} from "../../../lib/vault/vault-api.js";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, ErrorLine, INPUT_CLASS, LIST_CLASS, Panel, ROW_CLASS } from "./vault-ui.js";

/** An example variable name (a technical token, not copy). */
const EXAMPLE_BINDING = "GEMINI_API_KEY";

type Op = () => Promise<{ ok: boolean; error?: string; status: number }>;

export function VaultBindingsPanel({ overview, onChanged }: { overview: VaultOverview; onChanged: () => void | Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [defaultId, setDefaultId] = useState("");
  const [grantBinding, setGrantBinding] = useState("");
  const [grantKind, setGrantKind] = useState<"repo" | "dir">("repo");
  const [repoKey, setRepoKey] = useState("");
  const [deviceId, setDeviceId] = useState("hub");
  const [dir, setDir] = useState("");
  const [override, setOverride] = useState("");

  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const accountLabel = (id?: string) => {
    if (!id) return i18nT("vault.noDefault", undefined, "no default");
    const a = overview.accounts.find((x) => x.id === id);
    return a ? `${a.provider} / ${a.label}` : i18nT("vault.missingAccount", undefined, "revoked account");
  };

  const run = async (op: Op): Promise<boolean> => {
    setError(null);
    const res = await op();
    if (!res.ok) {
      setError(res.error ?? `HTTP ${res.status}`);
      return false;
    }
    await onChanged();
    return true;
  };

  const addBinding = async () => {
    if (await run(() => createBinding({ name: name.trim(), defaultAccountId: defaultId || undefined }))) {
      setName("");
      setDefaultId("");
    }
  };

  const addGrant = async () => {
    const subject = grantKind === "repo" ? repoSubject(repoKey.trim()) : dirSubject(deviceId.trim(), dir.trim());
    if (await run(() => createGrant({ subject, bindingName: grantBinding, accountId: override || undefined }))) {
      setRepoKey("");
      setDir("");
      setOverride("");
    }
  };

  const grantReady = grantBinding !== "" && (grantKind === "repo" ? repoKey.trim() !== "" : deviceId.trim() !== "" && dir.trim() !== "");

  return (
    <div className="space-y-6">
      <ErrorLine error={error} testId="vault-bindings-error" />

      <Panel
        id="bindings"
        title={i18nT("vault.bindings", undefined, "Environment bindings")}
        hint={i18nT("vault.bindingsHint", undefined, "The variable a granted session sees, and the account it uses by default.")}
      >
        <div className={LIST_CLASS} data-testid="vault-bindings-list">
          {overview.bindings.length === 0 && (
            <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{i18nT("vault.noBindings", undefined, "No bindings yet.")}</div>
          )}
          {overview.bindings.map((b) => (
            <div key={b.name} className={ROW_CLASS} data-testid={`vault-binding-${b.name}`}>
              <span className="text-xs font-mono text-[var(--text-primary)]">{b.name}</span>
              <select
                className={INPUT_CLASS}
                aria-label={i18nT("vault.defaultAccount", undefined, "Default account")}
                value={b.defaultAccountId ?? ""}
                onChange={(e) => void run(() => setBindingDefault(b.name, e.target.value || null))}
              >
                <option value="">{i18nT("vault.noDefault", undefined, "no default")}</option>
                {keyAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.provider} / {a.label}
                  </option>
                ))}
              </select>
              {!b.defaultAccountId && (
                <span className="text-xs text-[var(--accent-yellow-text)]" data-testid="vault-binding-repair">
                  {i18nT("vault.needsRepair", undefined, "needs an account")}
                </span>
              )}
              <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void run(() => deleteBinding(b.name))}>
                {i18nT("common.delete", undefined, "Delete")}
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="vault-binding-form">
          <input
            className={`${INPUT_CLASS} font-mono`}
            placeholder={EXAMPLE_BINDING}
            aria-label={i18nT("vault.bindingName", undefined, "Variable name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select className={INPUT_CLASS} aria-label={i18nT("vault.defaultAccount", undefined, "Default account")} value={defaultId} onChange={(e) => setDefaultId(e.target.value)}>
            <option value="">{i18nT("vault.noDefault", undefined, "no default")}</option>
            {keyAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.provider} / {a.label}
              </option>
            ))}
          </select>
          <button type="button" className={BUTTON_CLASS} disabled={name.trim() === ""} onClick={() => void addBinding()}>
            {i18nT("vault.addBinding", undefined, "Add binding")}
          </button>
        </div>
      </Panel>

      <Panel
        id="grants"
        title={i18nT("vault.grants", undefined, "Project grants")}
        hint={i18nT("vault.grantsHint", undefined, "Nothing is delivered to a project until you grant it. A repository grant also needs each checkout confirmed.")}
      >
        <div className={LIST_CLASS} data-testid="vault-grants-list">
          {overview.grants.length === 0 && (
            <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{i18nT("vault.noGrants", undefined, "No grants yet. No project receives a key.")}</div>
          )}
          {overview.grants.map((g) => {
            const subject = describeSubject(g.subject);
            return (
              <div key={`${g.subject}|${g.bindingName}`} className={ROW_CLASS} data-testid="vault-grant-row" data-state={g.state}>
                <span className="text-xs font-mono text-[var(--text-primary)]">{g.bindingName}</span>
                <span className="text-xs text-[var(--text-tertiary)]">→</span>
                <span className="text-xs text-[var(--text-secondary)] flex-1 min-w-0 truncate" title={subject.text}>
                  {subject.kind === "repo" ? i18nT("vault.repo", undefined, "repository") : subject.kind === "dir" ? i18nT("vault.directory", undefined, "directory") : ""} {subject.text}
                </span>
                {g.accountId && <span className="text-xs text-[var(--text-tertiary)]">{accountLabel(g.accountId)}</span>}
                {g.state === "no-account" && (
                  <span className="text-xs text-[var(--accent-yellow-text)]" data-testid="vault-grant-no-account">
                    {i18nT("vault.noAccountState", undefined, "no account: delivers nothing")}
                  </span>
                )}
                <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void run(() => deleteGrant({ subject: g.subject, bindingName: g.bindingName }))}>
                  {i18nT("common.delete", undefined, "Delete")}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="vault-grant-form">
          <select className={INPUT_CLASS} aria-label={i18nT("vault.bindingName", undefined, "Variable name")} value={grantBinding} onChange={(e) => setGrantBinding(e.target.value)}>
            <option value="">{i18nT("vault.chooseBinding", undefined, "binding…")}</option>
            {overview.bindings.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <select className={INPUT_CLASS} aria-label={i18nT("vault.subjectKind", undefined, "Project kind")} value={grantKind} onChange={(e) => setGrantKind(e.target.value as "repo" | "dir")}>
            <option value="repo">{i18nT("vault.repo", undefined, "repository")}</option>
            <option value="dir">{i18nT("vault.directory", undefined, "directory")}</option>
          </select>
          {grantKind === "repo" ? (
            <input className={`${INPUT_CLASS} font-mono`} placeholder="github.com/acme/app" aria-label={i18nT("vault.repoKey", undefined, "Repository")} value={repoKey} onChange={(e) => setRepoKey(e.target.value)} />
          ) : (
            <>
              <input className={INPUT_CLASS} placeholder="hub" aria-label={i18nT("vault.device", undefined, "Device id")} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
              <input className={`${INPUT_CLASS} font-mono`} placeholder="/work/project" aria-label={i18nT("vault.directory", undefined, "directory")} value={dir} onChange={(e) => setDir(e.target.value)} />
            </>
          )}
          <select className={INPUT_CLASS} aria-label={i18nT("vault.overrideAccount", undefined, "Account for this project")} value={override} onChange={(e) => setOverride(e.target.value)}>
            <option value="">{i18nT("vault.useDefault", undefined, "binding default")}</option>
            {keyAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.provider} / {a.label}
              </option>
            ))}
          </select>
          <button type="button" className={BUTTON_CLASS} disabled={!grantReady} onClick={() => void addGrant()}>
            {i18nT("vault.addGrant", undefined, "Grant")}
          </button>
        </div>
      </Panel>

      <Panel
        id="confirmations"
        title={i18nT("vault.confirmations", undefined, "Confirmed checkouts")}
        hint={i18nT("vault.confirmationsHint", undefined, "A repository grant is honoured only in a checkout you confirmed (from the session's Vault chip). Revoking one withdraws the values.")}
      >
        <div className={LIST_CLASS} data-testid="vault-confirmations-list">
          {overview.confirmations.length === 0 && (
            <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{i18nT("vault.noConfirmations", undefined, "No confirmed checkouts.")}</div>
          )}
          {overview.confirmations.map((c) => (
            <div key={`${c.deviceId}|${c.dir}|${c.repoKey}`} className={ROW_CLASS} data-testid="vault-confirmation-row">
              <span className="text-xs font-mono text-[var(--text-primary)]">{c.repoKey}</span>
              <span className="text-xs text-[var(--text-tertiary)] flex-1 min-w-0 truncate" title={c.dir}>
                {c.dir} @ {c.deviceId}
              </span>
              <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void run(() => revokeConfirmation(c))}>
                {i18nT("vault.revoke", undefined, "Revoke")}
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
