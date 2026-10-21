import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type PluginRow, PluginTrustError, revokePluginTrust, trustPluginClient, trustPluginServer } from "../../lib/package/plugins-api.js";
import { WARN_BG, WARN_BORDER, WARN_FG } from "./plugin-row-parts.js";

/**
 * Consent actions of one Plugins-tab row (design D13/D14): Trust / Trust this version for a refused
 * runtime client (`untrusted` / `pin-mismatch` ONLY — a structural reason such as `disabled` wins over
 * consent and gets no action), Revoke for a trusted one, and "Trust server code" for an untrusted
 * `pi-package` server entry. The operator is shown the package path and the FULL 64-hex hash they pin.
 *
 * See change: decouple-plugins-from-core (task 6.13).
 */
/** Which consent actions a row offers. A structural refusal reason offers none (it wins over consent). */
function trustAffordances(row: PluginRow) {
  const status = row.status;
  const client = status?.client;
  const reason = client?.delivery === "refused" ? client.refusedReason : undefined;
  const sha = client?.sha256;
  return {
    reason,
    sha,
    canTrustClient: (reason === "untrusted" || reason === "pin-mismatch") && typeof sha === "string" && sha.length > 0,
    canRevoke: client?.delivery === "runtime" || reason === "pin-mismatch",
    canTrustServer: status?.source === "pi-package" && status.error === "server-untrusted",
  };
}

function trustErrorMessage(err: unknown): string {
  if (err instanceof PluginTrustError && err.code === "local_only") {
    return i18nT("packages.pluginTrustLocalOnly", undefined, "Plugin trust can only be granted from the machine running the dashboard.");
  }
  if (err instanceof PluginTrustError && err.code === "stale_hash") {
    return i18nT("packages.pluginTrustStaleHash", undefined, "The plugin changed on disk. Review the new hash and try again.");
  }
  return err instanceof Error ? err.message : String(err);
}

export function PluginTrustControls({ row }: { row: PluginRow }): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reason, sha, canTrustClient, canRevoke, canTrustServer } = trustAffordances(row);
  if (!canTrustClient && !canRevoke && !canTrustServer) return null;

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(trustErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const btn = `px-2 py-1 rounded text-xs border ${WARN_BG} ${WARN_BORDER} ${WARN_FG} hover:opacity-80 disabled:opacity-50`;
  return (
    <div className="mx-3 mb-2 space-y-1.5 text-[11px] text-[var(--text-secondary)]" data-testid={`plugin-trust-panel-${row.id}`}>
      {(canTrustClient || canTrustServer) && row.packageDir && (
        <div className="truncate" title={row.packageDir} data-testid={`plugin-trust-path-${row.id}`}>
          {i18nT("packages.pluginTrustPackagePath", undefined, "Package:")} <code>{row.packageDir}</code>
        </div>
      )}
      {canTrustClient && (
        <div data-testid={`plugin-trust-hash-${row.id}`}>
          {i18nT("packages.pluginTrustHash", undefined, "Content hash (SHA-256):")}{" "}
          <code className="break-all">{sha}</code>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canTrustClient && (
          <button type="button" className={btn} disabled={busy} data-testid={`plugin-trust-${row.id}`} onClick={() => void run(() => trustPluginClient(row.id, sha as string))}>
            {reason === "pin-mismatch"
              ? i18nT("packages.pluginTrustThisVersion", undefined, "Trust this version")
              : i18nT("packages.pluginTrust", undefined, "Trust")}
          </button>
        )}
        {canTrustServer && (
          <button type="button" className={btn} disabled={busy} data-testid={`plugin-trust-server-${row.id}`} onClick={() => void run(() => trustPluginServer(row.id))}>
            {i18nT("packages.pluginTrustServerCode", undefined, "Trust server code")}
          </button>
        )}
        {canRevoke && (
          <button type="button" className={btn} disabled={busy} data-testid={`plugin-revoke-${row.id}`} onClick={() => void run(() => revokePluginTrust(row.id))}>
            {i18nT("packages.pluginRevokeTrust", undefined, "Revoke trust")}
          </button>
        )}
      </div>
      {error && (
        <div className={WARN_FG} role="alert" data-testid={`plugin-trust-error-${row.id}`}>
          {error}
        </div>
      )}
    </div>
  );
}
