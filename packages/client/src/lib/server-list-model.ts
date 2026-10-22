/**
 * Identity-merged server list — the ONE pure model behind the header selector
 * and Settings ▸ Servers. No React, no I/O, no clock: callers feed what they
 * know (the dashboard's saved list, mDNS discovery, the Electron servers list,
 * the route checks of this menu open) and read back one entry per identity.
 *
 * saved ∪ discovered ∪ Electron keyring → entries via `groupRoutes` (D1);
 * per route: kind (D4), proof state from the route checker (D2), refused flag;
 * per entry: best route via `rankRoutes` (D3), pair action via `pairAction` (D8),
 * paired state per client (D9), "same identity as" labels, and pre-routes
 * detection for a dashboard server older than this change (D6).
 *
 * An advertised `fp` is a hint: it decides which entry a discovered route is
 * SHOWN under; the route is only ever used after its check proves it, and a
 * refused route (different identity / invalid proof) is never ranked and never
 * feeds the pair action.
 *
 * See change: group-servers-by-identity (D1–D4, D6, D8, D9, D11).
 */
import type { DiscoveredServerInfo, KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  classifyRoute,
  defaultSchemeForPort,
  type GroupedEntry,
  groupRoutes,
  normalizeHost,
  type PairAction,
  type PairClient,
  type ProvenRoute,
  pairAction,
  primaryRoute,
  type Route,
  type RouteKind,
  rankRoutes,
  routeKey,
} from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { isUsableCheck, type RouteCheck } from "./server-route-check.js";

// ── Inputs ────────────────────────────────────────────────────────────

/**
 * The renderer-safe `servers:list` state of the Electron main window
 * (`packages/electron/src/lib/servers-ipc.ts`): no bearer, no cookie. Structural
 * copy — the client cannot import Electron code.
 */
export interface ElectronServersState {
  paired: ReadonlyArray<{
    fingerprint: string;
    label: string;
    state: "paired" | "needs-pairing";
    /** Most recent host as `host:port` (scheme is not carried). */
    host?: string;
  }>;
  discovered: ReadonlyArray<{
    name: string;
    host: string;
    port: number;
    fingerprint?: string;
    state: "not-paired" | "paired" | "identity-not-advertised";
  }>;
}

/** A server seen by a scan (dashboard-side `/api/discover-servers` or Electron discovery): plain http. */
type DiscoveredInput = Pick<DiscoveredServerInfo, "host" | "port"> & { fingerprint?: string; name?: string };

export interface ServerListInput {
  client: PairClient;
  /** `GET /api/known-servers` entries (a pre-routes server lists none with `routes`). */
  saved: readonly KnownServerListEntry[];
  discovered?: readonly DiscoveredInput[];
  /** Present only in the Electron main window (absent in a browser, the neutral shell and a remote origin). */
  electron?: ElectronServersState | null;
  /** The dashboard the page is loaded from; appended when no entry holds it. */
  current?: { host: string; port: number; scheme?: "http" | "https"; label?: string };
  /** Route checks of this menu open, keyed by `routeKey`. A missing key is "not checked yet". */
  checks?: ReadonlyMap<string, RouteCheck>;
}

// ── Outputs ───────────────────────────────────────────────────────────

/** UI state of one route, derived from its check. */
type RouteState =
  | "unchecked"
  | "proven"
  | "network-not-allowed"
  | "different-identity"
  | "invalid-proof"
  | "cant-prove"
  | "cant-prove-in-browser"
  | "unreachable";

export interface ListRoute extends Route {
  /** `routeKey(route)` — the key of `checks`. */
  key: string;
  kind: RouteKind;
  /** Seen by a scan this session (in addition to, or instead of, being stored). */
  discovered: boolean;
  /** Held by the Electron keyring entry of this identity. */
  inKeyring: boolean;
  check?: RouteCheck;
  state: RouteState;
  /** Proven an identity that is not this entry's: never ranked, never offered. */
  refused: boolean;
  /** Proven and reachable under this network: may be opened / switched to. */
  usable: boolean;
  /** The best route (`ListEntry.best`). */
  used: boolean;
  /** The identity a refused route proved (different-identity only). */
  provenFingerprint?: string;
  latencyMs?: number;
}

