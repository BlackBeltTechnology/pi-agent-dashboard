import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../hooks/useWebSocket.js";
import { t as i18nT } from "../lib/i18n";

export interface ConnectionStatusBannerProps {
  status: ConnectionStatus;
  currentServerHost: string;
  /** True while a staging-socket switch is in progress. Suppresses banner. */
  inFlightSwitch: boolean;
  /** Optional callback invoked by the "Switch server" button. */
  onOpenServerSelector?: () => void;
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

  if (!show) return null;

  return (
    <div
      role="alert"
      className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 px-4 py-2 text-sm flex items-center justify-between gap-2"
    >
      <span className="truncate">
        {i18nT("auto.disconnected_from", undefined, "Disconnected from")} <strong>{currentServerHost}</strong>{i18nT("auto.retrying", undefined, ". Retrying…")}
      </span>
      {onOpenServerSelector && (
        <button
          onClick={onOpenServerSelector}
          className="shrink-0 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-medium cursor-pointer"
        >
          {i18nT("auto.switch_server", undefined, "Switch server")}
        </button>
      )}
    </div>
  );
}
