/**
 * Vault Accounts tab: add a key (optionally with its `<PROVIDER>_API_KEY` variable), rotate,
 * revoke with the impact read fresh, and a usage line per account. A value is typed once into a
 * password field and cleared on submit; the list shows provider, label and usage only.
 *
 * Accounts are grouped by kind: keys first, then "Sign-in accounts" (oauth) and "Services"
 * (`service:*` namespace) only when such accounts exist; any other kind stays a count.
 * See change: add-credential-vault; retro-ux-credential-vault (D3, D6, D8, D10).
 */

import { isDeliverableEnvName } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { mdiAlertOutline, mdiAutorenew, mdiEyeOutline, mdiKeyVariant, mdiPlus, mdiRefresh, mdiTrashCanOutline } from "@mdi/js";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  addAccount,
  createBinding,
  describeSubject,
  fetchVault,
  revokeAccount,
  rotateAccount,
  setBindingDefault,
  type VaultAccountView,
  type VaultOverview,
} from "../../../lib/vault/vault-api.js";
import {
  BUTTON_CLASS,
  Callout,
  ConfirmImpact,
  ErrorLine,
  FieldError,
  GHOST_BUTTON_CLASS,
  HELP_CLASS,
  type ImpactResult,
  INPUT_CLASS,
  INSET_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
  StatusPill,
  usedByLine,
  VIcon,
} from "./vault-ui.js";

const MIN_KEY_LENGTH = 8;
const KNOWN_PROVIDERS = ["gemini", "openai", "anthropic", "soniox", "assemblyai"];

type Group = "key" | "signin" | "service" | "other";
const groupOf = (a: VaultAccountView): Group => {
  if (a.namespace.startsWith("service:")) return "service";
  if (a.kind === "key") return "key";
  return a.kind === "oauth" ? "signin" : "other";
};

const accountName = (a: VaultAccountView) => `${a.provider} / ${a.label}`;

interface VariableOffer {
  mode: "create" | "default";
  name: string;
  /** `provider / label` of the current default, when it exists. */
  current?: string;
}

/**
 * The variable proposed with a new key: `<PROVIDER>_API_KEY`. Not offered when the name is invalid or
 * reserved, nor when the existing variable's default belongs to another provider.
 */