/** Whether this device holds a credential for the entry, per client (D9). */
export type PairedState =
  /** The dashboard the page is loaded from. */
  | "this-dashboard"
  /** Electron: keyring entry with a usable credential. */
  | "paired"
  /** Electron: keyring entry whose credential was lost. */
  | "needs-pairing"
  /** Electron: no keyring entry. */
  | "not-paired"
  /** Browser: the known-servers store is the operator's, a tab knows nothing of other origins. */
  | "unknown-in-this-tab";

/** Entry-level summary for the row text and `aria-disabled`. */
type EntryStatus =
  | "unchecked"
  | "available"
  | "network-not-allowed"
  | "refused"
  | "cant-prove"
  | "cant-prove-in-browser"
  | "unreachable";

export interface ListEntry {
  /** Stable row key: the primary route's key. */
  key: string;
  fingerprint?: string;
  /** Saved label, else the advertised/keyring name, else the primary `host:port`. */
  title: string;
  routes: ListRoute[];
  /** Best route among the proven ones (credentialed order for a paired Electron entry); `null` when none. */
  best: ListRoute | null;
  status: EntryStatus;
  pairedState: PairedState;
  /** The one action for an entry this device holds no credential for; `null` = state text only. */
  pairAction: PairAction | null;
  /** Other entries with the same identity on another instance port ("same identity as …"). */
  sameIdentityAs: Array<{ key: string; title: string }>;
  isCurrent: boolean;
  /** Stored in the dashboard's known-servers config (false: discovered, keyring or current only). */
  saved: boolean;
  /** Listed by a server older than this change: single synthesized route, no https add. */
  preRoutes: boolean;
  /** Verified move suggestion of the primary route (never persisted). */
  movedTo?: { host: string; port: number };
}

