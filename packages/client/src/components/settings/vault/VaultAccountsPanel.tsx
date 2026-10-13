/**
 * Vault accounts: add, rotate, revoke. A value is typed once into a password
 * field and cleared on submit; the list shows provider and label only.
 * See change: add-credential-vault.
 */
import { useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { addAccount, revokeAccount, rotateAccount, type VaultOverview } from "../../../lib/vault/vault-api.js";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, ErrorLine, INPUT_CLASS, LIST_CLASS, Panel, ROW_CLASS } from "./vault-ui.js";

export function VaultAccountsPanel({ overview, onChanged }: { overview: VaultOverview; onChanged: () => void | Promise<void> }) {
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [rotating, setRotating] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<{ ok: boolean; error?: string; status: number }>) => {
    setError(null);
    const res = await op();
    if (!res.ok) {
      setError(res.error ?? `HTTP ${res.status}`);
      return false;
    }
    await onChanged();
    return true;
  };

  const submit = async () => {
    const ok = await run(() => addAccount({ provider, label, value }));
    if (ok) {
      setProvider("");
      setLabel("");
      setValue("");
    }
  };

  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const otherAccounts = overview.accounts.length - keyAccounts.length;

  return (
    <Panel
      id="accounts"
      title={i18nT("vault.accounts", undefined, "Accounts")}
      hint={i18nT("vault.accountsHint", undefined, "Keys of at least 8 characters. You can keep several accounts per provider, for example personal and work.")}
    >
      <ErrorLine error={error} testId="vault-accounts-error" />
      <div className={LIST_CLASS} data-testid="vault-accounts-list">
        {keyAccounts.length === 0 && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]" data-testid="vault-accounts-empty">
            {i18nT("vault.noAccounts", undefined, "No accounts yet.")}
          </div>
        )}
        {keyAccounts.map((a) => (
          <div key={a.id} className={ROW_CLASS} data-testid={`vault-account-${a.id}`}>
            <span className="text-xs text-[var(--text-tertiary)]">{a.provider}</span>
            <span className="text-xs font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate" data-testid="vault-account-label">
              {a.label}
            </span>
            {rotating?.id === a.id ? (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  aria-label={i18nT("vault.newValue", undefined, "New value")}
                  className={INPUT_CLASS}
                  value={rotating.value}
                  onChange={(e) => setRotating({ id: a.id, value: e.target.value })}
                />
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  onClick={async () => {
                    if (await run(() => rotateAccount(a.id, rotating.value))) setRotating(null);
                  }}
                >
                  {i18nT("common.save", undefined, "Save")}
                </button>
                <button type="button" className={BUTTON_CLASS} onClick={() => setRotating(null)}>
                  {i18nT("common.cancel", undefined, "Cancel")}
                </button>
              </>
            ) : (
              <button type="button" className={BUTTON_CLASS} onClick={() => setRotating({ id: a.id, value: "" })}>
                {i18nT("vault.rotate", undefined, "Rotate")}
              </button>
            )}
            <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void run(() => revokeAccount(a.id))}>
              {i18nT("vault.revoke", undefined, "Revoke")}
            </button>
          </div>
        ))}
      </div>
      {otherAccounts > 0 && (
        <p className="text-xs text-[var(--text-tertiary)]" data-testid="vault-accounts-other">
          {i18nT("vault.otherAccounts", { count: otherAccounts }, "{count} account(s) of another kind are kept and not shown here.")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" data-testid="vault-account-form">
        <input
          className={INPUT_CLASS}
          placeholder={i18nT("vault.provider", undefined, "Provider (e.g. gemini)")}
          aria-label={i18nT("vault.provider", undefined, "Provider (e.g. gemini)")}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <input
          className={INPUT_CLASS}
          placeholder={i18nT("vault.label", undefined, "Label (e.g. personal)")}
          aria-label={i18nT("vault.label", undefined, "Label (e.g. personal)")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          type="password"
          autoComplete="off"
          className={INPUT_CLASS}
          placeholder={i18nT("vault.value", undefined, "Key")}
          aria-label={i18nT("vault.value", undefined, "Key")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className={BUTTON_CLASS} disabled={!provider.trim() || !label.trim() || value.length === 0} onClick={() => void submit()}>
          {i18nT("vault.addAccount", undefined, "Add account")}
        </button>
      </div>
    </Panel>
  );
}
