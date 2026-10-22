import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  normalizeHost,
  type PairAction,
  type PairClient,
  primaryRoute,
  type Route,
} from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import {
  mdiAccessPointNetwork,
  mdiAccountKeyOutline,
  mdiAlertCircle,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiCloseCircleOutline,
  mdiCog,
  mdiFingerprint,
  mdiLaptop,
  mdiLaptopOff,
  mdiLoading,
  mdiQrcode,
  mdiRefresh,
  mdiServerNetwork,
  mdiServerNetworkOff,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { acceptKnownServerMove, listKnownServers, probeKnownServer, probeKnownServerResult } from "../../lib/api/known-servers-api.js";
import { getListServers, getOpenServerWindow, getPairWithCode } from "../../lib/electron-server-windows.js";
import type { RemoteAccessTone } from "../../lib/gateway/gateway-connection.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { describeOpenFailure } from "../../lib/open-server-window-failure.js";
import { logRejection } from "../../lib/report-error.js";
import { buildServerList, type ElectronServersState, type ListEntry } from "../../lib/server-list-model.js";
import { createRouteChecker, type RouteCheck, type RouteChecker } from "../../lib/server-route-check.js";
import { identityPill, type Severity, severityPill } from "./connectivity-ui.js";
import { RouteChip, type RouteExplain, routeKindLabel, shortFingerprint } from "./server-route-chips.js";

/** Re-export for backward compat — consumers that imported this type */
export interface DiscoveredServerInfo {
  host: string;
  port: number;
  piPort: number;
  version: string;
  pid: number;
  isLocal: boolean;
  source: "mdns" | "fallback";
  /** Advertised identity fingerprint — a hint that decides which row the address is shown under, never proof. */
  fingerprint?: string;
  /** Advertised display name. */
  name?: string;
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
 * Kind of the CURRENT server for the chip glyph: the resolved entry's `isLocal`,
 * or a loopback host (covers the `127.0.0.1` / `[::1]` origin whose entry key
 * does not match the seeded `localhost` row). `new URL().hostname` yields
 * `[::1]`, so IPv6 brackets are stripped first.
 * See change: polish-sidebar-header-controls (D5).
 */
export function currentServerKind(
  currentEntry: { isLocal: boolean } | undefined,
  currentHost: string,
): "local" | "remote" {
  const host = currentHost.replace(/^\[(.*)\]$/, "$1");
  // `||`, not `??`: a bracketed `[::1]` current host is appended by `buildServerEntries` as `isLocal: false`
  // (its own loopback check does not strip brackets), so the entry flag alone would call the local dashboard remote.
  return currentEntry?.isLocal || isLoopbackOrigin(host) ? "local" : "remote";
}

/**
 * The state of one non-current row, summarised from its routes' checks (identity
 * challenge + access) and, for a route this browser could not reach, the
 * dashboard SERVER's own probe: `cors-blocked` = the server reaches it but this
 * browser cannot; `name-not-resolved` = the server cannot resolve the stored
 * name (rendered as "Moved to …" when a verified move suggestion exists).
 * See change: stabilize-mdns-server-identity, group-servers-by-identity (D2).
 */
type RowState =
  | "checking"
  | "available"
  | "unreachable"
  | "denied"
  | "cors-blocked"
  | "name-not-resolved"
  | "moved"
  | "different-identity"
  | "invalid-proof"
  | "cant-prove"
  | "cant-prove-browser";

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
  /** mDNS-discovered peers: each becomes a route of the identity it advertises (or its own row). */
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
  /**
   * Browser "Pair with code…" (the dialog lives in Settings ▸ Servers); when omitted the action opens
   * Manage servers. Electron uses `piDashboard.pairWithCode` instead.
   */
  onPairWithCode?: (target: { fingerprint: string; name: string }) => void;
}

/** Pill + icon + severity + reason for each non-current entry state (text, never colour alone). */
function stateView(state: RowState, movedAddress?: string): { label: string; severity: Severity; icon: string; reason?: string } {
  switch (state) {
    case "checking":
      return {
        label: i18nT("connection.checking", undefined, "Checking…"),
        severity: "neutral",
        icon: mdiLoading,
        reason: i18nT("connection.checkingReason", undefined, "Checking each address of this server."),
      };
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
    case "different-identity":
      return {
        label: i18nT("connection.differentIdentity", undefined, "Different identity"),
        severity: "error",
        icon: mdiAlertCircle,
        reason: i18nT("connection.differentIdentityReason", undefined, "Every address answered as a different server than the one saved. Nothing is sent to it."),
      };
    case "invalid-proof":
      return {
        label: i18nT("connection.invalidProof", undefined, "Invalid identity proof"),
        severity: "error",
        icon: mdiAlertCircle,
        reason: i18nT("connection.invalidProofReason", undefined, "The answer's identity signature did not verify. Nothing is sent to it."),
      };
    case "cant-prove":
      return {
        label: i18nT("connection.cantProve", undefined, "Can't prove identity"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT("connection.cantProveReason", undefined, "This server did not prove who it is (an older version?), so it is not offered as the address to open."),
      };
    case "cant-prove-browser":
      return {
        label: i18nT("connection.cantProveBrowser", undefined, "Can't prove in this browser"),
        severity: "warning",
        icon: mdiAlertOutline,
        reason: i18nT("connection.cantProveBrowserReason", undefined, "This browser cannot verify server identities here (it needs a secure page). Open the dashboard over https to switch."),
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

/** Per-open results: route checks, the server's explanation of unreachable routes, fingerprints it proved (display only). */
interface ProbeResults {
  checks: ReadonlyMap<string, RouteCheck>;
  explain: ReadonlyMap<string, RouteExplain>;
  serverFingerprint: ReadonlyMap<string, string>;
}
const NO_RESULTS: ProbeResults = { checks: new Map(), explain: new Map(), serverFingerprint: new Map() };

/** One open of the menu: its checker (cache + concurrency bound) and the checks it already asked for. */
interface ProbeRound {
  checker: RouteChecker;
  requested: Set<string>;
}

/**
 * The model's saved input: the `localhost` "Local" seed ONLY on a loopback page origin (a remote browser
 * probing `localhost` is meaningless), then the saved servers except loopback ones (the seed holds those).
 * See change: distinguish-offline-from-network-denied.
 */
function savedForModel(known: readonly KnownServerListEntry[], currentPort: number, originHostname: string): KnownServerListEntry[] {
  const out: KnownServerListEntry[] = [];
  if (isLoopbackOrigin(originHostname)) {
    out.push({ host: "localhost", port: currentPort, label: "Local", addedAt: "", routes: [{ host: "localhost", port: currentPort, scheme: "http", source: "saved" }] });
  }
  for (const k of known) if (!isLoopbackOrigin(k.host)) out.push(k);
  return out;
}

/** Summarise a row from its routes' checks; `null` for the dashboard the page is loaded from (its state is the connection). */
function rowState(entry: ListEntry, explain: ReadonlyMap<string, RouteExplain>): RowState | null {
  if (entry.isCurrent) return null;
  switch (entry.status) {
    case "unchecked":
      return "checking";
    case "available":
      return "available";
    case "network-not-allowed":
      return "denied";
    case "refused":
      return entry.routes.some((r) => r.state === "different-identity") ? "different-identity" : "invalid-proof";
    case "cant-prove":
      return "cant-prove";
    case "cant-prove-in-browser":
      return "cant-prove-browser";
    case "unreachable": {
      // The browser could not tell a CORS block from a dead name: the dashboard server's probe says which.
      if (entry.routes.some((r) => explain.get(r.key) === "reachable")) return "cors-blocked";
      const primary = primaryRoute(entry.routes);
      if (primary && explain.get(primary.key) === "name-not-resolved") return entry.movedTo ? "moved" : "name-not-resolved";
      return "unreachable";
    }
  }
}

function pairedText(state: ListEntry["pairedState"]): string {
  switch (state) {
    case "this-dashboard":
      return i18nT("connection.paired.thisDashboard", undefined, "This dashboard");
    case "paired":
      return i18nT("connection.paired.paired", undefined, "Paired");
    case "needs-pairing":
      return i18nT("connection.paired.needsPairing", undefined, "Needs pairing");
    case "not-paired":
      return i18nT("connection.paired.notPaired", undefined, "Not paired");
    case "unknown-in-this-tab":
      return i18nT("connection.paired.unknownInTab", undefined, "Unknown in this tab");
  }
}

function pairActionView(action: PairAction): { label: string; icon: string } {
  switch (action.kind) {
    case "request-access":
      return { label: i18nT("connection.pair.requestAccess", undefined, "Request access…"), icon: mdiAccountKeyOutline };
    case "verify-and-request":
      return { label: i18nT("connection.pair.verifyAndRequest", undefined, "Verify and request access…"), icon: mdiFingerprint };
    case "pair-with-code":
      return { label: i18nT("connection.pair.withCode", undefined, "Pair with code…"), icon: mdiQrcode };
  }
}

export function ServerSelector({ currentHost, currentPort, connected, onSwitch, onManageServers, inFlightSwitchKey, onNotifyError, onPairWithCode, remoteAccess, accessItems, servers }: Props) {
  const [open, setOpen] = useState(false);
  const accessLabelId = useId();
  /** Key of an in-flight "open server window" / pairing bridge request (Electron branch). */
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
  const hasListServers = getListServers() !== undefined;
  const client: PairClient = openServerWindow || hasListServers ? "electron" : "browser";
  const [results, setResults] = useState<ProbeResults>(NO_RESULTS);
  const [knownServers, setKnownServers] = useState<KnownServerListEntry[]>([]);
  const [electronState, setElectronState] = useState<ElectronServersState | null>(null);
  /** A refused move acceptance, shown inside the menu. */
  const [moveRefusal, setMoveRefusal] = useState<string | null>(null);

  // Load known servers from API on mount and when dropdown opens
  const loadKnown = useCallback(async () => {
    try {
      const list = await listKnownServers();
      setKnownServers(list);
    } catch {
      // silently ignore — will show localhost only
    }
  }, []);

  useEffect(() => { void loadKnown().catch(logRejection("ServerSelector.loadKnown")); }, [loadKnown]);
  useEffect(() => { if (open) void loadKnown().catch(logRejection("ServerSelector.loadKnown")); }, [open, loadKnown]);

  // The Electron keyring + discovery state (renderer-safe: no bearer) — read per open.
  useEffect(() => {
    if (!open) return;
    const list = getListServers();
    if (!list) {
      setElectronState(null);
      return;
    }
    let cancelled = false;
    list()
      .then((state) => { if (!cancelled) setElectronState(state); })
      .catch(() => { if (!cancelled) setElectronState(null); });
    return () => { cancelled = true; };
  }, [open]);

  // Build the display list: one row per server identity (saved ∪ discovered ∪ Electron keyring).
  const originHostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const pageScheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "https" : "http";
  const entries = useMemo(
    () => buildServerEntries(knownServers, currentHost, currentPort, originHostname),
    [knownServers, currentHost, currentPort, originHostname],
  );
  const probed = useMemo(() => {
    // A route whose check failed at the transport stays "Checking…" until the server's explanation arrives.
    const checks = new Map<string, RouteCheck>();
    for (const [key, check] of results.checks) {
      if (check.kind === "unreachable" && !results.explain.has(key)) continue;
      checks.set(key, check);
    }
    return checks;
  }, [results]);
  const model = useMemo(
    () =>
      buildServerList({
        client,
        saved: savedForModel(knownServers, currentPort, originHostname),
        discovered: (servers ?? []).filter((s) => !s.isLocal).map((s) => ({ host: s.host, port: s.port, fingerprint: s.fingerprint, name: s.name })),
        electron: electronState,
        current: { host: currentHost, port: currentPort, scheme: pageScheme },
        checks: probed,
      }),
    [client, knownServers, currentPort, originHostname, servers, electronState, currentHost, pageScheme, probed],
  );
  const modelRef = useRef(model);
  modelRef.current = model;
  const currentKey = `${currentHost}:${currentPort}`;

  /** The page's own origin: its status is the connection, so it is never checked. */
  const isCurrentOrigin = (r: Pick<Route, "host" | "port">): boolean => {
    if (r.port !== currentPort) return false;
    const a = normalizeHost(r.host);
    const b = normalizeHost(currentHost);
    return a === b || (isLoopbackOrigin(a) && isLoopbackOrigin(b));
  };

  // Probe only when the dropdown opens — once per open (one checker per open, results cached for it).
  // No background probing, no periodic timer, no mount probe. A late result of an earlier open is
  // ignored (its round is no longer the current one). See openspec/changes/safe-server-switch.
  const round = useRef<ProbeRound | null>(null);
  useEffect(() => {
    if (!open) return;
    const mine: ProbeRound = { checker: createRouteChecker(), requested: new Set() };
    round.current = mine;
    setResults(NO_RESULTS); // a reopen re-probes: show "Checking…" again, never a stale state
    setMoveRefusal(null);
    return () => {
      if (round.current === mine) round.current = null;
    };
  }, [open]);

  // Check every route this open has not asked for yet (the list may arrive after the menu opened).
  const probeSignature = model.entries
    .flatMap((e) => e.routes.filter((r) => !isCurrentOrigin(r)).map((r) => `${r.key}|${e.fingerprint ?? ""}`))
    .join("\n");
  useEffect(() => {
    const mine = round.current;
    if (!open || !mine) return;
    const record = (update: (prev: ProbeResults) => ProbeResults) => {
      if (round.current === mine) setResults(update);
    };
    for (const entry of modelRef.current.entries) {
      for (const route of entry.routes) {
        if (isCurrentOrigin(route)) continue;
        const asked = `${route.key}|${entry.fingerprint ?? ""}`;
        if (mine.requested.has(asked)) continue;
        mine.requested.add(asked);
        void mine.checker
          .check(route, entry.fingerprint)
          .then(async (check) => {
            if (round.current !== mine) return;
            if (check.kind === "cant-prove-in-browser") {
              // No WebCrypto here: the dashboard server's proof is for DISPLAY only; the route stays unusable.
              record((prev) => ({ ...prev, checks: new Map(prev.checks).set(route.key, check) }));
              const result = await probeKnownServerResult(route.host, route.port, route.scheme).catch(() => null);
              if (result?.fingerprint) record((prev) => ({ ...prev, serverFingerprint: new Map(prev.serverFingerprint).set(route.key, result.fingerprint as string) }));
              return;
            }
            if (check.kind !== "unreachable") {
              record((prev) => ({ ...prev, checks: new Map(prev.checks).set(route.key, check) }));
              return;
            }
            // Transport failure: the browser cannot tell a CORS block from a dead name. Ask the dashboard
            // server what it sees and render THAT cause. A rejected server probe is "unreachable" (retro-ux #X8).
            record((prev) => ({ ...prev, checks: new Map(prev.checks).set(route.key, check) }));
            const status = await probeKnownServer(route.host, route.port, route.scheme).catch(() => null);
            record((prev) => ({ ...prev, explain: new Map(prev.explain).set(route.key, status) }));
          })
          .catch(logRejection("ServerSelector.checkRoute"));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, probeSignature]);

  /** Accept a verified move suggestion; the reloaded list carries the new address, which the next effect pass checks. */
  const handleUpdate = useCallback(
    async (entry: ListEntry) => {
      setMoveRefusal(null);
      const primary = primaryRoute(entry.routes);
      if (!primary || !(await acceptKnownServerMove(primary.host, primary.port))) {
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
    },
    [loadKnown],
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

  /** Run a main-window bridge request (open a server window, start pairing); the menu stays open with inline progress until it resolves. */
  const runBridge = (key: string, name: string, call: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    if (openingKey) return; // ignore clicks while a request is in flight
    setOpeningKey(key);
    call()
      .then((res) => {
        if (!res.ok) onNotifyError?.(describeOpenFailure(res.reason, name));
      })
      .catch(() => onNotifyError?.(describeOpenFailure("failed", name)))
      .finally(() => {
        setOpeningKey(null);
        closeToTrigger();
      });
  };

  /** The row's pair action — its own menu item; never part of the row's own activation. */
  const runPairAction = (entry: ListEntry, name: string, action: PairAction) => {
    const key = `pair:${entry.key}`;
    if (action.kind === "pair-with-code") {
      const pairWithCode = getPairWithCode();
      if (pairWithCode && entry.fingerprint) {
        const fingerprint = entry.fingerprint;
        runBridge(key, name, () => pairWithCode({ fingerprint }));
      } else if (entry.fingerprint && onPairWithCode) {
        setOpen(false);
        onPairWithCode({ fingerprint: entry.fingerprint, name });
      } else if (onManageServers) {
        setOpen(false);
        onManageServers();
      }
      return;
    }
    if (client === "electron" && openServerWindow) {
      // Only host + port go over the bridge; the app proves identity before anything is sent.
      runBridge(key, name, () => openServerWindow({ host: action.route.host, port: action.route.port }));
      return;
    }
    // Browser: the peer's own request page in a new context — nothing is proven or sent from this page.
    if (action.kind === "request-access" && action.url) {
      openExternalUrl(action.url);
      closeToTrigger();
    }
  };

  // Find current entry's display label
  const currentEntry = entries.find((e) => `${e.host}:${e.port}` === currentKey);
  const displayLabel = currentEntry?.label ?? (currentEntry?.isLocal ? "Local" : currentHost);
  const serverKind = currentServerKind(currentEntry, currentHost);
  const kindGlyph = connected
    ? serverKind === "local" ? mdiLaptop : mdiServerNetwork
    : serverKind === "local" ? mdiLaptopOff : mdiServerNetworkOff;
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
        className="focus-ring relative flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer @max-[399.98px]:min-w-8 @max-[399.98px]:justify-center @max-[399.98px]:px-1.5"
        title={i18nT("connection.switchServerNamed", { server: displayLabel }, "{server}: switch server")}
      >
        {/* Server-kind glyph; the status dot is a decorative top-right badge (the …Off slash runs top-left → bottom-right). */}
        <span
          className={`relative inline-flex shrink-0 ${connected ? "" : "text-[var(--accent-red-text)]"}`}
          data-testid="connection-chip-glyph"
          data-kind={serverKind}
          data-offline={connected ? "false" : "true"}
        >
          {connected ? (
            <Icon path={kindGlyph} size={0.75} aria-hidden="true" />
          ) : (
            <span className="inline-flex" data-testid="connection-chip-offline-glyph" title={connectionWord}>
              <Icon path={kindGlyph} size={0.75} aria-hidden="true" />
            </span>
          )}
          <span
            aria-hidden="true"
            className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-[var(--bg-secondary)] ${connected ? "bg-[var(--status-idle)]" : "bg-[var(--status-error)]"}`}
          />
        </span>
        <span className="min-w-0 max-w-24 truncate @min-[480px]:max-w-40 @max-[399.98px]:hidden">{displayLabel}</span>
        {!connected && (
          <span className="hidden text-[var(--accent-red-text)] @min-[480px]:inline">{connectionWord}</span>
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
        <Icon path={mdiChevronDown} size={0.45} className="@max-[399.98px]:hidden" />
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
          {model.entries.map((entry, idx) => {
            const isCurrent = entry.isCurrent;
            const state = rowState(entry, results.explain);
            const blocked = state !== null && state !== "available";
            const view = state ? stateView(state, entry.movedTo ? formatHostPort(entry.movedTo.host, entry.movedTo.port) : undefined) : null;
            const primary = primaryRoute(entry.routes) ?? entry.routes[0];
            const isLocalEntry = entry.routes.every((r) => r.kind === "loopback");
            const name = entry.title === `${primary.host}:${primary.port}` ? primary.host : entry.title;
            const movedAddress = state === "moved" && entry.movedTo ? formatHostPort(entry.movedTo.host, entry.movedTo.port) : undefined;
            const isSwitching =
              openingKey === entry.key || (!!inFlightSwitchKey && entry.routes.some((r) => `${r.host}:${r.port}` === inFlightSwitchKey));
            const displayedFingerprint = entry.fingerprint ?? entry.routes.map((r) => results.serverFingerprint.get(r.key)).find((f) => f !== undefined);
            const pair = entry.pairAction;
            const pairView = pair ? pairActionView(pair) : null;
            // A browser "Pair with code…" needs somewhere to go (the dialog lives in Settings ▸ Servers).
            const pairable = pair && (pair.kind !== "pair-with-code" || client === "electron" || !!onPairWithCode || !!onManageServers);
            const whyId = `server-why-${idx}`;
            return (
              <React.Fragment key={entry.key}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                tabIndex={-1}
                aria-disabled={blocked ? "true" : undefined}
                aria-describedby={blocked && view?.reason ? whyId : undefined}
                onClick={() => {
                  if (blocked) return;
                  if (isCurrent) {
                    closeToTrigger();
                    return;
                  }
                  const best = entry.best;
                  if (!best) return;
                  // Electron local window: open the remote's own window (host + port of the best proven
                  // route) instead of an in-page switch (no staging socket, no state swap, no last-server write).
                  // See change: add-electron-server-windows.
                  if (openServerWindow) {
                    if (isLocalEntry) {
                      closeToTrigger();
                      return;
                    }
                    runBridge(entry.key, name, () => openServerWindow({ host: best.host, port: best.port }));
                    return; // the menu stays open so the entry shows its inline progress until resolved
                  }
                  onSwitch(best.host, best.port);
                  closeToTrigger();
                }}
                data-unreachable={state === "unreachable" || undefined}
                data-denied={state === "denied" || undefined}
                data-cors-blocked={state === "cors-blocked" || undefined}
                data-name-not-resolved={state === "name-not-resolved" || undefined}
                data-refused={state === "different-identity" || state === "invalid-proof" || undefined}
                data-cant-prove={state === "cant-prove" || state === "cant-prove-browser" || undefined}
                className={`${ITEM_BASE} ${isCurrent ? "shadow-[inset_2px_0_0_var(--accent-primary)]" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 font-semibold ${blocked ? "text-[var(--text-secondary)]" : ""}`}>
                    <span className="truncate">{name}</span>
                    <span className={identityPill(isLocalEntry, true)}>
                      {isLocalEntry ? "Local" : "Remote"}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">{primary.host}:{primary.port}</span>
                  <span className="block text-xs text-[var(--text-secondary)]" data-testid="server-identity">
                    <span className="font-mono">
                      {displayedFingerprint
                        ? shortFingerprint(displayedFingerprint)
                        : i18nT("connection.identityNotAdvertised", undefined, "identity not advertised")}
                    </span>
                    {" · "}
                    <span data-testid="paired-state">{pairedText(entry.pairedState)}</span>
                    {entry.best && (
                      <>
                        {" · "}
                        {i18nT("connection.viaRoute", { kind: routeKindLabel(entry.best.kind).toLowerCase() }, "via {kind}")}
                      </>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1" data-testid="route-chips">
                    {entry.routes.map((r) => (
                      <RouteChip key={r.key} route={r} explain={results.explain.get(r.key)} />
                    ))}
                  </span>
                  {entry.sameIdentityAs.length > 0 && (
                    <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                      {i18nT("connection.sameIdentityAs", { name: entry.sameIdentityAs.map((o) => o.title).join(", ") }, "Same server as {name}")}
                    </span>
                  )}
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
              {pair && pairView && pairable && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-testid="pair-action"
                  data-pair-kind={pair.kind}
                  onClick={() => runPairAction(entry, name, pair)}
                  className={`${ITEM_BASE} !min-h-[36px] items-center pl-6 font-semibold`}
                >
                  <Icon path={openingKey === `pair:${entry.key}` ? mdiLoading : pairView.icon} size={0.5} className={openingKey === `pair:${entry.key}` ? "animate-spin" : ""} aria-hidden="true" />
                  <span className="min-w-0 flex-1">{pairView.label}</span>
                </button>
              )}
              {entry.movedTo && state === "moved" && movedAddress && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void handleUpdate(entry).catch(logRejection("ServerSelector.handleUpdate"))}
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
                  className="px-3 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
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
