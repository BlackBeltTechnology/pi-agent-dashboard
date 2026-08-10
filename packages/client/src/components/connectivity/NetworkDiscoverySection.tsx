/**
 * Settings section for mDNS network discovery.
 * Shows a scan button and discovered servers with "Add" action.
 *
 * When mDNS finds nothing (which is common — many Wi-Fi routers block
 * client-to-client multicast), a diagnostic block explains why and offers
 * an inline manual-add form so users on the same LAN can still register
 * remote dashboards by IP.
 */

import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiClose,
  mdiPlus,
  mdiRefresh,
  mdiServerNetwork,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { addKnownServer, discoverServers } from "../../lib/api/known-servers-api.js";
import { parseHostInput } from "../../lib/util/parse-host-input.js";

interface Props {
  knownServers: KnownServer[];
  onServerAdded: () => void;
}

export function NetworkDiscoverySection({ knownServers, onServerAdded }: Props) {
  const [discovered, setDiscovered] = useState<DiscoveredServerInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");

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
    } catch (e: any) {
      setDiscovered([]);
      setScanned(true);
      setScanError(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const isKnown = (host: string, port: number) =>
    knownServers.some((s) => s.host === host && s.port === port);

  const handleStartAdd = (server: DiscoveredServerInfo) => {
    const key = `${server.host}:${server.port}`;
    setAddingKey(key);
    setAddLabel(server.host);
  };

  const handleConfirmAdd = async (server: DiscoveredServerInfo) => {
    try {
      await addKnownServer(server.host, server.port, addLabel.trim() || undefined);
      setAddingKey(null);
      setAddLabel("");
      onServerAdded();
    } catch {
      // ignore
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
    } catch (e: any) {
      setManualError(e?.message ?? "Failed to add server");
    } finally {
      setManualBusy(false);
    }
  };

  const showEmptyDiagnostic = scanned && discovered.length === 0;

  return (
    <div className="space-y-2">
      {/* Scan button */}
      <button
        onClick={handleScan}
        disabled={scanning}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50 cursor-pointer"
      >
        <Icon path={mdiRefresh} size={0.5} className={scanning ? "animate-spin" : ""} />
        {scanning ? "Scanning..." : "Scan network"}
      </button>

      {/* Scan error */}
      {scanError && (
        <div className="text-xs text-red-400 py-1">{i18nT("status.scanFailed", undefined, "Scan failed:")} {scanError}</div>
      )}

      {/* Empty diagnostic + manual-add fallback */}
      {showEmptyDiagnostic && (
        <div className="space-y-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]">
          <div className="flex items-start gap-2">
            <Icon
              path={mdiAlertCircleOutline}
              size={0.6}
              className="text-amber-400 shrink-0 mt-0.5"
            />
            <div className="space-y-1">
              <div className="text-sm text-[var(--text-primary)]">
                {i18nT("tunnel.noServersFoundViaMdns", undefined, "No servers found via mDNS.")}
              </div>
              <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                {i18nT("tunnel.mdnsDiscoveryOftenFailsAcrossMachines", undefined, "mDNS discovery often fails across machines because of:")}
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  <li>{i18nT("common.wiFi", undefined, "Wi-Fi")} <strong>{i18nT("common.apClientIsolation", undefined, "AP/client isolation")}</strong> {i18nT("common.commonOnConsumerGuestNetworks", undefined, "(common on consumer & guest networks)")}</li>
                  <li>{i18nT("common.meshRoutersOrWiFiExtenders", undefined, "Mesh routers or Wi-Fi extenders that drop multicast between nodes")}</li>
                  <li>{i18nT("tunnel.differentVlansSubnetsBetweenTheTwo", undefined, "Different VLANs / subnets between the two machines")}</li>
                  <li>{i18nT("common.anActiveVpnCapturingTheDefault", undefined, "An active VPN capturing the default route")}</li>
                  <li>{i18nT("tunnel.theMacosFirewallBlockingInboundTraffi", undefined, "The macOS firewall blocking inbound traffic on the dashboard port")}</li>
                </ul>
                <div className="mt-2">
                  {i18nT("common.ifYouKnowTheServerS", undefined, "If you know the server's IP (e.g.")}{" "}
                  <code className="text-[var(--text-secondary)]">192.168.16.202:8000</code>{i18nT("common.addItManuallyBelow", undefined, "),\n                  add it manually below.")}
                </div>
              </div>
            </div>
          </div>

          {/* Manual-add form */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={i18nT("common.192168162028000Or", undefined, "192.168.16.202:8000  or  http://host:8000")}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleManualAdd(); }}
                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
              />
              <input
                type="text"
                placeholder={i18nT("common.labelOptional", undefined, "Label (optional)")}
                value={manualLabel}
                onChange={(e) => setManualLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleManualAdd(); }}
                className="w-32 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
              />
              <button
                onClick={handleManualAdd}
                disabled={manualBusy || !manualInput.trim()}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded cursor-pointer"
              >
                <Icon path={mdiPlus} size={0.45} />
                {i18nT("common.add2", undefined, "Add")}
              </button>
            </div>
            {manualError && (
              <div className="text-xs text-red-400">{manualError}</div>
            )}
          </div>
        </div>
      )}

      {/* Discovered servers */}
      {discovered.map((server) => {
        const key = `${server.host}:${server.port}`;
        const alreadyKnown = isKnown(server.host, server.port);
        const isAdding = addingKey === key;

        return (
          <div
            key={key}
            className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]"
          >
            <Icon
              path={mdiServerNetwork}
              size={0.55}
              className={`shrink-0 ${server.isLocal ? "text-blue-400" : "text-purple-400"}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {server.host}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                :{server.port} {i18nT("common.v", undefined, "· v")}{server.version}
              </div>
            </div>

            {alreadyKnown ? (
              <span className="text-xs text-green-500 shrink-0">{i18nT("common.alreadyAdded", undefined, "Already added")}</span>
            ) : isAdding ? (
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder={i18nT("common.label", undefined, "Label")}
                  className="w-28 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmAdd(server);
                    if (e.key === "Escape") handleCancelAdd();
                  }}
                />
                <button
                  onClick={() => handleConfirmAdd(server)}
                  className="text-green-400 hover:text-green-300 cursor-pointer p-0.5"
                  title={i18nT("common.confirm", undefined, "Confirm")}
                >
                  <Icon path={mdiCheck} size={0.45} />
                </button>
                <button
                  onClick={handleCancelAdd}
                  className="text-[var(--text-muted)] hover:text-red-400 cursor-pointer p-0.5"
                  title={i18nT("common.cancel", undefined, "Cancel")}
                >
                  <Icon path={mdiClose} size={0.45} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleStartAdd(server)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0 cursor-pointer"
              >
                <Icon path={mdiPlus} size={0.45} />
                {i18nT("common.add2", undefined, "Add")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
