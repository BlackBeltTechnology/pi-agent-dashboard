import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiQrcode, mdiTunnel } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { ToastVariant } from "../../hooks/useAsyncAction.js";
import { getApiBase } from "../../lib/api/api-context.js";
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
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleClick = useCallback(async () => {
    const s = await fetchStatus();
    if (s?.status === "unavailable") {
      navigate("/settings/gateway");
    } else {
      setDialogOpen(true);
    }
  }, [fetchStatus, navigate]);

  const isActive = status?.status === "active";
  const isUnavailable = !status || status.status === "unavailable";
  const iconPath = isUnavailable ? mdiTunnel : mdiQrcode;
  const color = isActive
    ? "text-green-400"
    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]";
  const title = isActive
    ? `Gateway: ${status.url} (click to open)`
    : status?.status === "inactive"
      ? "Gateway: disconnected (click to configure)"
      : status?.status === "unavailable"
        ? "Gateway: not set up (click for setup)"
        : "Gateway status";

  return (
    <>
      <button type="button" onClick={handleClick} className={color} title={title} data-testid="tunnel-btn">
        <Icon path={iconPath} size={0.6} />
      </button>
      {dialogOpen && <GatewayDialog onClose={() => setDialogOpen(false)} />}
    </>
  );
}
