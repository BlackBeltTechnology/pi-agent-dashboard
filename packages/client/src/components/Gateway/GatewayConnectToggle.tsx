/**
 * State-aware Connect ↔ Disconnect for the Gateway (Setup tab + Gateway page).
 *
 * State comes from the gated status detail: `connectedProviders` (what THIS
 * server connected) + `providers` (every planned provider: connected / failed /
 * dropped / idle, with the real reason). Re-read on mount, after every action,
 * and every {@link POLL_MS} while mounted, so a tunnel dropped behind our back
 * (zrok.io removing a share, a process exit) shows without a click. The poll
 * is in-memory on the server (no shell-out). Pure state: `gatewayToggle`.
 */
import type { GatewayProviderState, TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectTunnel, disconnectTunnel, getTunnelStatusDetail } from "../../lib/gateway/gateway-api.js";
import { gatewayToggle } from "../../lib/gateway/gateway-connection.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const POLL_MS = 5_000;

const STATE_COLOR: Record<GatewayProviderState["state"], string> = {
  connected: "var(--severity-success-fg)",
  failed: "var(--severity-error-fg)",
  dropped: "var(--severity-warning-fg)",
  idle: "var(--text-secondary)",
};

export function GatewayConnectToggle({ dirty = false, onChanged }: { dirty?: boolean; onChanged?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TunnelStatusDetail | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A poll landing mid-action would flash the pre-action state; skip it.
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setStatus(await getTunnelStatusDetail().catch(() => null));
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const toggle = gatewayToggle(status, dirty);

  const run = async () => {
    const action = toggle.action;
    busyRef.current = true;
    setBusy(action);
    setError(null);
    try {
      if (action === "connect") await connectTunnel();
      else await disconnectTunnel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await refresh();
      busyRef.current = false;
      setBusy(null);
      onChanged?.();
    }
  };

  const label =
    busy === "connect"
      ? t("gateway.connecting", undefined, "Connecting…")
      : busy === "disconnect"
        ? t("gateway.disconnecting", undefined, "Disconnecting…")
        : toggle.action === "connect"
          ? t("gateway.connect", undefined, "Connect")
          : t("gateway.disconnect", undefined, "Disconnect");

  const STATE_LABEL: Record<GatewayProviderState["state"], string> = {
    connected: t("gateway.state.connected", undefined, "connected"),
    failed: t("gateway.state.failed", undefined, "failed"),
    dropped: t("gateway.state.dropped", undefined, "dropped"),
    idle: t("gateway.state.idle", undefined, "not connected"),
  };

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="gateway-connect-toggle"
      data-action={toggle.action}
      data-partial={toggle.partial ? "true" : "false"}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)]" data-testid="gateway-connect-state" aria-live="polite">
          {toggle.connected.length > 0
            ? t("gateway.connectedTo", { list: toggle.connected.join(", ") }, "Connected: {list}")
            : t("gateway.notConnected", undefined, "Not connected")}
          {toggle.partial && ` · ${t("gateway.partial", undefined, "partial")}`}
        </span>
        {error && (
          <span className="text-xs text-[var(--severity-error-fg)]" data-testid="gateway-connect-error" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid={toggle.action === "connect" ? "gateway-connect" : "gateway-disconnect"}
          disabled={busy !== null || toggle.disabledReason !== null}
          title={toggle.disabledReason ?? undefined}
          onClick={() => void run()}
          className={
            toggle.action === "connect"
              ? "rounded bg-[var(--accent-solid)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              : "rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--severity-error-fg)] disabled:opacity-50"
          }
        >
          {label}
        </button>
      </div>
      {toggle.rows.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="gateway-provider-rows">
          {toggle.rows.map((r) => (
            <li
              key={r.provider}
              data-testid={`gateway-provider-row-${r.provider}`}
              data-state={r.state}
              className="flex items-baseline gap-1.5 text-[11.5px]"
            >
              <span className="font-mono text-[var(--text-primary)]">{r.provider}</span>
              {r.primary && (
                <span className="text-[10px] text-[var(--text-secondary)]">
                  ({t("gateway.readiness.primary", undefined, "Primary")})
                </span>
              )}
              {/* Text carries the state; colour is reinforcement only. */}
              <span style={{ color: STATE_COLOR[r.state] }}>{STATE_LABEL[r.state]}</span>
              {r.error && (
                <span className="min-w-0 truncate text-[var(--text-secondary)]" title={r.error}>
                  — {r.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
