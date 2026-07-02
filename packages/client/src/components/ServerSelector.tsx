import React, { useState, useRef, useEffect, useCallback } from "react";
import { Icon } from "@mdi/react";
import { mdiServerNetwork, mdiChevronDown, mdiCog } from "@mdi/js";
import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { listKnownServers } from "../lib/known-servers-api.js";
import { t as i18nT } from "../lib/i18n";

/** Re-export for backward compat — consumers that imported this type */
export interface DiscoveredServerInfo {
  host: string;
  port: number;
  piPort: number;
  version: string;
  pid: number;
  isLocal: boolean;
  source: "mdns" | "fallback";
}

interface ServerEntry {
  host: string;
  port: number;
  label?: string;
  isLocal: boolean;
}

/** Page-origin hostnames treated as loopback for the localhost seed gate. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** True when the page is served from a loopback origin. */
export function isLoopbackOrigin(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** Collapse any loopback alias (127.0.0.1, ::1) to `localhost` for dedup/keys. */
function canonicalLoopbackHost(host: string): string {
  return isLoopbackOrigin(host) ? "localhost" : host;
}

/**
 * Build the selector's display list. Seeds the `localhost` "Local" entry
 * ONLY when the page origin is loopback — a `localhost` probe from a remote
 * browser is meaningless (it targets the browser's own machine). For remote
 * origins the served host is the operative current entry. The current server
 * is always present (appended if not already in the known list).
 * See change: distinguish-offline-from-network-denied.
 */
export function buildServerEntries(
  knownServers: { host: string; port: number; label?: string }[],
  currentHost: string,
  currentPort: number,
  originHostname: string,
): ServerEntry[] {
  const entries: ServerEntry[] = [];
  if (isLoopbackOrigin(originHostname)) {
    entries.push({ host: "localhost", port: currentPort, label: "Local", isLocal: true });
  }
  for (const s of knownServers) {
    if (isLoopbackOrigin(s.host)) continue;
    entries.push({ host: s.host, port: s.port, label: s.label, isLocal: false });
  }
  // Canonicalize loopback aliases so a current host of 127.0.0.1/::1 dedups
  // against the seeded `localhost` row and is classified Local, not Remote.
  const currentKey = `${canonicalLoopbackHost(currentHost)}:${currentPort}`;
  if (!entries.some((e) => `${canonicalLoopbackHost(e.host)}:${e.port}` === currentKey)) {
    const isLocal = isLoopbackOrigin(currentHost);
    entries.push({ host: currentHost, port: currentPort, isLocal });
  }
  return entries;
}

/** Probe outcome for a selector entry. */
type ProbeState = "available" | "unreachable" | "denied";

interface Props {
  /** mDNS-discovered servers — kept for Settings panel, no longer primary data source */
  servers?: DiscoveredServerInfo[];
  currentHost: string;
  currentPort: number;
  connected: boolean;
  onSwitch: (host: string, port: number) => void;
  /** Navigate to server settings */
  onManageServers?: () => void;
  /** "host:port" of an in-flight staging switch; shows a spinner on that entry. */
  inFlightSwitchKey?: string | null;
}

export function ServerSelector({ currentHost, currentPort, connected, onSwitch, onManageServers, inFlightSwitchKey }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [availability, setAvailability] = useState<Map<string, ProbeState>>(new Map());
  const [knownServers, setKnownServers] = useState<KnownServer[]>([]);

  // Load known servers from API on mount and when dropdown opens
  const loadKnown = useCallback(async () => {
    try {
      const servers = await listKnownServers();
      setKnownServers(servers);
    } catch {
      // silently ignore — will show localhost only
    }
  }, []);

  useEffect(() => { loadKnown(); }, [loadKnown]);
  useEffect(() => { if (open) loadKnown(); }, [open, loadKnown]);

  // Build the display list. The `localhost` "Local" seed is gated on a
  // loopback page origin so remote clients never see a phantom localhost row.
  const originHostname =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  const entries = buildServerEntries(knownServers, currentHost, currentPort, originHostname);
  const currentKey = `${currentHost}:${currentPort}`;

  // Probe availability only when the dropdown opens — once per open.
  // No background probing, no periodic timer, no mount probe.
  // See openspec/changes/safe-server-switch.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const s of entries) {
      const key = `${s.host}:${s.port}`;
      // Current server's status is derived from `connected` — skip the probe.
      if (key === currentKey) continue;
      fetch(`http://${s.host}:${s.port}/api/health`, { signal: AbortSignal.timeout(2000) })
        .then(async (r): Promise<ProbeState> => {
          // A guarded response (403 network_not_allowed) means the server is
          // reachable but the client's network/auth is not permitted — a
          // distinct "denied" state, NOT "unreachable".
          if (r.status === 403) {
            const body = await r.json().catch(() => null);
            if (body?.error === "network_not_allowed") return "denied";
            return "unreachable";
          }
          if (!r.ok) return "unreachable";
          const d = await r.json().catch(() => null);
          return d?.ok === true ? "available" : "unreachable";
        })
        .then((state) => {
          if (!cancelled) setAvailability((prev) => new Map(prev).set(key, state));
        })
        .catch(() => {
          // Transport failure (no response) — genuine unreachable.
          if (!cancelled) setAvailability((prev) => new Map(prev).set(key, "unreachable"));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Find current entry's display label
  const currentEntry = entries.find((e) => `${e.host}:${e.port}` === currentKey);
  const displayLabel = currentEntry?.label ?? (currentEntry?.isLocal ? "Local" : currentHost);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
        title={i18nT("auto.switch_server", undefined, "Switch server")}
      >
        <Icon path={mdiServerNetwork} size={0.55} />
        <span className="truncate max-w-[180px]">{displayLabel}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <Icon path={mdiChevronDown} size={0.45} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1">
          {onManageServers && (
            <button
              onClick={() => { setOpen(false); onManageServers(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer border-b border-[var(--border-secondary)] mb-1"
            >
              <Icon path={mdiCog} size={0.45} />
              <span>{i18nT("auto.manage_servers", undefined, "Manage servers…")}</span>
            </button>
          )}
          {entries.map((entry) => {
            const key = `${entry.host}:${entry.port}`;
            const isCurrent = key === currentKey;
            const probe = availability.get(key);
            const denied = !isCurrent && probe === "denied";
            const unreachable = !isCurrent && probe === "unreachable";
            // Both denied and unreachable disable switching, but render distinctly.
            const blocked = denied || unreachable;
            const isSwitching = inFlightSwitchKey === key;
            return (
              <button
                key={key}
                disabled={blocked}
                title={
                  denied
                    ? `${entry.host}:${entry.port}: network not allowed`
                    : unreachable
                    ? `${entry.host}:${entry.port} is unreachable`
                    : undefined
                }
                onClick={() => {
                  if (blocked) return;
                  if (!isCurrent) onSwitch(entry.host, entry.port);
                  setOpen(false);
                }}
                data-unreachable={unreachable || undefined}
                data-denied={denied || undefined}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  isCurrent ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                } ${blocked ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--bg-tertiary)] cursor-pointer"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{entry.label ?? entry.host}</div>
                  <div className="text-[var(--text-tertiary)]">
                    {entry.host}:{entry.port}
                  </div>
                </div>
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    entry.isLocal
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-purple-500/20 text-purple-400"
                  }`}
                >
                  {entry.isLocal ? "Local" : "Remote"}
                </span>
                {isSwitching ? (
                  <span
                    aria-label={i18nT("auto.switching_u2026", undefined, "Switching\\u2026")}
                    className="shrink-0 w-3 h-3 rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent animate-spin"
                  />
                ) : isCurrent ? (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-green-500" : "bg-red-500"}`} />
                ) : denied ? (
                  <span className="shrink-0 text-[10px] text-amber-400">{i18nT("auto.network_not_allowed", undefined, "Network not allowed")}</span>
                ) : unreachable ? (
                  <span className="shrink-0 text-[10px] text-red-400">{i18nT("auto.unreachable", undefined, "Unreachable")}</span>
                ) : probe === "available" ? (
                  <span className="shrink-0 text-[10px] text-green-500">{i18nT("auto.available", undefined, "Available")}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
