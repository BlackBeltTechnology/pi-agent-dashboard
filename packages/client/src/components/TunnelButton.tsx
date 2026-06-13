import React, { useState, useCallback, useEffect } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import { mdiTunnel, mdiQrcode } from "@mdi/js";
import { useLocation } from "wouter";
import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { QrCodeDialog } from "./QrCodeDialog.js";
import { useAsyncAction, type ToastVariant } from "../hooks/useAsyncAction.js";

const POLL_INTERVAL = 30_000;

/**
 * Unified tunnel/QR button:
 * - unavailable (not set up) → tunnel icon → navigates to setup guide
 * - inactive (set up, not connected) → default QR icon → opens dialog with Connect button
 * - active (connected) → green QR icon → opens dialog with QR code + Disconnect button
 */
export function TunnelButton({ showToast }: { showToast?: (text: string, variant?: ToastVariant) => void } = {}) {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, navigate] = useLocation();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tunnel-status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        return data as TunnelStatus;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  // Poll tunnel status on mount and every 30s
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleClick = useCallback(async () => {
    const s = await fetchStatus();
    if (!s) return;

    if (s.status === "unavailable") {
      navigate("/tunnel-setup");
    } else {
      // active or inactive → open dialog
      setDialogOpen(true);
    }
  }, [fetchStatus, navigate]);

  // Tunnel connect/disconnect are synchronous REST ops (HTTP body carries the
  // result), so confirm:"http" + a success toast is the right shape. The hook
  // disables the dialog buttons while pending and routes failures to a toast.
  // See change: add-async-action-feedback.
  const disconnect = useAsyncAction(
    async () => {
      const res = await fetch(`${getApiBase()}/api/tunnel-disconnect`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect tunnel");
    },
    {
      showToast,
      successToast: "Tunnel disconnected",
      onSuccess: () => { setDialogOpen(false); fetchStatus(); },
    },
  );

  const connect = useAsyncAction(
    async () => {
      const res = await fetch(`${getApiBase()}/api/tunnel-connect`, { method: "POST" });
      const data = res.ok ? await res.json() : null;
      if (!data?.ok) throw new Error(data?.error || "Failed to connect tunnel");
    },
    {
      showToast,
      successToast: "Tunnel connected",
      // Refresh status to pick up the new URL, keep dialog open.
      onSuccess: () => { fetchStatus(); },
    },
  );

  const busy = connect.pending || disconnect.pending;

  const isActive = status?.status === "active";
  const isUnavailable = !status || status.status === "unavailable";

  const iconPath = isUnavailable ? mdiTunnel : mdiQrcode;

  const color = isActive
    ? "text-green-400"
    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]";

  const title = isActive
    ? `Tunnel: ${status.url} (click for QR code)`
    : status?.status === "inactive"
      ? "Tunnel: disconnected (click to connect)"
      : status?.status === "unavailable"
        ? "Tunnel: zrok not installed (click for setup guide)"
        : "Tunnel status";

  const dialogUrl = status?.status === "active" ? status.url : undefined;

  return (
    <>
      <button
        onClick={handleClick}
        className={color}
        title={title}
        data-testid="tunnel-btn"
      >
        <Icon path={iconPath} size={0.6} />
      </button>
      {dialogOpen && (
        <QrCodeDialog
          url={dialogUrl}
          connected={isActive}
          onClose={() => setDialogOpen(false)}
          onDisconnect={disconnect.bind.onClick}
          onConnect={connect.bind.onClick}
          busy={busy}
          onSetup={() => { setDialogOpen(false); navigate("/tunnel-setup"); }}
        />
      )}
    </>
  );
}