export interface ServerListModel {
  entries: ListEntry[];
  /** Whether adding an `https` route may be offered (false for a pre-routes dashboard server). */
  offerHttpsAdd: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────

const REFUSED_STATES: ReadonlySet<RouteState> = new Set(["different-identity", "invalid-proof"]);

function routeState(check: RouteCheck | undefined): RouteState {
  if (!check) return "unchecked";
  if (check.kind !== "proven") return check.kind;
  // Proven, but the health leg decides whether it can be used from here.
  return check.access === "ok" ? "proven" : check.access === "network-not-allowed" ? "network-not-allowed" : "unreachable";
}

/** Split `host:port` (IPv6 bracketed or bare-with-port) as the Electron list carries it. */
function splitHostPort(hostPort: string): { host: string; port: number } | null {
  const i = hostPort.lastIndexOf(":");
  if (i < 1) return null;
  const port = Number(hostPort.slice(i + 1));
  const host = hostPort.slice(0, i).replace(/^\[|\]$/g, "");
  return Number.isInteger(port) && port >= 1 && port <= 65535 && host ? { host, port } : null;
}

/** A page origin and a route are the same server: same port and same host (loopback aliases are one host). */
function isSameOrigin(route: Pick<Route, "host" | "port">, cur: { host: string; port: number }): boolean {
  if (route.port !== cur.port) return false;
  const a = normalizeHost(route.host);
  const b = normalizeHost(cur.host);
  if (a === b) return true;
  return classifyRoute({ host: a, scheme: "http" }) === "loopback" && classifyRoute({ host: b, scheme: "http" }) === "loopback";
}

function legacyRoute(e: KnownServerListEntry): Route {
  // A pre-routes server stores and probes plain http whatever the port.
  return { host: e.host, port: e.port, scheme: "http", source: "saved" };
}

interface EntryMeta {
  label?: string;
  movedTo?: { host: string; port: number };
  saved: boolean;
  preRoutes: boolean;
}

function statusOf(routes: readonly ListRoute[], best: ListRoute | null): EntryStatus {
  if (best) return "available";
  if (routes.some((r) => r.state === "network-not-allowed")) return "network-not-allowed";
  if (routes.some((r) => r.state === "unchecked")) return "unchecked";
  if (routes.length > 0 && routes.every((r) => r.refused)) return "refused";
  if (routes.some((r) => r.state === "cant-prove-in-browser")) return "cant-prove-in-browser";
  if (routes.some((r) => r.state === "cant-prove")) return "cant-prove";
  return "unreachable";
}

// ── The model ─────────────────────────────────────────────────────────

type PairedRow = ElectronServersState["paired"][number];

/** Routes the clients know besides the saved list, plus the flags that survive grouping. */
interface Sightings {
  incoming: ProvenRoute[];
  discoveredKeys: Set<string>;
  keyringKeys: Set<string>;
  /** routeKey → advertised / keyring / current-dashboard name. */
  names: Map<string, string>;
  paired: Map<string, PairedRow>;
}

function keyringSightings(s: Sightings, rows: readonly PairedRow[]): void {
  for (const p of rows) {
    const hp = p.host ? splitHostPort(p.host) : null;
    if (!hp) continue;
    const route: Route = { ...hp, scheme: defaultSchemeForPort(hp.port), source: "saved" };
    s.keyringKeys.add(routeKey(route));
    s.names.set(routeKey(route), p.label);
    s.incoming.push({ route, fingerprint: p.fingerprint });
  }
}

function discoverySightings(s: Sightings, seen: readonly DiscoveredInput[]): void {
  for (const d of seen) {
    // mDNS peers are always plain http (D2); a name-less advert is shown by host:port.
    const route: Route = { host: d.host, port: d.port, scheme: "http", source: "mdns" };
    s.discoveredKeys.add(routeKey(route));
    if (d.name) s.names.set(routeKey(route), d.name);
    s.incoming.push({ route, fingerprint: d.fingerprint });
  }
}

/** The page's own server joins as a synthetic entry only when nothing already holds it. */
function currentSighting(s: Sightings, cur: NonNullable<ServerListInput["current"]>, held: boolean): void {
  const route: Route = { host: cur.host, port: cur.port, scheme: cur.scheme ?? "http", source: "saved" };
  if (cur.label) s.names.set(routeKey(route), cur.label);
  if (!held && !s.incoming.some((p) => isSameOrigin(p.route, cur))) s.incoming.push({ route });
}

function pairedStateOf(client: PairClient, isCurrent: boolean, row: PairedRow | undefined): PairedState {
  if (isCurrent) return "this-dashboard";
  if (client === "browser") return "unknown-in-this-tab";
  if (!row) return "not-paired";
  return row.state === "paired" ? "paired" : "needs-pairing";
}

function toListRoute(r: Route, check: RouteCheck | undefined, flags: { discovered: boolean; inKeyring: boolean }): ListRoute {
  const state = routeState(check);
  return {
    ...r,
    key: routeKey(r),
    kind: classifyRoute(r),
    ...flags,
    ...(check ? { check } : {}),
    state,
    refused: REFUSED_STATES.has(state),
    usable: isUsableCheck(check),
    used: false,
    ...(check?.kind === "different-identity" ? { provenFingerprint: check.fingerprint } : {}),
    ...(check?.kind === "proven" ? { latencyMs: check.latencyMs } : {}),
  };
}

/** Best route among the usable ones; a keyring route counts as stored for the credentialed order. */
function pickBest(routes: readonly ListRoute[], credentialed: boolean): ListRoute | null {
  const rankable = routes.map((r) => ({
    host: r.host,
    port: r.port,
    scheme: r.scheme,
    source: r.source,
    key: r.key,
    proven: r.usable,
    latencyMs: r.latencyMs,
    discovered: r.source === "mdns" && !r.inKeyring,
  }));
  const pick = rankRoutes(rankable, { credentialed });
  return pick ? (routes.find((r) => r.key === pick.key) ?? null) : null;
}

interface Draft {
  g: GroupedEntry;
  m: EntryMeta;
  key: string;
}

function buildEntry(d: Draft, drafts: readonly Draft[], input: ServerListInput, s: Sightings, titleOf: (d: Draft) => string): ListEntry {
  const { client, current, checks } = input;
  const isCurrent = current ? d.g.routes.some((r) => isSameOrigin(r, current)) : false;
  const pairedRow = d.g.fingerprint ? s.paired.get(d.g.fingerprint) : undefined;
  const pairedState = pairedStateOf(client, isCurrent, pairedRow);

  const routes = d.g.routes.map((r) =>
    toListRoute(r, checks?.get(routeKey(r)), { discovered: s.discoveredKeys.has(routeKey(r)), inKeyring: s.keyringKeys.has(routeKey(r)) }),
  );
  const best = pickBest(routes, client === "electron" && pairedState === "paired");
  if (best) best.used = true;

  // The pair action ignores refused routes: an advert claiming F never earns a request.
  const action = pairAction({
    client,
    routes: routes.filter((r) => !r.refused).map((r) => ({ host: r.host, port: r.port, scheme: r.scheme, source: r.source, discovered: r.discovered, inKeyring: r.inKeyring })),
    fingerprint: d.g.fingerprint,
    credentialHeld: pairedState === "paired",
    isCurrent,
  });

  return {
    key: d.key,
    ...(d.g.fingerprint ? { fingerprint: d.g.fingerprint } : {}),
    title: titleOf(d),
    routes,
    best,
    status: statusOf(routes, best),
    pairedState,
    pairAction: action,
    sameIdentityAs: d.g.sameIdentityAs.map((j) => ({ key: drafts[j].key, title: titleOf(drafts[j]) })),
    isCurrent,
    saved: d.m.saved,
    preRoutes: d.m.preRoutes,
    ...(d.m.movedTo ? { movedTo: d.m.movedTo } : {}),
  };
}

export function buildServerList(input: ServerListInput): ServerListModel {
  const { saved, current } = input;
  const base = saved.map((e) => ({
    fingerprint: e.fingerprint,
    routes: e.routes && e.routes.length > 0 ? e.routes : [legacyRoute(e)],
  }));
  const meta: EntryMeta[] = saved.map((e) => ({ label: e.label, movedTo: e.movedTo, saved: true, preRoutes: e.routes === undefined }));

  const s: Sightings = {
    incoming: [],
    discoveredKeys: new Set(),
    keyringKeys: new Set(),
    names: new Map(),
    paired: new Map((input.electron?.paired ?? []).map((p) => [p.fingerprint, p])),
  };
  keyringSightings(s, [...s.paired.values()]);
  discoverySightings(s, [
    ...(input.discovered ?? []),
    ...(input.electron?.discovered ?? []).map((d) => ({ host: d.host, port: d.port, fingerprint: d.fingerprint, name: d.name })),
  ]);
  if (current) currentSighting(s, current, base.some((e) => e.routes.some((r) => isSameOrigin(r, current))));

  const drafts: Draft[] = groupRoutes(base, s.incoming).map((g) => ({
    g,
    m: g.sourceIndex !== undefined ? meta[g.sourceIndex] : { saved: false, preRoutes: false },
    key: routeKey(primaryRoute(g.routes) ?? g.routes[0]),
  }));
  const titleOf = (d: Draft): string => {
    const named = d.m.label ?? d.g.routes.map((r) => s.names.get(routeKey(r))).find((n) => n !== undefined);
    if (named) return named;
    const p = primaryRoute(d.g.routes) ?? d.g.routes[0];
    return `${p.host}:${p.port}`;
  };

  return {
    entries: drafts.map((d) => buildEntry(d, drafts, input, s, titleOf)),
    offerHttpsAdd: !(saved.length > 0 && saved.every((e) => e.routes === undefined)),
  };
}
