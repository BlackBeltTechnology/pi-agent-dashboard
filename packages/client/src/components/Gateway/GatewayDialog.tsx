/**
 * Tabbed **Gateway** dialog (task 9.3) — Setup / Access & QR (QR first) /
 * Security. The "do it now" surface reachable from the toolbar button. All
 * user-facing strings say "Gateway"; the wire keeps `tunnel`.
 *
 * Provider/mode selection persists through the auth-gated `PUT /api/config`
 * (`tunnel` is deep-merged, so a partial `{ tunnel: { provider, mode } }` is
 * safe). Composes the reusable section components.
 *
 * See change: add-tunnel-providers.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { TunnelMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { disconnectTunnel, getConfig, getTunnelStatus, putConfig } from "../../lib/gateway/gateway-api.js";
import type { GatewayProviderId } from "../../lib/gateway/gateway-providers.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { GatewayEndpoints } from "./GatewayEndpoints.js";
import { GatewayPairQR } from "./GatewayPairQR.js";
import { GatewayProviderSection } from "./GatewayProviderSection.js";
import { GatewayReadinessBoard } from "./GatewayReadinessBoard.js";
import { GatewayDegradedBanner, GatewayReservedName } from "./GatewayReservedName.js";
import { GatewaySetupGuide } from "./GatewaySetupGuide.js";

type Tab = "setup" | "access" | "security";

export function GatewayDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("access");
  const [provider, setProvider] = useState<GatewayProviderId>("zrok");
  const [mode, setMode] = useState<TunnelMode>("public");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservedName, setReservedNameState] = useState<string | undefined>();
  const [degraded, setDegraded] = useState<{ configuredName: string; effectiveName?: string } | undefined>();

  useEffect(() => {
    void getConfig()
      .then((cfg) => {
        const tunnel =
          (cfg.tunnel as {
            provider?: GatewayProviderId;
            mode?: TunnelMode;
            zrok?: { reservedName?: string };
          }) ?? {};
        if (tunnel.provider) setProvider(tunnel.provider);
        if (tunnel.mode) setMode(tunnel.mode);
        setReservedNameState(tunnel.zrok?.reservedName);
      })
      .catch(() => {
        /* keep defaults on load failure */
      });
    // The degraded signal is a server-side reconciliation of stored-vs-served
    // name, so it is read from status rather than recomputed here.
    void getTunnelStatus()
      .then((s) => setDegraded(s?.status === "active" ? s.degraded : undefined))
      .catch(() => {
        /* absence of a status is not a degradation */
      });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await putConfig({ tunnel: { provider, mode } });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gateway.err.saveFailed", undefined, "save failed"));
    } finally {
      setSaving(false);
    }
  }, [provider, mode]);

  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <button
      type="button"
      data-testid={`gateway-tab-${id}`}
      aria-pressed={tab === id}
      onClick={() => setTab(id)}
      className={`border-b-2 px-3.5 py-2.5 text-[12.5px] font-medium ${
        tab === id
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Dialog open onClose={onClose} title={t("gateway.title", undefined, "Gateway")} size="lg" testId="gateway-dialog">
      <div className="mb-3 flex gap-1 border-b border-[var(--border-primary)]">
        <TabButton id="setup" label={t("gateway.tab.setup", undefined, "Setup")} />
        <TabButton id="access" label={t("gateway.tab.access", undefined, "Access & QR")} />
        <TabButton id="security" label={t("gateway.tab.security", undefined, "Security")} />
      </div>

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === "setup" && (
          <div className="space-y-4">
            {/* Polling is bound to `tab === "setup"`, not merely to the dialog:
                a tick shells out per provider, so it must not run while the
                operator is reading the QR or Security panes. */}
            <GatewayReadinessBoard
              open={tab === "setup"}
              primary={provider}
              onSelectProvider={(id) => setProvider(id as GatewayProviderId)}
            />
            <div className="h-px bg-[var(--border-primary)]" />
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
            <div className="h-px bg-[var(--border-primary)]" />
            <GatewayDegradedBanner degraded={degraded} />
            {provider === "zrok" && (
              <>
                <GatewayReservedName
                  stored={reservedName}
                  onStoredChange={setReservedNameState}
                  disabled={saving}
                />
                <div className="h-px bg-[var(--border-primary)]" />
              </>
            )}
            <GatewaySetupGuide provider={provider} />
          </div>
        )}
        {tab === "access" && (
          <div className="space-y-4">
            <GatewayPairQR />
            <div className="h-px bg-[var(--border-primary)]" />
            <GatewayEndpoints />
          </div>
        )}
        {tab === "security" && (
          <div className="space-y-3" data-testid="gateway-security-pane">
            <p className="text-sm text-[var(--text-secondary)]">
              {t(
                "gateway.trustedNetworks.lead",
                undefined,
                "Who may reach the Gateway without signing in is managed on the ",
              )}
              <b className="text-[var(--text-primary)]">{t("gateway.trustedNetworks.securityWord", undefined, "Security")}</b>
              {t("gateway.trustedNetworks.mapTo", undefined, " page — trusted networks map to ")}
              <code className="font-mono text-xs">config.trustedNetworks</code>
              {t(
                "gateway.trustedNetworks.tailDialog",
                undefined,
                ", shared with the auth system, so they live once (no duplicate here).",
              )}
            </p>
            <button
              type="button"
              data-testid="gateway-open-security"
              onClick={() => {
                onClose();
                navigate("/settings/security");
              }}
              className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            >
              {t("gateway.openSecurity", undefined, "Open Security →")}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-primary)] pt-3">
        <span className="flex-1" />
        {error && (
          <span className="text-xs text-[var(--danger,#ef4444)]" data-testid="gateway-dialog-error">
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid="gateway-disconnect"
          onClick={() =>
            void disconnectTunnel().catch((e) =>
              setError(e instanceof Error ? e.message : t("gateway.err.disconnectFailed", undefined, "disconnect failed")),
            )
          }
          className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--danger,#ef4444)]"
        >
          {t("gateway.disconnect", undefined, "Disconnect")}
        </button>
        {/* Releasing a reserved name is IRREVERSIBLE: the name returns to zrok's
            global pool and anyone may claim it. Confirm-gated, zrok-only, and
            the copy names the exact URL being destroyed rather than "the
            reserved URL". See change: add-zrok-custom-reserved-name (4.4). */}
        {provider === "zrok" && reservedName && (
          <button
            type="button"
            data-testid="gateway-forget-reserved"
            onClick={() => {
              if (
                !globalThis.confirm?.(
                  t(
                    "gateway.confirmRelease",
                    { url: `https://${reservedName}.shares.zrok.io` },
                    `Release https://${reservedName}.shares.zrok.io? The name returns to zrok's global pool and anyone may claim it. Anyone you shared that URL with will no longer reach this dashboard.`,
                  ),
                )
              ) {
                return;
              }
              void disconnectTunnel({ forget: true })
                .then(() => setReservedNameState(undefined))
                .catch((e) =>
                  setError(
                    e instanceof Error ? e.message : t("gateway.err.disconnectFailed", undefined, "disconnect failed"),
                  ),
                );
            }}
            className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--severity-error-fg)]"
          >
            {t("gateway.releaseReserved", undefined, "Release reserved URL")}
          </button>
        )}
        {dirty ? (
          <button
            type="button"
            data-testid="gateway-save"
            disabled={saving}
            onClick={() => void save()}
            className="rounded bg-[var(--accent-solid)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? t("gateway.saving", undefined, "Saving…") : t("gateway.save", undefined, "Save")}
          </button>
        ) : (
          <button
            type="button"
            data-testid="gateway-done"
            onClick={onClose}
            className="rounded bg-[var(--accent-solid)] px-4 py-1.5 text-sm font-semibold text-white"
          >
            {t("gateway.done", undefined, "Done")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
