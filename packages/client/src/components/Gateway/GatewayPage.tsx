/**
 * **Gateway** settings page (task 9.2) — own page under the Network nav group.
 * Full-width host composing the reusable sections: provider/mode, connect-a-
 * device (QR first), accessible-at endpoints, setup guide, and a cross-ref to
 * the Security page for trusted networks (no dupe). All strings say "Gateway";
 * the wire keeps `tunnel`.
 *
 * Self-manages provider/mode via `GET`/`PUT /api/config` so it need not thread
 * into the SettingsPanel diff-save machinery.
 *
 * See change: add-tunnel-providers.
 */

import type { TunnelMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getConfig, putConfig } from "../../lib/gateway-api.js";
import type { GatewayProviderId } from "../../lib/gateway-providers.js";
import { GatewayEndpoints } from "./GatewayEndpoints.js";
import { GatewayPairQR } from "./GatewayPairQR.js";
import { GatewayProviderSection } from "./GatewayProviderSection.js";
import { GatewaySetupGuide } from "./GatewaySetupGuide.js";

export function GatewayPage() {
  const [, navigate] = useLocation();
  const [provider, setProvider] = useState<GatewayProviderId>("zrok");
  const [mode, setMode] = useState<TunnelMode>("public");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void getConfig()
      .then((cfg) => {
        const tunnel = (cfg.tunnel as { provider?: GatewayProviderId; mode?: TunnelMode }) ?? {};
        if (tunnel.provider) setProvider(tunnel.provider);
        if (tunnel.mode) setMode(tunnel.mode);
      })
      .catch(() => {
        /* keep defaults on load failure */
      });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await putConfig({ tunnel: { provider, mode } });
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save Gateway settings");
    } finally {
      setSaving(false);
    }
  }, [provider, mode]);

  const Divider = () => <div className="my-5 h-px bg-[var(--border)]" />;

  return (
    <div className="mx-auto max-w-3xl" data-testid="gateway-page">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Gateway</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Expose this dashboard beyond localhost — public proxy or private mesh.
        </p>
      </div>

      <GatewayProviderSection
        provider={provider}
        mode={mode}
        onChange={({ provider: p, mode: m }) => {
          setProvider(p);
          setMode(m);
          setDirty(true);
        }}
        disabled={saving}
      />

      <Divider />
      <GatewayPairQR />

      <Divider />
      <GatewayEndpoints />

      <Divider />
      <GatewaySetupGuide provider={provider} />

      <Divider />
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Trusted networks
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          Who may reach the Gateway without signing in is managed on the{" "}
          <b className="text-[var(--text-primary)]">Security</b> page — trusted networks map to{" "}
          <code className="font-mono text-xs">config.trustedNetworks</code>, shared with the auth system, so they
          live once, not duplicated here.
        </p>
        <button
          type="button"
          data-testid="gateway-page-open-security"
          onClick={() => navigate("/settings/security")}
          className="mt-2 rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
        >
          Open Security →
        </button>
      </div>

      {dirty && (
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
          {saveError && (
            <span className="text-xs text-[var(--danger,#ef4444)]" data-testid="gateway-page-save-error">
              {saveError}
            </span>
          )}
          <button
            type="button"
            data-testid="gateway-page-save"
            disabled={saving}
            onClick={() => void save()}
            className="rounded bg-[var(--accent,#3b82f6)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