function variableOffer(provider: string, overview: VaultOverview): VariableOffer | null {
  const p = provider.trim();
  if (!p) return null;
  const name = `${p.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  if (!isDeliverableEnvName(name)) return null;
  const binding = overview.bindings.find((b) => b.name === name);
  if (!binding) return { mode: "create", name };
  const current = overview.accounts.find((a) => a.id === binding.defaultAccountId);
  if (current && current.provider.toLowerCase() !== p.toLowerCase()) return null;
  return { mode: "default", name, current: current ? accountName(current) : undefined };
}

const applyVariable = (offer: VariableOffer, accountId: string) =>
  offer.mode === "create" ? createBinding({ name: offer.name, defaultAccountId: accountId }) : setBindingDefault(offer.name, accountId);

function usageLine(a: VaultAccountView, overview: VaultOverview): string {
  const defaults = overview.bindings.filter((b) => b.defaultAccountId === a.id).map((b) => b.name);
  const chosen = overview.grants.filter((g) => g.accountId === a.id).length;
  const parts: string[] = [];
  if (defaults.length) parts.push(i18nT("vault.usage.defaultFor", { names: defaults.join(", ") }, "Default for {names}"));
  if (chosen === 1) parts.push(i18nT("vault.usage.chosenOne", undefined, "Chosen by 1 project"));
  else if (chosen > 1) parts.push(i18nT("vault.usage.chosenMany", { count: chosen }, "Chosen by {count} projects"));
  return parts.length ? parts.join(" · ") : i18nT("vault.usage.none", undefined, "Not used by any variable");
}

/** What revoking `a` does, from an overview read just now. */
function revokeImpact(ov: VaultOverview, a: VaultAccountView): string[] {
  const items: string[] = [];
  const lost = ov.bindings.filter((b) => b.defaultAccountId === a.id).map((b) => b.name);
  if (lost.length) {
    items.push(i18nT("vault.impact.loseDefault", { names: lost.join(", ") }, "Loses its default account: {names}. Projects using the default deliver nothing."));
  }
  const overrides = new Map<string, string[]>();
  for (const g of ov.grants) {
    if (g.accountId === a.id) overrides.set(g.bindingName, [...(overrides.get(g.bindingName) ?? []), describeSubject(g.subject).name]);
  }
  for (const [binding, projects] of overrides) {
    items.push(
      i18nT(
        "vault.impact.overrideNothing",
        { binding, projects: projects.join(", ") },
        "{binding} in {projects} will deliver nothing. It does not fall back to the variable's default.",
      ),
    );
  }
  for (const name of lost) {
    const plugins = ov.pluginApprovals.filter((p) => p.bindingName === name).map((p) => p.pluginId);
    if (plugins.length) {
      items.push(i18nT("vault.impact.pluginsReadNothing", { plugins: plugins.join(", "), binding: name }, "Plugin approvals for {binding} ({plugins}) will then read nothing."));
    }
  }
  items.push(i18nT("vault.impact.runningProcesses", undefined, "Running processes keep the old value until they restart."));
  return items;
}

function AccountRow({
  account,
  overview,
  disabled,
  onChanged,
  onError,
}: {
  account: VaultAccountView;
  overview: VaultOverview;
  disabled: boolean;
  onChanged: () => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [rotating, setRotating] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const rotateId = useId();
  const name = accountName(account);

  const saveRotation = async () => {
    if (rotating === null) return;
    if (rotating.length < MIN_KEY_LENGTH) return setTooShort(true);
    onError(null);
    const res = await rotateAccount(account.id, rotating);
    if (!res.ok) return onError(res.error ?? `HTTP ${res.status}`);
    setRotating(null);
    await onChanged();
  };

  const loadImpact = async (): Promise<ImpactResult> => {
    const res = await fetchVault();
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
    return { ok: true, items: revokeImpact(res.data, account) };
  };

  const revoke = async () => {
    onError(null);
    const res = await revokeAccount(account.id);
    if (!res.ok) return onError(res.error ?? `HTTP ${res.status}`);
    setRevoking(false);
    await onChanged();
  };

  return (
    <li className={ROW_CLASS} data-testid={`vault-account-${account.id}`}>
      <VIcon path={mdiKeyVariant} size={0.8} className="mt-1 text-[var(--text-secondary)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <span data-testid="vault-account-label" className="min-w-0 truncate">
            {account.label}
          </span>
          <StatusPill tone="neutral" label={account.provider} />
        </div>
        <p className={HELP_CLASS}>{usageLine(account, overview)}</p>
        {rotating !== null && (
          <div className="mt-2 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={rotateId} className="sr-only">
                {i18nT("vault.newValueFor", { account: name }, "New value for {account}")}
              </label>
              <input
                id={rotateId}
                type="password"
                autoComplete="off"
                className={`${INPUT_CLASS} max-w-[280px] font-mono`}
                aria-invalid={tooShort}
                value={rotating}
                onChange={(e) => {
                  setRotating(e.target.value);
                  setTooShort(false);
                }}
              />
              <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={disabled || rotating === ""} onClick={() => void saveRotation()}>
                {i18nT("vault.saveNewValue", undefined, "Save new value")}
              </button>
              <button type="button" className={BUTTON_CLASS} onClick={() => setRotating(null)}>
                {i18nT("common.cancel", undefined, "Cancel")}
              </button>
            </div>
            {tooShort && <FieldError id={`${rotateId}-e`}>{i18nT("vault.keyTooShortRotate", undefined, "A key needs at least 8 characters.")}</FieldError>}
            <p className={HELP_CLASS}>
              {i18nT("vault.rotateNote", undefined, "Sessions pick up the new value on their next sync. Running processes keep the old one until restarted.")}
            </p>
          </div>
        )}
        {revoking && (
          <div className="mt-2">
            <ConfirmImpact
              title={i18nT("vault.revokeTitle", { account: name }, "Revoke {account}?")}
              confirmLabel={i18nT("vault.revokeAccount", undefined, "Revoke account")}
              loadImpact={loadImpact}
              onConfirm={revoke}
              onCancel={() => setRevoking(false)}
              returnFocusTo={revokeRef}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {account.kind === "key" && (
          <button
            type="button"
            data-testid="vault-account-rotate"
            aria-label={i18nT("vault.rotateAria", { account: name }, "Rotate {account}")}
            className={BUTTON_CLASS}
            disabled={disabled}
            onClick={() => setRotating("")}
          >
            <VIcon path={mdiAutorenew} size={0.6} />
            {i18nT("vault.rotate", undefined, "Rotate")}
          </button>
        )}
        <button
          type="button"
          ref={revokeRef}
          data-testid="vault-account-revoke"
          aria-label={i18nT("vault.revokeAria", { account: name }, "Revoke {account}")}
          className={GHOST_BUTTON_CLASS}
          disabled={disabled}
          onClick={() => setRevoking(true)}
        >
          <VIcon path={mdiTrashCanOutline} size={0.6} />
          {i18nT("vault.revoke", undefined, "Revoke")}
        </button>
      </div>
    </li>
  );
}

function AccountGroup({ testId, title, hint, children }: { testId: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="space-y-1.5">
      <h4 className={SECTION_TITLE_CLASS}>{title}</h4>
      <p className={HELP_CLASS}>{hint}</p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

/** Runs the optional variable step; the failure message, or undefined when it succeeded. */
async function variableStepError(offer: VariableOffer, accountId: string): Promise<string | undefined> {
  const step = await applyVariable(offer, accountId);
  return step.ok ? undefined : (step.error ?? `HTTP ${step.status}`);
}

function useAddKeyForm(overview: VaultOverview, onChanged: () => void | Promise<void>, onError: (message: string | null) => void) {
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [variableChoice, setVariableChoice] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState<{ accountId: string; offer: VariableOffer; error: string } | null>(null);
  const offer = variableOffer(provider, overview);
  const variableOn = offer ? (variableChoice ?? offer.mode === "create") : false;
  const keyInvalid = attempted && value.length < MIN_KEY_LENGTH;

  const resetForm = () => {
    setProvider("");
    setLabel("");
    setValue("");
    setShowKey(false);
    setAttempted(false);
    setVariableChoice(undefined);
  };

  const submit = async () => {
    setAttempted(true);
    if (value.length < MIN_KEY_LENGTH) return;
    setBusy(true);
    onError(null);
    setPartial(null);
    try {
      const res = await addAccount({ provider: provider.trim(), label: label.trim(), value });
      if (!res.ok || !res.data) return onError(res.error ?? `HTTP ${res.status}`);
      resetForm();
      const failed = offer && variableOn && res.data.id ? await variableStepError(offer, res.data.id) : undefined;
      if (failed !== undefined && offer) setPartial({ accountId: res.data.id, offer, error: failed });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** Idempotent: a binding that already has this account as default counts as done (a lost response). */
  const retryVariable = async () => {
    if (!partial) return;
    setBusy(true);
    try {
      const fresh = await fetchVault();
      const existing = fresh.ok ? fresh.data?.bindings.find((b) => b.name === partial.offer.name) : undefined;
      if (existing?.defaultAccountId === partial.accountId) {
        setPartial(null);
        return await onChanged();
      }
      const step = await applyVariable(partial.offer, partial.accountId);
      if (!step.ok) return setPartial({ ...partial, error: step.error ?? `HTTP ${step.status}` });
      setPartial(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return {
    provider,
    label,
    value,
    showKey,
    busy,
    partial,
    offer,
    variableOn,
    keyInvalid,
    submit,
    retryVariable,
    setLabel,
    setValue,
    setShowKey,
    setVariableChoice,
    changeProvider: (next: string) => {
      setProvider(next);
      setVariableChoice(undefined);
    },
  };
}

type AddKeyFormState = ReturnType<typeof useAddKeyForm>;

function KeyField({ ids, f }: { ids: string; f: AddKeyFormState }) {
  return (
    <div className="sm:col-span-2">
      <label className={LABEL_CLASS} htmlFor={`${ids}-key`}>
        {i18nT("vault.value", undefined, "Key")}
      </label>
      <div className="flex gap-2">
        <input
          id={`${ids}-key`}
          type={f.showKey ? "text" : "password"}
          autoComplete="off"
          className={`${INPUT_CLASS} font-mono`}
          aria-invalid={f.keyInvalid}
          aria-describedby={`${ids}-key-d`}
          value={f.value}
          onChange={(e) => f.setValue(e.target.value)}
        />
        <button
          type="button"
          className={`${BUTTON_CLASS} min-w-[32px] px-0`}
          aria-label={i18nT("vault.showKey", undefined, "Show key")}
          aria-pressed={f.showKey}
          onClick={() => f.setShowKey((v) => !v)}
        >
          <VIcon path={mdiEyeOutline} size={0.7} />
        </button>
      </div>
      {f.keyInvalid ? (
        <FieldError id={`${ids}-key-d`}>{i18nT("vault.keyTooShort", { count: f.value.length }, "A key needs at least 8 characters. This one has {count}.")}</FieldError>
      ) : (
        <p id={`${ids}-key-d`} className={`${HELP_CLASS} mt-1`}>
          {i18nT("vault.keyHint", undefined, "Saved once. The dashboard never shows it again.")}
        </p>
      )}
    </div>
  );
}

function offerLabel(offer: VariableOffer): string {
  if (offer.mode === "create") return i18nT("vault.createVariable", { name: offer.name }, "Create the variable {name} with this key as its default");
  if (offer.current) return i18nT("vault.makeDefaultOf", { name: offer.name, current: offer.current }, "Make it the default of {name} instead of {current}");
  return i18nT("vault.makeDefaultOfNone", { name: offer.name }, "Make it the default of {name}");
}

function VariableOfferField({ offer, on, overview, onChange }: { offer: VariableOffer; on: boolean; overview: VaultOverview; onChange: (on: boolean) => void }) {
  return (
    <div data-testid="vault-account-variable" data-mode={offer.mode} className="sm:col-span-2 space-y-1">
      <label className="flex min-h-[32px] items-start gap-2 text-xs text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="vault-account-variable-toggle"
          className="focus-ring mt-0.5"
          checked={on}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{offerLabel(offer)}</span>
      </label>
      {offer.mode === "default" && (
        <p data-testid="vault-account-variable-impact" className={`${HELP_CLASS} pl-6`}>
          {usedByLine(overview.grants.filter((g) => g.bindingName === offer.name && !g.accountId).length)}
        </p>
      )}
    </div>
  );
}

function PartialCallout({ error, busy, onRetry }: { error: string; busy: boolean; onRetry: () => void }) {
  return (
    <div className="sm:col-span-2">
      <Callout tone="warning" icon={mdiAlertOutline} role="alert" testId="vault-account-partial">
        <strong>{i18nT("vault.partialTitle", undefined, "Key saved; the variable wasn't created:")}</strong> {error}
        <div className="mt-2">
          <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onRetry}>
            <VIcon path={mdiRefresh} size={0.6} />
            {i18nT("vault.retry", undefined, "Retry")}
          </button>
        </div>
      </Callout>
    </div>
  );
}

function AddKeyForm({
  f,
  ids,
  formId,
  overview,
  disabled,
  providerRef,
  onCancel,
}: {
  f: AddKeyFormState;
  ids: string;
  formId: string;
  overview: VaultOverview;
  disabled: boolean;
  providerRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
}) {
  return (
    <form
      id={formId}
      data-testid="vault-account-form"
      className={`${INSET_CLASS} grid gap-3 sm:grid-cols-2`}
      onSubmit={(e) => {
        e.preventDefault();
        void f.submit();
      }}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor={`${ids}-provider`}>
          {i18nT("vault.provider", undefined, "Provider")}
        </label>
        <input
          id={`${ids}-provider`}
          ref={providerRef}
          list={`${ids}-providers`}
          className={INPUT_CLASS}
          value={f.provider}
          onChange={(e) => f.changeProvider(e.target.value)}
        />
        <datalist id={`${ids}-providers`}>
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor={`${ids}-label`}>
          {i18nT("vault.label", undefined, "Label")}
        </label>
        <input id={`${ids}-label`} className={INPUT_CLASS} value={f.label} onChange={(e) => f.setLabel(e.target.value)} />
      </div>
      <KeyField ids={ids} f={f} />
      {f.offer && <VariableOfferField offer={f.offer} on={f.variableOn} overview={overview} onChange={f.setVariableChoice} />}
      {f.partial && <PartialCallout error={f.partial.error} busy={f.busy} onRetry={() => void f.retryVariable()} />}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="submit"
          data-testid="vault-account-submit"
          className={PRIMARY_BUTTON_CLASS}
          disabled={disabled || f.busy || !f.provider.trim() || !f.label.trim() || f.value.length === 0}
        >
          <VIcon path={mdiPlus} size={0.6} />
          {i18nT("vault.addKey", undefined, "Add key")}
        </button>
        <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </form>
  );
}

export function VaultAccountsPanel({
  overview,
  onChanged,
  addRequest,
}: {
  overview: VaultOverview;
  onChanged: () => void | Promise<void>;
  /** Bumped by the first-run guide to open the add-key form. */
  addRequest?: number;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const disabled = overview.status.state === "corrupt";
  const f = useAddKeyForm(overview, onChanged, setError);

  useEffect(() => {
    if (addRequest) setFormOpen(true);
  }, [addRequest]);
  useEffect(() => {
    if (formOpen) providerRef.current?.focus();
  }, [formOpen]);

  const groups: Record<Group, VaultAccountView[]> = { key: [], signin: [], service: [], other: [] };
  for (const a of overview.accounts) groups[groupOf(a)].push(a);
  const row = (a: VaultAccountView) => <AccountRow key={a.id} account={a} overview={overview} disabled={disabled} onChanged={onChanged} onError={setError} />;
  const formId = `${ids}-form`;

  return (
    <div className="space-y-3">
      <ErrorLine error={error} testId="vault-accounts-error" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${HELP_CLASS} m-0`}>
          {i18nT("vault.accountsHint", undefined, "One account per key. Keep several per provider, for example personal and work.")}
        </p>
        <button
          type="button"
          data-testid="vault-account-new"
          aria-expanded={formOpen}
          aria-controls={formId}
          className={BUTTON_CLASS}
          disabled={disabled}
          onClick={() => setFormOpen((o) => !o)}
        >
          <VIcon path={mdiPlus} size={0.6} />
          {i18nT("vault.addKey", undefined, "Add key")}
        </button>
      </div>

      {formOpen && (
        <AddKeyForm f={f} ids={ids} formId={formId} overview={overview} disabled={disabled} providerRef={providerRef} onCancel={() => setFormOpen(false)} />
      )}

      <ul className="space-y-2" data-testid="vault-accounts-list">
        {groups.key.length === 0 && (
          <li className={`${HELP_CLASS} px-1`} data-testid="vault-accounts-empty">
            {i18nT("vault.noAccounts", undefined, "No accounts yet.")}
          </li>
        )}
        {groups.key.map(row)}
      </ul>
      {groups.signin.length > 0 && (
        <AccountGroup
          testId="vault-accounts-signin"
          title={i18nT("vault.signinAccounts", undefined, "Sign-in accounts")}
          hint={i18nT("vault.signinHint", undefined, "Linked logins. Shown by label, never as a token.")}
        >
          {groups.signin.map(row)}
        </AccountGroup>
      )}
      {groups.service.length > 0 && (
        <AccountGroup
          testId="vault-accounts-services"
          title={i18nT("vault.serviceAccounts", undefined, "Services")}
          hint={i18nT("vault.servicesHint", undefined, "Keys of managed services, by name only.")}
        >
          {groups.service.map(row)}
        </AccountGroup>
      )}
      {groups.other.length > 0 && (
        <p className={HELP_CLASS} data-testid="vault-accounts-other">
          {i18nT("vault.otherAccounts", { count: groups.other.length }, "{count} account(s) of another kind are kept and not shown here.")}
        </p>
      )}
    </div>
  );
}
