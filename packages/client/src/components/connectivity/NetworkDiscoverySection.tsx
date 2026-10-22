/**
 * Network discovery as a SOURCE of the Settings ▸ Servers section (not a section of its own).
 *
 * This module holds the discovery-specific pieces the merged section (`KnownServersSection`)
 * composes: the scan button with its polite live region and error callout, the empty-result
 * diagnostic (reasons collapsed in a disclosure) and the inline manual-add form that stays visible
 * without expanding it. Scan results themselves are routes on the identity cards.
 *
 * Many Wi-Fi routers block client-to-client multicast, so a scan that finds nothing is common; the
 * diagnostic explains why and the manual-add form lets users on the same LAN register remote
 * dashboards by address (`http://` or `https://`, parsed by `parseRouteInput`).
 *
 * See change: retro-ux-identity-connectivity (contract tokens, live status, surfaced failures,
 * collapsed diagnostic), group-servers-by-identity (merged into the Servers section; https add).
 */

import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { type RouteScheme, routeKey } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { mdiAlertCircleOutline, mdiInformationOutline, mdiPlus, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useState } from "react";
import { addKnownServer, discoverServers } from "../../lib/api/known-servers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { parseRouteInput } from "../../lib/util/parse-host-input.js";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  BTN_SMALL_GHOST,
  callout,
  errorMessage,
  HELP,
  INPUT,
  INSET,
  LABEL,
} from "./connectivity-ui.js";

