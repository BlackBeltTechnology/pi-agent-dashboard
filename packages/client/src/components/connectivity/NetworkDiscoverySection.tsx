/**
 * Settings section for mDNS network discovery.
 * Shows a scan button and discovered servers with "Add" action.
 *
 * When mDNS finds nothing (which is common — many Wi-Fi routers block
 * client-to-client multicast), a diagnostic block explains why and offers
 * an inline manual-add form so users on the same LAN can still register
 * remote dashboards by IP.
 *
 * See change: retro-ux-identity-connectivity (contract tokens, live status,
 * surfaced failures, collapsed diagnostic).
 */

import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { formatHostPort, normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiAlertCircleOutline, mdiCheck, mdiInformationOutline, mdiOpenInNew, mdiPlus, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useState } from "react";
import { addKnownServer, discoverServers } from "../../lib/api/known-servers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { logRejection } from "../../lib/report-error.js";
import { parseHostInput } from "../../lib/util/parse-host-input.js";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  BTN_SMALL_GHOST,
  BTN_SMALL_PRIMARY,
  callout,
  errorMessage,
  HELP,
  INPUT,
  INSET,
  identityPill,
  LABEL,
  META,
  ROW,
} from "./connectivity-ui.js";

interface Props {
  knownServers: KnownServer[];
  onServerAdded: () => void;
}

