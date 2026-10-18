import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../../hooks/useWebSocket.js";
import { getApiBase, useApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { requestAccessTarget } from "../../lib/pairing/request-access-target.js";

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
  // The server that denied us: "" = the page's own origin, else that server's http base.
  const apiBase = useApiBase() || getApiBase();

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
    // Same-origin denial → the request page on this origin; otherwise the denying
    // (active) server's own request page in a new context without an opener.
    // See change: add-lan-knock-pairing (design D10).
    const requestAccess = () => {
      const { href, newContext } = requestAccessTarget(apiBase, window.location.origin);
      if (newContext) window.open(href, "_blank", "noopener");
      else window.location.assign(href);
    };
    return (
      <div
        role="alert"
        className="flex w-full flex-wrap items-center gap-2 border-b border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-4 py-2 text-sm text-[var(--severity-warning-fg)]"
      >
        <span className="flex min-w-[12rem] flex-1 items-start gap-1.5">
          <Icon path={mdiAlertOutline} size={0.7} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            <strong>{i18nT("common.networkNotAllowed", undefined, "Network not allowed")}</strong>
            {networkDenied.hint ? <> — {networkDenied.hint}</> : null}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="network-denied-request-access"
            onClick={requestAccess}
            className="focus-ring min-h-[44px] cursor-pointer rounded-md border border-[var(--accent-solid)] bg-[var(--accent-solid)] px-2.5 text-xs font-semibold text-white sm:min-h-[32px]"
          >
            {i18nT("connection.requestAccess", undefined, "Request access")}
          </button>
          {onOpenServers && (
            <button
              type="button"
              onClick={onOpenServers}
              className="focus-ring min-h-[44px] cursor-pointer rounded-md border border-[var(--severity-warning-border)] px-2.5 text-xs font-semibold text-[var(--severity-warning-fg)] sm:min-h-[32px]"
            >
              {i18nT("settings.settingsServers", undefined, "Settings → Servers")}
            </button>
          )}
        </span>
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