export function DiscoveryDiagnostic() {
  return (
    <div className={callout("info")}>
      <Icon path={mdiInformationOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <strong>{i18nT("connection.noDashboardsViaMdns", undefined, "No dashboards found via mDNS.")}</strong>{" "}
        {i18nT("connection.noDashboardsHint", undefined, "Many networks block it. Add a server by address instead.")}
        <details className="mt-1">
          <summary className="flex min-h-8 cursor-pointer items-center font-semibold underline focus-ring">
            {i18nT("connection.whyDiscoveryFails", undefined, "Why does discovery fail?")}
          </summary>
          {i18nT("tunnel.mdnsDiscoveryOftenFailsAcrossMachines", undefined, "mDNS discovery often fails across machines because of:")}
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>{i18nT("common.wiFi", undefined, "Wi-Fi")} <strong>{i18nT("common.apClientIsolation", undefined, "AP/client isolation")}</strong> {i18nT("common.commonOnConsumerGuestNetworks", undefined, "(common on consumer & guest networks)")}</li>
            <li>{i18nT("common.meshRoutersOrWiFiExtenders", undefined, "Mesh routers or Wi-Fi extenders that drop multicast between nodes")}</li>
            <li>{i18nT("tunnel.differentVlansSubnetsBetweenTheTwo", undefined, "Different VLANs / subnets between the two machines")}</li>
            <li>{i18nT("common.anActiveVpnCapturingTheDefault", undefined, "An active VPN capturing the default route")}</li>
            <li>{i18nT("tunnel.theMacosFirewallBlockingInboundTraffi", undefined, "The macOS firewall blocking inbound traffic on the dashboard port")}</li>
          </ul>
          <div className="mt-2">
            {i18nT("common.ifYouKnowTheServerS", undefined, "If you know the server's IP (e.g.")}{" "}
            <code>192.168.16.202:8000</code>{i18nT("common.addItManuallyBelow", undefined, "),\n                  add it manually below.")}
          </div>
        </details>
      </div>
    </div>
  );
}

/** Text for the polite live region beside the scan button. */
function scanStatusText(o: { scanning: boolean; scanned: boolean; hasError: boolean; found: number }): string {
  if (o.scanning) return i18nT("connection.scanning", undefined, "Scanning…");
  if (!o.scanned) return i18nT("connection.scanIdle", undefined, "Finds other pi dashboards on this network.");
  if (o.hasError) return "";
  if (o.found === 0) return i18nT("connection.foundNone", undefined, "No dashboards found.");
  if (o.found === 1) return i18nT("connection.foundOne", undefined, "Found 1 dashboard.");
  return i18nT("connection.foundMany", { n: o.found }, "Found {n} dashboards.");
}


/** Scan button, its polite live region and (after a failed scan) the error callout with Retry. */
export function ScanBar({
  scanning,
  scanned,
  scanError,
  found,
  onScan,
}: {
  scanning: boolean;
  scanned: boolean;
  scanError: string | null;
  found: number;
  onScan: () => void;
}) {
  const status = scanStatusText({ scanning, scanned, hasError: !!scanError, found });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onScan} disabled={scanning} aria-busy={scanning || undefined} className={BTN_SECONDARY}>
          <Icon path={mdiRefresh} size={0.55} className={scanning ? "animate-spin" : ""} aria-hidden="true" />
          {scanning
            ? i18nT("connection.scanning", undefined, "Scanning…")
            : scanned
              ? i18nT("connection.scanAgain", undefined, "Scan again")
              : i18nT("connection.scanNetwork", undefined, "Scan network")}
        </button>
        <span className={HELP} role="status" aria-live="polite">
          {status}
        </span>
      </div>
      {scanError && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {i18nT("status.scanFailed", undefined, "Scan failed:")} {scanError}
            <div className="mt-1">
              <button type="button" className={BTN_SMALL} onClick={onScan} disabled={scanning}>
                {i18nT("common.retry", undefined, "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ManualRoute = { host: string; port: number; scheme: RouteScheme };

/**
 * Validate the manual-add inputs without a request: a parseable address (and port override), https
 * only against a dashboard server that can store it, and not a route that is already stored.
 * Returns the route to add, or the inline error text.
 */
function validateManualAdd(
  address: string,
  port: string,
  storedKeys: ReadonlySet<string>,
  offerHttpsAdd: boolean,
): { route: ManualRoute } | { error: string } {
  const parsed = parseRouteInput(address);
  const override = port.trim() === "" ? null : Number(port);
  if (!parsed || (override !== null && !(Number.isInteger(override) && override >= 1 && override <= 65535))) {
    return { error: i18nT("connection.manualInvalid", undefined, "Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000") };
  }
  const route: ManualRoute = { host: parsed.host, port: override ?? parsed.port, scheme: parsed.scheme };
  if (route.scheme === "https" && !offerHttpsAdd) {
    return { error: i18nT("connection.manualHttpsUnsupported", undefined, "This dashboard server is too old to store https addresses. Update it first.") };
  }
  if (storedKeys.has(routeKey(route))) {
    return { error: i18nT("connection.manualAlreadyAdded", { address: formatHostPort(route.host, route.port) }, "{address} is already added.") };
  }
  return { route };
}

/**
 * Inline manual-add form: an address (`host`, `host:port`, `http://…` or `https://…`), an optional
 * port that overrides the address's, and an optional label. Invalid input and an already-stored
 * route are reported inline (`aria-invalid` + `aria-describedby`) without a request.
 */
export function ManualAddForm({
  storedKeys,
  offerHttpsAdd,
  onAdded,
  onCancel,
  autoFocus,
}: {
  /** `routeKey` of every stored route — an add of one of these is refused locally. */
  storedKeys: ReadonlySet<string>;
  /** False for a dashboard server older than routes: it would store an https add as http. */
  offerHttpsAdd: boolean;
  onAdded: () => void;
  /** When given, the form can be dismissed (the "Add server manually" form); the scan diagnostic's form cannot. */
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const checked = validateManualAdd(address, port, storedKeys, offerHttpsAdd);
    if ("error" in checked) return setError(checked.error);
    const { route } = checked;
    setError(null);
    setBusy(true);
    try {
      const name = label.trim() || undefined;
      if (route.scheme === "https") await addKnownServer(route.host, route.port, name, undefined, "https");
      else await addKnownServer(route.host, route.port, name);
      setAddress("");
      setPort("");
      setLabel("");
      onAdded();
    } catch (e) {
      setError(errorMessage(e, i18nT("connection.manualFailed", undefined, "Failed to add server")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`space-y-2 ${INSET}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit().catch(logRejection("ManualAddForm.submit"));
      }}
    >
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_6rem_9rem_auto]">
        <div className="min-w-0">
          <label htmlFor="servers-add-address" className={LABEL}>{i18nT("connection.address", undefined, "Address")}</label>
          <input
            id="servers-add-address"
            type="text"
            placeholder={i18nT("common.192168162028000Or", undefined, "192.168.16.202:8000  or  http://host:8000")}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "servers-add-error" : undefined}
            className={INPUT}
            autoFocus={autoFocus}
          />
        </div>
        <div>
          <label htmlFor="servers-add-port" className={LABEL}>{i18nT("connection.portOptional", undefined, "Port (optional)")}</label>
          <input
            id="servers-add-port"
            type="number"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className={`${INPUT} text-right`}
          />
        </div>
        <div>
          <label htmlFor="servers-add-label" className={LABEL}>{i18nT("common.labelOptional", undefined, "Label (optional)")}</label>
          <input id="servers-add-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onCancel && (
            <button type="button" onClick={onCancel} className={BTN_SMALL_GHOST}>
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
          )}
        <button type="submit" disabled={busy || !address.trim()} className={BTN_PRIMARY}>
          <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
          {i18nT("connection.addServer", undefined, "Add server")}
        </button>
        </div>
      </div>
      {error && (
        <div id="servers-add-error" className="text-[11px] text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

/** The scan of Settings ▸ Servers: results, in-flight / completed flags and the error text. A failed scan counts as completed. */
export function useDiscoveryScan(alive: { current: boolean }) {
  const [discovered, setDiscovered] = useState<DiscoveredServerInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const found = await discoverServers();
      if (alive.current) setDiscovered(found);
    } catch (e) {
      if (alive.current) {
        setDiscovered([]);
        setScanError(errorMessage(e, i18nT("connection.scanFailedFallback", undefined, "Scan failed")));
      }
    } finally {
      if (alive.current) {
        setScanned(true);
        setScanning(false);
      }
    }
  }, [alive]);

  return { discovered, scanning, scanned, scanError, scan };
}
