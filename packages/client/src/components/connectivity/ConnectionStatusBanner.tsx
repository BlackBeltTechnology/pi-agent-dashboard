import { knockRefusalCopy } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { mdiAlertCircleOutline, mdiAlertOutline, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../../hooks/useWebSocket.js";
import { getApiBase, useApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { assignLocation, openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { confirmCodeAriaLabel, formatCountdown, groupConfirmCode } from "../../lib/pairing/knock-format.js";
import { type KnockView, knockViewAt } from "../../lib/pairing/knock-state.js";
import { requestAccessTarget } from "../../lib/pairing/request-access-target.js";

/** Bar recipes per knock state — severity tokens only (no palette classes). */
const BAR = "flex w-full flex-wrap items-center gap-2 border-b px-4 py-2 text-sm";
const BAR_TONE = {
  idle: "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]",
  pending: "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]",
  refused: "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]",
} as const;
const SECONDARY_BORDER = {
  idle: "border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]",
  pending: "border-[var(--severity-info-border)] text-[var(--severity-info-fg)]",
  refused: "border-[var(--severity-error-border)] text-[var(--severity-error-fg)]",
} as const;

/**
 * The knock this tab started on the request page (`sessionStorage`), re-read once
 * a second while a countdown is on screen. `null`-ish when no denial is shown.
 */
function useKnockView(active: boolean): { view: KnockView; now: number } {
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<KnockView>(() => knockViewAt(Date.now()));
  const live = active && view.kind !== "idle";
  useEffect(() => {
    if (!active) return;
    const t = Date.now();
    setNow(t);
    setView(knockViewAt(t));
  }, [active]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setView(knockViewAt(t));
    }, 1000);
    return () => clearInterval(id);
  }, [live]);
  return { view, now };
}

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
  const { view: knock, now } = useKnockView(!!networkDenied && !inFlightSwitch);

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
      if (newContext) openExternalUrl(href);
      else assignLocation(href);
    };
    const tone = knock.kind;
    return (
      <div
        role={tone === "pending" ? "status" : "alert"}
        data-testid={
          tone === "pending"
            ? "network-denied-request-pending"
            : tone === "refused"
              ? "network-denied-request-refused"
              : "network-denied-banner"
        }
        className={`${BAR} ${BAR_TONE[tone]}`}
      >
        <span className="flex min-w-[12rem] flex-1 items-start gap-1.5">
          <Icon
            path={tone === "pending" ? mdiInformationOutline : tone === "refused" ? mdiAlertCircleOutline : mdiAlertOutline}
            size={0.7}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {knock.kind === "pending" ? (
              <>
                <strong>
                  {i18nT("connection.requestAccess.waiting", { host: currentServerHost }, "Waiting for approval on {host}.")}
                </strong>{" "}
                {i18nT("connection.requestAccess.typeCode", undefined, "Type")}{" "}
                <span
                  role="img"
                  aria-label={confirmCodeAriaLabel(knock.confirmCode)}
                  className="whitespace-pre font-mono text-base font-bold tracking-widest"
                >
                  {groupConfirmCode(knock.confirmCode)}
                </span>{" "}
                {i18nT(
                  "connection.requestAccess.typeCodeThere",
                  { time: formatCountdown(knock.expiresAt - now) },
                  "there to let this device in. Expires in {time}.",
                )}
              </>
            ) : knock.kind === "refused" ? (
              <RefusalReason code={knock.code} remainingMs={knock.cooldownUntil ? knock.cooldownUntil - now : 0} />
            ) : (
              <>
                <strong>{i18nT("common.networkNotAllowed", undefined, "Network not allowed")}</strong>
                {networkDenied.hint ? <> — {networkDenied.hint}</> : null}
              </>
            )}
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
              className={`focus-ring min-h-[44px] cursor-pointer rounded-md border px-2.5 text-xs font-semibold sm:min-h-[32px] ${SECONDARY_BORDER[tone]}`}
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

/** The refusal the server returned, in the shared knock wording (same text as the request page). */
function RefusalReason({ code, remainingMs }: { code: string; remainingMs: number }) {
  const copy = knockRefusalCopy(code);
  return <>{i18nT(copy.key, { time: formatCountdown(remainingMs) }, copy.fallback)}</>;
}
