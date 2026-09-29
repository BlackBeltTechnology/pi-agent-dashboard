import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiQrcode, mdiTunnel } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { ToastVariant } from "../../hooks/useAsyncAction.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { gatewayIndicator } from "../../lib/gateway/gateway-connection.js";
import { logRejection } from "../../lib/report-error.js";
import { GatewayDialog } from "../Gateway/GatewayDialog.js";

const POLL_INTERVAL = 30_000;

/**
 * Toolbar **Gateway** button (user-facing label: "Gateway"; the wire keeps
 * `tunnel`). Opens the tabbed Gateway dialog (Setup / Access & QR / Security).
 * When the Gateway is not set up at all, routes to the Gateway settings page.
 *
 * See change: add-tunnel-providers.
 */
export function TunnelButton(_props: { showToast?: (text: string, variant?: ToastVariant) => void } = {}) {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, navigate] = useLocation();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tunnel-status`);
      if (res.ok) {
        const data = (await res.json()) as TunnelStatus;
        setStatus(data);
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  useEffect(() => {
    void fetchStatus().catch(logRejection("TunnelButton.fetchStatus"));
    const id = setInterval(() => { void fetchStatus().catch(logRejection("TunnelButton.poll")); }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleClick = useCallback(async () => {
    const s = await fetchStatus();
    // "Not set up" only when NO provider is planned or up - a tailscale-only
    // Gateway is set up even though zrok (the `status` projection) is absent.
    if (gatewayIndicator(s).tone === "unset") {
      navigate("/settings/gateway");
    } else {
      setDialogOpen(true);
    }
  }, [fetchStatus, navigate]);

  // Across ALL planned providers (`gateway` counts), not only zrok.
  const { tone, title } = gatewayIndicator(status);
  const iconPath = tone === "unset" ? mdiTunnel : mdiQrcode;
  const color =
    tone === "ok"
      ? "text-green-400"
      : tone === "partial"
        ? "text-amber-400"
        : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]";

  return (
    <>
      <button type="button" onClick={handleClick} className={color} title={title} data-testid="tunnel-btn" data-tone={tone}>
        <Icon path={iconPath} size={0.6} />
      </button>
      {dialogOpen && <GatewayDialog onClose={() => setDialogOpen(false)} />}
    </>
  );
}
