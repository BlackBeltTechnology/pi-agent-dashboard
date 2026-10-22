import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { formatHostPort, normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiAlertOutline,
  mdiAccessPointNetwork,
  mdiAlertCircle,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiCloseCircleOutline,
  mdiCloudOffOutline,
  mdiCog,
  mdiLoading,
  mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { acceptKnownServerMove, listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";
import { getOpenServerWindow } from "../../lib/electron-server-windows.js";
import { describeOpenFailure } from "../../lib/open-server-window-failure.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import type { RemoteAccessTone } from "../../lib/gateway/gateway-connection.js";
import { identityPill, type Severity, severityPill } from "./connectivity-ui.js";

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

/**
 * Probe outcome for a selector entry.
 *
 * `cors-blocked` = the dashboard SERVER reaches the target but this browser
 * cannot; `name-not-resolved` = the server cannot resolve the stored name
 * (rendered as "Moved to …" when a verified move suggestion exists).
 * See change: stabilize-mdns-server-identity.
 */
type ProbeState = "available" | "unreachable" | "denied" | "cors-blocked" | "name-not-resolved";

/**
 * An extra row rendered in the menu's "Access" group, after "Manage servers…".
 * `onSelect` receives THIS chip instance's trigger element (App can mount two
 * chips: desktop sidebar + mobile overlay). See change: declutter-sidebar-header.
 */
export interface AccessItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: string;
  badge?: number;
  testId: string;
  /** Extra `data-tone` for the row (Remote access keeps it). */
  tone?: string;
  /** True → the item opens a dialog that takes focus; the menu closes without focusing the trigger. */
  opensDialog?: boolean;
  onSelect: (trigger: HTMLButtonElement) => void;
}

/** Remote-access summary shown on the chip (tone glyph + waiting badge + accessible name). */
interface RemoteAccessChipState {
  tone: RemoteAccessTone;
  /** Bare state phrase, e.g. `failed`. */
  state: string;
  pending: number;
}

/** Tone glyphs — each a different shape; `local`/`network` are quiet (no glyph). */
const TONE_GLYPH: Partial<Record<RemoteAccessTone, string>> = {
  internet: mdiAccessPointNetwork,
  partial: mdiAlertOutline,
  failed: mdiAlertCircle,
};

interface Props {
  /** Remote-access summary for the chip (glyph, badge, accessible name). */
  remoteAccess?: RemoteAccessChipState;
  /** Rows appended to the menu after "Manage servers…", in an "Access" group. */
  accessItems?: AccessItem[];
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
  /**
   * Surfaces an error toast. Used by the Electron branch when the app reports
   * that it could not open a server window. See change: add-electron-server-windows.
   */
  onNotifyError?: (message: string) => void;
}

type ItemState = "checking" | "available" | ProbeState | "moved";

/** Pill + icon + severity + reason for each non-current entry state (text, never colour alone). */
function stateView(state: ItemState, movedAddress?: string): { label: string; severity: Severity; icon: string; reason?: string } {
  switch (state) {
    case "checking":
      return { label: i18nT("connection.checking", undefined, "Checking…"), severity: "neutral", icon: mdiLoading };
    case "available":
      return { label: i18nT("common.available", undefined, "Available"), severity: "success", icon: mdiCheckCircleOutline };
    case "unreachable":
      return {
        label: i18nT("connection.unreachable", undefined, "Unreachable"),
        severity: "error",
        icon: mdiCloseCircleOutline,
        reason: i18nT("connection.unreachableReason", undefined, "No response from this address within 2 s."),
      };
    case "denied":
      return {
        label: i18nT("common.networkNotAllowed", undefined, "Network not allowed"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT(
          "connection.deniedReason",
          undefined,
          "The server is up but does not allow this network. Add it to that server's trusted networks.",
        ),
      };
    case "cors-blocked":
      return {
        label: i18nT("connection.blockedInBrowser", undefined, "Blocked in this browser"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT(
          "connection.corsReason",
          undefined,
          "Reachable from this dashboard, not from this browser (CORS). Allow this origin on the remote.",
        ),
      };
    case "name-not-resolved":
      return {
        label: i18nT("connection.nameNotFound", undefined, "Name not found"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT("connection.nameReason", undefined, "The name no longer resolves — the server may have been renamed."),
      };
    case "moved":
      return {
        label: i18nT("connection.moved", undefined, "Moved"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT("connection.movedReason", { address: movedAddress ?? "" }, "Now at {address} — same server identity."),
      };
  }
}

const ITEM_BASE =
  "focus-ring flex w-full min-h-[44px] items-start gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] aria-[disabled=true]:cursor-not-allowed aria-[disabled=true]:hover:bg-transparent cursor-pointer";

export function ServerSelector({ currentHost, currentPort, connected, onSwitch, onManageServers, inFlightSwitchKey, onNotifyError, remoteAccess, accessItems }: Props) {
  const [open, setOpen] = useState(false);
  const accessLabelId = useId();
  /** "host:port" of an in-flight "open server window" request (Electron branch). */
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set when the menu is opened from the keyboard: focus lands on the first item once the panel is visible. */
  const pendingFocus = useRef(false);
  const { flipUp, maxHeight, anchorRight, maxWidth, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 380,
    minPopoverHeight: 0,
  });
  /** Electron local window: open a server window instead of an in-page switch (capability probe per render). */
  const openServerWindow = getOpenServerWindow();
  const [availability, setAvailability] = useState<Map<string, ProbeState>>(new Map());
  const [knownServers, setKnownServers] = useState<KnownServerListEntry[]>([]);
  /** A refused move acceptance, shown inside the menu (keyed by entry). */
  const [moveRefusal, setMoveRefusal] = useState<string | null>(null);

  // Load known servers from API on mount and when dropdown opens
  const loadKnown = useCallback(async () => {
    try {
      const servers = await listKnownServers();
      setKnownServers(servers);
    } catch {
      // silently ignore — will show localhost only
    }
  }, []);

  useEffect(() => { void loadKnown().catch(logRejection("ServerSelector.loadKnown")); }, [loadKnown]);
  useEffect(() => { if (open) void loadKnown().catch(logRejection("ServerSelector.loadKnown")); }, [open, loadKnown]);

  // Build the display list. The `localhost` "Local" seed is gated on a
  // loopback page origin so remote clients never see a phantom localhost row.
  const originHostname =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  const entries = buildServerEntries(knownServers, currentHost, currentPort, originHostname);
  const currentKey = `${currentHost}:${currentPort}`;

  // Probe availability only when the dropdown opens — once per open.
  // No background probing, no periodic timer, no mount probe.
  // See openspec/changes/safe-server-switch.
  const probeEntry = useCallback((host: string, port: number, isCancelled: () => boolean) => {
    const key = `${host}:${port}`;
    const set = (state: ProbeState) => {
      if (!isCancelled()) setAvailability((prev) => new Map(prev).set(key, state));
    };
    fetch(`http://${formatHostPort(host, port)}/api/health`, { signal: AbortSignal.timeout(2000) })
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
      .then(set)
      .catch(async () => {
        // Transport failure (no readable response): the browser cannot tell a
        // CORS block from a dead name. Ask the dashboard server what it sees
        // and render THAT cause. See change: stabilize-mdns-server-identity.
        // A rejected server probe is "unreachable" (retro-ux #X8).
        const status = await probeKnownServer(host, port).catch(() => null);
        set(
          status === "reachable"
            ? "cors-blocked"
            : status === "name-not-resolved"
            ? "name-not-resolved"
            : "unreachable",
        );
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAvailability(new Map()); // a reopen re-probes: show "Checking…" again, never a stale state
    setMoveRefusal(null);
    for (const s of entries) {
      // Current server's status is derived from `connected` — skip the probe.
      if (`${s.host}:${s.port}` === currentKey) continue;
      probeEntry(s.host, s.port, () => cancelled);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Accept a verified move suggestion, then re-probe the entry at its new address. */
  const handleUpdate = useCallback(
    async (entry: ServerEntry, movedTo: { host: string; port: number }) => {
      setMoveRefusal(null);
      if (!(await acceptKnownServerMove(entry.host, entry.port))) {
        setMoveRefusal(
          i18nT(
            "connection.moveRefused",
            undefined,
            "Couldn't update this server — an operator credential is needed.",
          ),
        );
        return;
      }
      await loadKnown();
      probeEntry(movedTo.host, movedTo.port, () => false);
    },
    [loadKnown, probeEntry],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItems = useCallback(
    (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []),
    [],
  );

  // Keyboard open: focus the first item once the portalled panel is positioned (visible).
  useEffect(() => {
    if (open && triggerRect && pendingFocus.current) {
      pendingFocus.current = false;
      menuItems()[0]?.focus();
    }
  }, [open, triggerRect, menuItems]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      pendingFocus.current = true;
      setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown": return go(at + 1);
      case "ArrowUp": return go(at < 0 ? items.length - 1 : at - 1);
      case "Home": return go(0);
      case "End": return go(items.length - 1);
      case "Escape":
        e.preventDefault();
        return closeToTrigger();
      case "Tab":
        // Focus the trigger and let the browser's own Tab move on from there.
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.click();
        return;
    }
  };

  // Find current entry's display label
  const currentEntry = entries.find((e) => `${e.host}:${e.port}` === currentKey);
  const displayLabel = currentEntry?.label ?? (currentEntry?.isLocal ? "Local" : currentHost);
  const connectionWord = connected
    ? i18nT("connection.connected", undefined, "Connected")
    : i18nT("connection.offlineWord", undefined, "Offline");

  const pending = remoteAccess?.pending ?? 0;
  const toneGlyph = remoteAccess ? TONE_GLYPH[remoteAccess.tone] : undefined;
  const baseLabel = i18nT(
    "connection.selectorLabel",
    { server: displayLabel, state: connectionWord.toLowerCase() },
    "Server: {server}, {state}",
  );
  const raQuiet = !remoteAccess || remoteAccess.tone === "local" || remoteAccess.tone === "network";
  const chipLabel =
    raQuiet && pending === 0
      ? baseLabel
      : [
          baseLabel,
          raQuiet
            ? ""
            : `; ${i18nT("connection.remoteAccessState", { state: remoteAccess?.state ?? "" }, "remote access {state}")}`,
          pending > 0
            ? `${raQuiet ? "; " : ", "}${i18nT(
                pending === 1 ? "connection.deviceWaiting" : "connection.devicesWaiting",
                { count: pending },
                pending === 1 ? "{count} device waiting" : "{count} devices waiting",
              )}`
            : "",
        ].join("");

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        ref={triggerRef}
        // Keyboard activation is handled (and its click suppressed) in onTriggerKeyDown; this is the pointer path.
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKeyDown}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={chipLabel}
        data-testid="connection-chip"
        className="focus-ring relative flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
        title={i18nT("connection.switchServer", undefined, "Switch server")}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-[var(--status-idle)]" : "bg-[var(--status-error)]"}`}
        />
        <span className="min-w-0 max-w-[160px] truncate @max-[399.98px]:hidden">{displayLabel}</span>
        {!connected && (
          <>
            <span className="text-[var(--status-error)] @max-[399.98px]:hidden">{connectionWord}</span>
            <span className="inline-flex @min-[400px]:hidden" data-testid="connection-chip-offline-glyph" title={connectionWord}>
              <Icon path={mdiCloudOffOutline} size={0.55} aria-hidden="true" />
            </span>
          </>
        )}
        {toneGlyph && (
          <span data-testid="connection-chip-tone" data-tone={remoteAccess?.tone} className="inline-flex shrink-0">
            <Icon path={toneGlyph} size={0.55} aria-hidden="true" />
          </span>
        )}
        {pending > 0 && (
          <span
            data-testid="tunnel-btn-badge"
            className="min-w-[14px] rounded-full bg-[var(--accent-solid)] px-1 text-center text-[9px] font-bold leading-[14px] text-white"
          >
            {pending}
          </span>
        )}
        <Icon path={mdiChevronDown} size={0.45} />
      </button>

      {open && (
        <LayerPortal>
        <div
          ref={panelRef}
          role="menu"
          aria-label={i18nT("connection.switchServer", undefined, "Switch server")}
          onKeyDown={onMenuKeyDown}
          onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
          style={{
            width: 380,
            maxHeight,
            maxWidth,
            visibility: triggerRect ? "visible" : "hidden",
            ...(triggerRect
              ? flipUp
                ? { bottom: Math.round(window.innerHeight - triggerRect.top + 4) }
                : { top: Math.round(triggerRect.bottom + 4) }
              : {}),
            ...(triggerRect
              ? anchorRight
                ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
                : { left: Math.round(triggerRect.left) }
              : {}),
          }}
          className="fixed overflow-y-auto z-popover bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg shadow-xl py-1"
        >
          {entries.map((entry, idx) => {
            const key = `${entry.host}:${entry.port}`;
            const isCurrent = key === currentKey;
            const probe = availability.get(key);
            const denied = !isCurrent && probe === "denied";
            const unreachable = !isCurrent && probe === "unreachable";
            const corsBlocked = !isCurrent && probe === "cors-blocked";
            const nameNotResolved = !isCurrent && probe === "name-not-resolved";
            const movedTo = nameNotResolved
              ? knownServers.find(
                  (k) => k.port === entry.port && normalizeHostKey(k.host) === normalizeHostKey(entry.host),
                )?.movedTo
              : undefined;
            const movedAddress = movedTo ? formatHostPort(movedTo.host, movedTo.port) : undefined;
            // Every non-available state disables switching, but each renders distinctly.
            const blocked = denied || unreachable || corsBlocked || nameNotResolved;
            const isSwitching = inFlightSwitchKey === key || openingKey === key;
            const state: ItemState | null = isCurrent
              ? null
              : movedTo
              ? "moved"
              : (probe ?? "checking");
            const view = state ? stateView(state, movedAddress) : null;
            // In the Electron branch an entry still being probed is not activatable either.
            const electronChecking = !!openServerWindow && !isCurrent && !entry.isLocal && state === "checking";
            const name = entry.label ?? entry.host;
            const whyId = `server-why-${idx}`;
            return (
              <React.Fragment key={key}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                tabIndex={-1}
                aria-disabled={blocked || electronChecking ? "true" : undefined}
                aria-describedby={blocked && view?.reason ? whyId : undefined}
                onClick={() => {
                  if (blocked || electronChecking) return;
                  if (isCurrent) {
                    closeToTrigger();
                    return;
                  }
                  // Electron local window: open the remote's own window instead of an in-page
                  // switch (no staging socket, no state swap, no last-server write).
                  // See change: add-electron-server-windows.
                  if (openServerWindow) {
                    if (entry.isLocal) {
                      closeToTrigger();
                      return;
                    }
                    if (openingKey) return; // ignore clicks while a request is in flight
                    setOpeningKey(key);
                    openServerWindow({ host: entry.host, port: entry.port })
                      .then((res) => {
                        if (!res.ok) onNotifyError?.(describeOpenFailure(res.reason, name));
                      })
                      .catch(() => onNotifyError?.(describeOpenFailure("failed", name)))
                      .finally(() => {
                        setOpeningKey(null);
                        closeToTrigger();
                      });
                    return; // the menu stays open so the entry shows its inline progress until resolved
                  }
                  onSwitch(entry.host, entry.port);
                  closeToTrigger();
                }}
                data-unreachable={unreachable || undefined}
                data-denied={denied || undefined}
                data-cors-blocked={corsBlocked || undefined}
                data-name-not-resolved={nameNotResolved || undefined}
                className={`${ITEM_BASE} ${isCurrent ? "shadow-[inset_2px_0_0_var(--accent-primary)]" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 font-semibold ${blocked ? "text-[var(--text-secondary)]" : ""}`}>
                    <span className="truncate">{name}</span>
                    <span className={identityPill(entry.isLocal, true)}>
                      {entry.isLocal ? "Local" : "Remote"}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">{entry.host}:{entry.port}</span>
                  {blocked && view?.reason && (
                    <span id={whyId} className="mt-0.5 block text-xs text-[var(--text-secondary)]">{view.reason}</span>
                  )}
                </span>
                {isSwitching ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--text-secondary)]">
                    <Icon path={mdiLoading} size={0.5} className="animate-spin" aria-hidden="true" />
                    {i18nT("common.switchingU2026", undefined, "Switching\u2026")}
                  </span>
                ) : isCurrent ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--text-secondary)]">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${connected ? "bg-[var(--status-idle)]" : "bg-[var(--status-error)]"}`}
                    />
                    {connectionWord}
                  </span>
                ) : view ? (
                  <span className={severityPill(view.severity, true)}>
                    <Icon path={view.icon} size={0.5} className={state === "checking" ? "animate-spin" : ""} aria-hidden="true" />
                    {view.label}
                  </span>
                ) : null}
              </button>
              {movedTo && movedAddress && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void handleUpdate(entry, movedTo).catch(logRejection("ServerSelector.handleUpdate"))}
                  className={`${ITEM_BASE} !min-h-[36px] items-center pl-6 font-semibold`}
                >
                  <Icon path={mdiRefresh} size={0.5} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {i18nT("connection.updateTo", { name, address: movedAddress }, "Update {name} to {address}")}
                    {moveRefusal && (
                      <span role="alert" className="mt-0.5 block text-xs font-normal text-[var(--severity-error-fg)]">{moveRefusal}</span>
                    )}
                  </span>
                </button>
              )}
              </React.Fragment>
            );
          })}
          {onManageServers && (
            <>
              <hr className="my-1 border-0 border-t border-[var(--border-secondary)]" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { setOpen(false); onManageServers(); }}
                className={`${ITEM_BASE} !min-h-[36px] items-center text-[var(--text-secondary)]`}
              >
                <Icon path={mdiCog} size={0.5} aria-hidden="true" />
                <span>{i18nT("common.manageServers", undefined, "Manage servers…")}</span>
              </button>
            </>
          )}
          {accessItems && accessItems.length > 0 && (
            <>
              <hr className="my-1 border-0 border-t border-[var(--border-secondary)]" />
              <div role="group" aria-labelledby={accessLabelId}>
                <div
                  id={accessLabelId}
                  className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                >
                  {i18nT("connection.access", undefined, "Access")}
                </div>
                {accessItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    data-testid={item.testId}
                    data-tone={item.tone}
                    onClick={() => {
                      const trigger = triggerRef.current;
                      if (item.opensDialog) setOpen(false);
                      else closeToTrigger();
                      if (trigger) item.onSelect(trigger);
                    }}
                    className={`${ITEM_BASE} !min-h-[36px] items-center`}
                  >
                    <Icon path={item.icon} size={0.55} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{item.label}</span>
                      {item.sublabel && <span className="block text-xs text-[var(--text-secondary)]">{item.sublabel}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        </LayerPortal>
      )}
    </div>
  );
}