function DiscoveryDiagnostic() {
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

/**
 * The peer's own request landing; IPv6 literals bracketed by `formatHostPort`.
 * The host comes from mDNS (any LAN device can advertise anything), so the parsed
 * URL must round-trip to exactly the advertised host + port or there is no
 * Connect (a host like `evil.example/x?` or `a@evil.example` would otherwise
 * redirect the jump off the LAN). See change: add-lan-knock-pairing.
 */
function requestPageUrl(server: DiscoveredServerInfo): string | null {
  try {
    const url = new URL(`http://${formatHostPort(server.host, server.port)}/pair?request`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const advertised = server.host.trim().toLowerCase().replace(/^\[|\]$/g, "");
    const sameHost = host === advertised || (advertised.includes(":") && url.hostname === `[${host}]`);
    return sameHost && Number(url.port || 80) === server.port && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function DiscoveredRow({
  server,
  alreadyKnown,
  updated,
  isAdding,
  addLabel,
  error,
  onLabelChange,
  onStart,
  onConfirm,
  onCancel,
}: {
  server: DiscoveredServerInfo;
  alreadyKnown: boolean;
  updated: boolean;
  isAdding: boolean;
  addLabel: string;
  error: string | undefined;
  onLabelChange: (v: string) => void;
  onStart: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const key = `${server.host}:${server.port}`;
  const name = server.name ?? server.host;
  const connectUrl = server.isLocal ? null : requestPageUrl(server);
  return (
    <div className={ROW}>
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
          <span className="truncate">{name}</span>
          <span className={identityPill(server.isLocal)}>
            {server.isLocal ? i18nT("common.localPill", undefined, "Local") : i18nT("common.remote", undefined, "Remote")}
          </span>
        </div>
        <div className={META}>
          {server.name ? `${server.host}:${server.port}` : `:${server.port}`} {i18nT("common.v", undefined, "· v")}{server.version}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!server.isLocal && connectUrl && (
          <button
            type="button"
            data-testid="discovery-connect"
            className={BTN_SMALL}
            aria-label={i18nT("connection.connectAria", { name }, "Connect to {name} (opens in a new tab)")}
            onClick={() => openExternalUrl(connectUrl)}
          >
            {i18nT("connection.connect", undefined, "Connect")}
            <Icon path={mdiOpenInNew} size={0.5} aria-hidden="true" />
          </button>
        )}
        {updated ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--severity-success-fg)]">
            <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
            {i18nT("connection.updatedExistingEntry", undefined, "Updated existing entry")}
          </span>
        ) : alreadyKnown ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--severity-success-fg)]">
            <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
            {i18nT("common.alreadyAdded", undefined, "Already added")}
          </span>
        ) : isAdding ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor={`discovery-label-${key}`} className="sr-only">
              {i18nT("connection.labelFor", { name }, "Label for {name}")}
            </label>
            <input
              id={`discovery-label-${key}`}
              type="text"
              value={addLabel}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder={i18nT("common.label", undefined, "Label")}
              className={`${INPUT} !min-h-[32px] !w-36 !py-0.5 !text-xs`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirm();
                if (e.key === "Escape") onCancel();
              }}
            />
            <button
              type="button"
              className={BTN_SMALL_PRIMARY}
              aria-label={i18nT("connection.confirmAdd", { name }, "Add {name}")}
              onClick={onConfirm}
            >
              <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
              {i18nT("common.add2", undefined, "Add")}
            </button>
            <button
              type="button"
              className={BTN_SMALL_GHOST}
              aria-label={i18nT("connection.cancelAdd", { name }, "Cancel adding {name}")}
              onClick={onCancel}
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className={BTN_SMALL}
            aria-label={i18nT("connection.startAdd", { name, address: key }, "Add {name} ({address})")}
          >
            <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
            {i18nT("common.add2", undefined, "Add")}
          </button>
        )}
      </div>
      {error && (
        <div className="basis-full text-[11px] text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
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

export function NetworkDiscoverySection({ knownServers, onServerAdded }: Props) {
  const [discovered, setDiscovered] = useState<DiscoveredServerInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");
  const [updatedKey, setUpdatedKey] = useState<string | null>(null);
  /** Failed add-confirm, keyed by `host:port`, shown next to that server. */
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  // Manual-add form state (shown when mDNS finds nothing)
  const [manualInput, setManualInput] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const servers = await discoverServers();
      setDiscovered(servers);
      setScanned(true);
    } catch (e) {
      setDiscovered([]);
      setScanned(true);
      setScanError(errorMessage(e, "Scan failed"));
    } finally {
      setScanning(false);
    }
  }, []);

  const isKnown = (host: string, port: number) =>
    knownServers.some((s) => s.port === port && normalizeHostKey(s.host) === normalizeHostKey(host));

  /** Known by address, or by identity: a renamed server keeps its fingerprint + port. */
  const isKnownServer = (server: DiscoveredServerInfo) =>
    isKnown(server.host, server.port) ||
    (!!server.fingerprint && knownServers.some((s) => s.fingerprint === server.fingerprint && s.port === server.port));

  const handleStartAdd = (server: DiscoveredServerInfo) => {
    const key = `${server.host}:${server.port}`;
    setAddingKey(key);
    setAddLabel(server.name ?? server.host);
  };

  const handleConfirmAdd = async (server: DiscoveredServerInfo) => {
    setAddErrors((prev) => {
      const next = { ...prev };
      delete next[`${server.host}:${server.port}`];
      return next;
    });
    try {
      // The advertised fingerprint is a hint: the server pins it only if its challenge proves it.
      const { updated } = await addKnownServer(
        server.host,
        server.port,
        addLabel.trim() || undefined,
        server.fingerprint,
      );
      setUpdatedKey(updated ? `${server.host}:${server.port}` : null);
      setAddingKey(null);
      setAddLabel("");
      onServerAdded();
    } catch (e) {
      setAddErrors((prev) => ({
        ...prev,
        [`${server.host}:${server.port}`]: i18nT("connection.addFailed", { error: errorMessage(e) }, "Could not add: {error}"),
      }));
    }
  };

  const handleCancelAdd = () => {
    setAddingKey(null);
    setAddLabel("");
  };

  const handleManualAdd = async () => {
    setManualError(null);
    const parsed = parseHostInput(manualInput, 8000);
    if (!parsed) {
      setManualError("Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000");
      return;
    }
    if (isKnown(parsed.host, parsed.port)) {
      setManualError(`${parsed.host}:${parsed.port} is already in your known servers.`);
      return;
    }
    setManualBusy(true);
    try {
      await addKnownServer(parsed.host, parsed.port, manualLabel.trim() || undefined);
      setManualInput("");
      setManualLabel("");
      onServerAdded();
    } catch (e) {
      setManualError(errorMessage(e, "Failed to add server"));
    } finally {
      setManualBusy(false);
    }
  };

  const showEmptyDiagnostic = scanned && discovered.length === 0;
  const scanStatus = scanStatusText({ scanning, scanned, hasError: !!scanError, found: discovered.length });
  const submitManual = () => void handleManualAdd().catch(logRejection("NetworkDiscoverySection.handleManualAdd"));

  return (
    <div className="space-y-3">
      {/* Scan button + live status */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleScan} disabled={scanning} aria-busy={scanning || undefined} className={BTN_SECONDARY}>
          <Icon path={mdiRefresh} size={0.55} className={scanning ? "animate-spin" : ""} aria-hidden="true" />
          {scanning
            ? i18nT("connection.scanning", undefined, "Scanning…")
            : scanned
            ? i18nT("connection.scanAgain", undefined, "Scan again")
            : i18nT("connection.scanNetwork", undefined, "Scan network")}
        </button>
        <span className={HELP} role="status" aria-live="polite">
          {scanStatus}
        </span>
      </div>

      {/* Scan error */}
      {scanError && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {i18nT("status.scanFailed", undefined, "Scan failed:")} {scanError}
            <div className="mt-1">
              <button type="button" className={BTN_SMALL} onClick={handleScan} disabled={scanning}>
                {i18nT("common.retry", undefined, "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty diagnostic (collapsed reasons) + manual-add fallback */}
      {showEmptyDiagnostic && (
        <>
          <DiscoveryDiagnostic />

          {/* Manual-add form — visible without expanding the disclosure */}
          <form
            className={`space-y-2 ${INSET}`}
            onSubmit={(e) => {
              e.preventDefault();
              submitManual();
            }}
          >
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_9rem_auto]">
              <div className="min-w-0">
                <label htmlFor="discovery-manual-address" className={LABEL}>{i18nT("connection.address", undefined, "Address")}</label>
                <input
                  id="discovery-manual-address"
                  type="text"
                  placeholder={i18nT("common.192168162028000Or", undefined, "192.168.16.202:8000  or  http://host:8000")}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  aria-invalid={manualError ? true : undefined}
                  aria-describedby={manualError ? "discovery-manual-error" : undefined}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="discovery-manual-label" className={LABEL}>{i18nT("common.labelOptional", undefined, "Label (optional)")}</label>
                <input
                  id="discovery-manual-label"
                  type="text"
                  value={manualLabel}
                  onChange={(e) => setManualLabel(e.target.value)}
                  className={INPUT}
                />
              </div>
              <button type="submit" disabled={manualBusy || !manualInput.trim()} className={BTN_PRIMARY}>
                <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
                {i18nT("common.add2", undefined, "Add")}
              </button>
            </div>
            {manualError && (
              <div id="discovery-manual-error" className="text-[11px] text-[var(--severity-error-fg)]">{manualError}</div>
            )}
          </form>
        </>
      )}

      {/* Discovered servers */}
      {discovered.map((server) => {
        const key = `${server.host}:${server.port}`;
        return (
          <DiscoveredRow
            key={key}
            server={server}
            alreadyKnown={isKnownServer(server)}
            updated={updatedKey === key}
            isAdding={addingKey === key}
            addLabel={addLabel}
            error={addErrors[key]}
            onLabelChange={setAddLabel}
            onStart={() => handleStartAdd(server)}
            onConfirm={() => void handleConfirmAdd(server).catch(logRejection("NetworkDiscoverySection.handleConfirmAdd"))}
            onCancel={handleCancelAdd}
          />
        );
      })}
    </div>
  );
}
