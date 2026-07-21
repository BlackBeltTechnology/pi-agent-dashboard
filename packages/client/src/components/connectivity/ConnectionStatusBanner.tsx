import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../../hooks/useWebSocket.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export interface ConnectionStatusBannerProps {
  status: ConnectionStatus;
  currentServerHost: string;
  /** True while a staging-socket switch is in progress. Suppresses banner. */
  inFlightSwitch: boolean;
  /** Optional callback invoked by the "Switch server" button. */
  onOpenServerSelector?: () => void;
  /**
   * When set, the failure is a network-guard policy denial (HTTP 403
   * `network_not_allowed`) — NOT a transport outage. Renders a distinct
   * "Network not allowed" surface with the server's remedy `hint`, instead of
   * the "Disconnected / Retrying" offline banner. A health-reachable but
   * browse-denied server is thus never labeled "offline".
   * See change: distinguish-offline-from-network-denied.
   */
  networkDenied?: { hint?: string } | null;
  /** Callback for the "Settings → Servers" affordance in the denied surface. */
  onOpenServers?: () => void;
  /** Injectable for tests. Defaults to 3000ms. */
  thresholdMs?: number;
}

/**
 * Displays a disconnection banner when the active WebSocket has been
 * non-OPEN for longer than `thresholdMs` continuously. Hidden immediately
 * on return to connected. Hidden unconditionally during a staging switch.
 *
 * See openspec/changes/safe-server-switch.
 */
export function ConnectionStatusBanner({
  status,
  currentServerHost,
  inFlightSwitch,
  onOpenServerSelector,
  networkDenied,
  onOpenServers,
  thresholdMs = 3000,
}: ConnectionStatusBannerProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === "connected" || inFlightSwitch) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), thresholdMs);
    return () => clearTimeout(t);
  }, [status, inFlightSwitch, thresholdMs]);

  // A network-guard policy denial is a definitive state — render immediately
  // (no transport threshold delay) and take precedence over the offline
  // banner so a reachable-but-denied server is never labeled "offline".
  // Still suppressed during an in-flight staging switch.
  if (networkDenied && !inFlightSwitch) {
    return (
      <div
        role="alert"
        className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 px-4 py-2 text-sm flex items-center justify-between gap-2"
      >
        <span className="truncate">
          <strong>{i18nT("common.networkNotAllowed", undefined, "Network not allowed")}</strong>
          {networkDenied.hint ? <> — {networkDenied.hint}</> : null}
        </span>
        {onOpenServers && (
          <button
            onClick={onOpenServers}
            className="shrink-0 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-medium cursor-pointer"
          >
            {i18nT("settings.settingsServers", undefined, "Settings → Servers")}
          </button>
        )}
      </div>
    );
  }

  if (!show) return null;

  return (
    <div
      role="alert"
      className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 px-4 py-2 text-sm flex items-center justify-between gap-2"
    >
      <span className="truncate">
        {i18nT("connection.disconnectedFrom", undefined, "Disconnected from")} <strong>{currentServerHost}</strong>{i18nT("status.retrying", undefined, ". Retrying…")}
      </span>
      {onOpenServerSelector && (
        <button
          onClick={onOpenServerSelector}
          className="shrink-0 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-medium cursor-pointer"
        >
          {i18nT("connection.switchServer", undefined, "Switch server")}
        </button>
      )}
    </div>
  );
}
