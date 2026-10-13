/**
 * Settings → Vault (change: add-credential-vault).
 *
 * Hub-owned credentials: accounts, env bindings, per-project grants, checkout
 * confirmations, plugin read approvals and a non-destructive import. The page
 * never receives a stored value: listings carry ids, labels, names and states.
 *
 * Styling: theme tokens only — no raw hex, no raw px, no z-index.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { fetchVault, type VaultOverview, type VaultResult } from "../../../lib/vault/vault-api.js";
import { OperateRequiredCallout } from "./OperateRequiredCallout.js";
import { VaultAccountsPanel } from "./VaultAccountsPanel.js";
import { VaultBindingsPanel } from "./VaultBindingsPanel.js";
import { VaultImportPanel } from "./VaultImportPanel.js";
import { VaultPluginsPanel } from "./VaultPluginsPanel.js";

export function VaultSection() {
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Remedies of an `operate_required` refusal; null when the load did not fail that way. */
  const [operateRemedies, setOperateRemedies] = useState<unknown[] | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryInFlight = useRef(false);

  const reload = useCallback(async () => {
    const res: VaultResult<VaultOverview> = await fetchVault().catch((err: unknown) => ({
      ok: false,
      status: 0,
      error: String((err as Error)?.message ?? err),
    }));
    if (res.ok && res.data) {
      setOverview(res.data);
      setLoadError(null);
      setOperateRemedies(null);
    } else if (res.code === "operate_required" && res.remedies) {
      // An older server sends no `remedies`: it falls through to the plain line below.
      setOperateRemedies(res.remedies);
      setLoadError(null);
    } else {
      setOperateRemedies(null);
      setLoadError(res.error ?? `HTTP ${res.status}`);
    }
  }, []);

  // Single-flight: one activation issues at most one request.
  const retry = useCallback(async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(true);
    try {
      await reload();
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div data-testid="vault-section" className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{i18nT("vault.title", undefined, "Credential vault")}</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {i18nT(
            "vault.description",
            undefined,
            "Keys live on this dashboard. A key reaches a session only when its project is granted it, and the dashboard never shows a stored value again after you save it.",
          )}
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1" data-testid="vault-scoping-note">
          {i18nT(
            "vault.scopingNote",
            undefined,
            "Grants scope which sessions get a key; they are not a security boundary against code running in that project.",
          )}
        </p>
      </div>

      {operateRemedies && <OperateRequiredCallout remedies={operateRemedies} busy={retrying} onRetry={retry} />}

      {loadError && (
        <div data-testid="vault-error" role="alert" className="text-sm text-[var(--accent-red-text)]">
          {i18nT("vault.loadFailed", { error: loadError }, "Couldn't load the vault: {error}")}
        </div>
      )}

      {overview?.status.state === "corrupt" && (
        <div data-testid="vault-corrupt" role="alert" className="border border-[var(--accent-red)] rounded p-3 text-sm text-[var(--text-primary)]">
          {i18nT(
            "vault.corrupt",
            { backup: overview.status.backup ?? "none" },
            "The vault file is corrupt and writes are refused. A byte-exact backup was kept ({backup}). Sessions keep the values they already hold for a limited time.",
          )}
        </div>
      )}

      {overview && (
        <>
          <VaultAccountsPanel overview={overview} onChanged={reload} />
          <VaultImportPanel onChanged={reload} />
          <VaultBindingsPanel overview={overview} onChanged={reload} />
          <VaultPluginsPanel overview={overview} onChanged={reload} />
        </>
      )}
    </div>
  );
}
