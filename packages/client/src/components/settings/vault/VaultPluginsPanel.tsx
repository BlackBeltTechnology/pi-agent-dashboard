/**
 * Plugin read approvals. A plugin may read a binding's DEFAULT account value
 * only if its manifest declares the name AND you approved it here. Reads are
 * not project-scoped (a plugin is server-wide); this is a capability contract,
 * not isolation. See change: add-credential-vault (D4).
 */
import { useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { setPluginApproval, type VaultOverview } from "../../../lib/vault/vault-api.js";
import { ErrorLine, LIST_CLASS, Panel, ROW_CLASS } from "./vault-ui.js";

export function VaultPluginsPanel({ overview, onChanged }: { overview: VaultOverview; onChanged: () => void | Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const approved = (pluginId: string, name: string) => overview.pluginApprovals.some((a) => a.pluginId === pluginId && a.bindingName === name);

  const toggle = async (pluginId: string, name: string, next: boolean) => {
    setError(null);
    const res = await setPluginApproval(pluginId, name, next);
    if (!res.ok) {
      setError(res.error ?? `HTTP ${res.status}`);
      return;
    }
    await onChanged();
  };

  return (
    <Panel
      id="plugins"
      title={i18nT("vault.plugins", undefined, "Plugin access")}
      hint={i18nT("vault.pluginsHint", undefined, "Plugins read the default account of a binding they declare, for the whole server rather than one project. Approve each declaration.")}
    >
      <ErrorLine error={error} testId="vault-plugins-error" />
      <div className={LIST_CLASS} data-testid="vault-plugins-list">
        {overview.plugins.length === 0 && (
          <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{i18nT("vault.noPlugins", undefined, "No installed plugin declares a vault binding.")}</div>
        )}
        {overview.plugins.flatMap((p) =>
          p.declared.map((name) => {
            const on = approved(p.pluginId, name);
            return (
              <div key={`${p.pluginId}|${name}`} className={ROW_CLASS} data-testid={`vault-plugin-${p.pluginId}-${name}`}>
                <span className="text-xs text-[var(--text-secondary)]">{p.displayName}</span>
                <span className="text-xs font-mono text-[var(--text-primary)] flex-1 min-w-0 truncate">{name}</span>
                <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    data-testid="vault-plugin-approve"
                    checked={on}
                    onChange={(e) => void toggle(p.pluginId, name, e.target.checked)}
                  />
                  {on ? i18nT("vault.approved", undefined, "Approved") : i18nT("vault.notApproved", undefined, "Not approved")}
                </label>
              </div>
            );
          }),
        )}
      </div>
    </Panel>
  );
}
