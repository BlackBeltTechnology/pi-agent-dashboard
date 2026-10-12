/**
 * mDNS discovery module for pi-dashboard.
 * Advertises and discovers `_pi-dashboard._tcp` services on the local network.
 */
import { Bonjour, type Service, type Browser } from "bonjour-service";
import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import os from "node:os";
import { EventEmitter } from "node:events";
import { isDashboardRunning } from "./server-identity.js";

const SERVICE_TYPE = "pi-dashboard";

export interface DiscoveredServer {
  /** Hostname of the machine running the server */
  host: string;
  /** HTTP port */
  port: number;
  /** Pi gateway WebSocket port */
  piPort: number;
  /** Dashboard version */
  version: string;
  /** Server process PID */
  pid: number;
  /** Whether the server is on this machine */
  isLocal: boolean;
  /** How the server was discovered: "mdns" or "fallback" */
  source: "mdns" | "fallback";
  /** Server identity fingerprint from the advert's TXT `fp` (absent on older servers). */
  fingerprint?: string;
  /** Display name from the advert's TXT `name` (display only). */
  name?: string;
  /** Addresses the advert carried for its SRV target. */
  addresses?: string[];
  /** mDNS service fqdn — the stable peer key (see {@link peerKey}). */
  instance?: string;
}

/** Stable key of a discovered peer: the service fqdn, else `host:port`. */
export function peerKey(server: Pick<DiscoveredServer, "instance" | "host" | "port">): string {
  return server.instance ?? `${server.host}:${server.port}`;
}

let bonjourInstance: Bonjour | null = null;

function getBonjour(): Bonjour {
  if (!bonjourInstance) {
    bonjourInstance = new Bonjour();
  }
  return bonjourInstance;
}

/** Publish configuration handed to the (injectable) publisher. */
export interface AdvertisePublishConfig {
  name: string;
  type: string;
  port: number;
  txt: Record<string, string>;
  /** SRV target / A+AAAA owner — dashboard-owned, never `os.hostname()`. */
  host?: string;
  /** Probe for a name conflict before announcing (always true here). */
  probe?: boolean;
}

export interface AdvertiseDeps {
  /** Publisher seam (tests inject a spy; production uses bonjour). */
  publish?: (config: AdvertisePublishConfig) => Service;
  /** Re-resolve the advertised address list on each refresh tick (D2). */
  resolveAddresses?: () => Promise<string[]>;
  /** Interval seam; returns a cancel function. Default: unref'd `setInterval`. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Conflict-probe timings (tests shorten nothing — fake timers are used). */
  log?: (msg: string) => void;
}

export interface AdvertiseVerdict {
  advertise: boolean;
  /** Names the bind host either way — the skip must be explainable in the log. */
  reason: string;
}

/**
 * Whether a server bound to `bindHost` may advertise itself over mDNS.
 *
 * Honest advertisement (fix-bridge-mdns-migration-hijack D4): a server bound
 * only to LOOPBACK used to advertise under the machine's LAN hostname — a
 * record every consumer, including processes on the same machine, resolves
 * to an address the server never answers on. That record is poison: the
 * bridge-side migration gate exists because of it. So a loopback-bound
 * server advertises NOTHING. Unset/all-interfaces/specific-LAN binds keep
 * advertising — the record is true for those.
 */
/** Expand an IPv6 literal (including `::` compression) to its canonical
 * colon form, or undefined when the host is not an IPv6 literal. Group
 * values are hex-normalized so spelled-out and compressed spellings of the
 * same address compare equal. */
function normalizeIPv6(host: string): string | undefined {
  const halves = host.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return undefined;
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 2 && fill === 0)) return undefined;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => g === "" || !/^[0-9a-f]{1,4}$/.test(g)))
    return undefined;
  return groups.map((g) => Number.parseInt(g, 16).toString(16)).join(":");
}

export function shouldAdvertise(bindHost: string | undefined): AdvertiseVerdict {
  const h = (bindHost ?? "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  // Any spelling of the IPv6 loopback address — `::1` and the spelled-out
  // `0:0:0:0:0:0:0:1` are the SAME address (CodeRabbit review,
  // fix-bridge-mdns-migration-hijack) — while `::` (all-interfaces) advertises.
  const ipv6 = h.includes(":") ? normalizeIPv6(h) : undefined;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    ipv6 === "0:0:0:0:0:0:0:1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  ) {
    return {
      advertise: false,
      reason: `server is bound only to loopback (${bindHost}) — not advertising an address it does not serve`,
    };
  }
  return {
    advertise: true,
    reason: `server serves ${bindHost || "all interfaces"} — advertising`,
  };
}

/**
 * Dashboard-owned mDNS names (D1): `<id12>` is the first 12 hex chars of
 * SHA-256 over the fingerprint string. Stable across OS renames, DNS-label safe,
 * and the port separates dev/prod servers sharing one `identity.key`.
 */
export function deriveAdvertisedNames(fingerprint: string, port: number): { instance: string; host: string } {
  const id12 = crypto.createHash("sha256").update(fingerprint, "utf8").digest("hex").slice(0, 12);
  const instance = `pi-dashboard-${id12}-${port}`;
  return { instance, host: `${instance}.local` };
}

type Ifaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

/** Container/virtual bridge interfaces reuse addresses across machines. */
const BRIDGE_IFACE = /^(docker|br-|veth|virbr|cni|flannel)/i;

function isIpv6LinkLocal(addr: string): boolean {
  return /^fe[89ab][0-9a-f]:/i.test(addr);
}

/** Non-internal, non-link-local, non-bridge interface addresses. */
function servedInterfaceAddresses(interfaces: Ifaces): string[] {
  const out: string[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || BRIDGE_IFACE.test(name)) continue;
    for (const info of infos) {
      if (info.internal || info.mac === "00:00:00:00:00:00") continue;
      if (info.family === "IPv6" && isIpv6LinkLocal(info.address)) continue;
      out.push(info.address);
    }
  }
  return out;
}

/**
 * The address list this server advertises (D2).
 *
 * specific IP bind → that address; hostname bind → its resolved addresses that
 * are local interface addresses (none → no advert); all-interfaces → served
 * interface addresses; loopback bind → no advert. Empty array = do not advertise.
 */
export async function resolveAdvertisedAddresses(
  bindHost: string | undefined,
  deps: { interfaces?: () => Ifaces; lookup?: (host: string) => Promise<string[]> } = {},
): Promise<string[]> {
  if (!shouldAdvertise(bindHost).advertise) return [];
  const interfaces = (deps.interfaces ?? os.networkInterfaces)();
  const h = (bindHost ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "" || h === "0.0.0.0" || h === "::") return servedInterfaceAddresses(interfaces);
  if (net.isIP(h)) return [h];
  const lookup =
    deps.lookup ?? (async (host: string) => (await dns.promises.lookup(host, { all: true })).map((r) => r.address));
  try {
    const local = new Set<string>();
    for (const infos of Object.values(interfaces)) for (const i of infos ?? []) if (!i.internal) local.add(i.address);
    return (await lookup(h)).filter((a) => local.has(a));
  } catch {
    return [];
  }
}

export interface AdvertiseOptions extends AdvertiseDeps {
  bindHost?: string;
  /** Pre-resolved address list; default: the synchronous interface set. */
  addresses?: string[];
  /** Server identity fingerprint — the name derives from it (D1). */
  fingerprint?: string;
  version?: string;
  /** Display name (TXT `name`); a function is re-read on every republish (D3). */
  name?: string | (() => string);
}

interface AdvertState {
  port: number;
  piPort: number;
  opts: AdvertiseOptions;
  addresses: string[];
  service: Service | null;
  timers: Array<ReturnType<typeof setTimeout>>;
  cancelSweep?: () => void;
  active: boolean;
}

let advert: AdvertState | null = null;

const PROBE_CHECK_MS = 3000;
const PROBE_ATTEMPT_GAP_MS = 5000;
const PROBE_MAX_ATTEMPTS = 3;
const ADDRESS_REFRESH_MS = 60_000;

function displayName(opts: AdvertiseOptions): string {
  const n = typeof opts.name === "function" ? opts.name() : opts.name;
  return n && n.length > 0 ? n : os.hostname().replace(/\.local$/i, "");
}

/** Replace `records()` so A/AAAA carry exactly `addresses` (D2). */
function installAddressOverride(service: Service, addresses: string[]): void {
  const base = service.records.bind(service) as () => Array<{ type: string }>;
  (service as unknown as { records: () => unknown[] }).records = () => [
    ...base().filter((r) => r.type !== "A" && r.type !== "AAAA"),
    ...addresses.map((data) => ({
      name: service.host,
      type: data.includes(":") ? "AAAA" : "A",
      ttl: 120,
      data,
    })),
  ];
}

function unpublish(state: AdvertState): void {
  for (const t of state.timers) clearTimeout(t);
  state.timers = [];
  if (state.service) {
    state.service.stop?.(() => {});
    state.service = null;
  }
}

/** One publish attempt; conflict detection + retry per D2. Returns false when failed closed. */
function publishAttempt(state: AdvertState, attempt: number): boolean {
  const log = state.opts.log ?? ((m: string) => console.log(m));
  const names = deriveAdvertisedNames(state.opts.fingerprint ?? `legacy:${os.hostname()}`, state.port);
  const config: AdvertisePublishConfig = {
    name: names.instance,
    host: names.host,
    type: SERVICE_TYPE,
    port: state.port,
    probe: true,
    txt: {
      version: state.opts.version ?? "0.0.0",
      pid: String(process.pid),
      piPort: String(state.piPort),
      ...(state.opts.fingerprint ? { fp: state.opts.fingerprint } : {}),
      name: displayName(state.opts),
    },
  };
  const publish = state.opts.publish ?? ((c: AdvertisePublishConfig) => getBonjour().publish(c));
  const service = publish(config);
  if (service.published) {
    // Already announced before the override could be installed — fail closed.
    service.stop?.(() => {});
    log(`mDNS: ${names.instance} announced before the address override was installed — not advertising`);
    return false;
  }
  installAddressOverride(service, state.addresses);
  state.service = service;
  const check = setTimeout(() => {
    if (!state.active || state.service !== service || service.published) return;
    service.stop?.(() => {});
    state.service = null;
    if (attempt >= PROBE_MAX_ATTEMPTS) {
      console.warn(
        `mDNS: name ${names.instance} still in use after ${attempt} attempts — not advertising. ` +
          "If this machine was cloned, regenerate identity.key (never copy it between machines).",
      );
      return;
    }
    const next = setTimeout(() => {
      if (state.active) publishAttempt(state, attempt + 1);
    }, PROBE_ATTEMPT_GAP_MS - PROBE_CHECK_MS);
    next.unref?.();
    state.timers.push(next);
  }, PROBE_CHECK_MS);
  check.unref?.();
  state.timers.push(check);
  return true;
}

/** Re-resolve addresses; republish when the set changed (F3). */
async function refreshAdvertisedAddresses(state: AdvertState): Promise<void> {
  const resolve = state.opts.resolveAddresses;
  if (!resolve || !state.active) return;
  let next: string[];
  try {
    next = await resolve();
  } catch {
    return;
  }
  if (!state.active || next.length === 0) return;
  const same = next.length === state.addresses.length && next.every((a, i) => a === state.addresses[i]);
  if (same) return;
  unpublish(state);
  state.addresses = next;
  publishAttempt(state, 1);
}

/**
 * Advertise this dashboard server on mDNS.
 *
 * `opts.bindHost` is the address the server ACTUALLY listens on (task 4.1:
 * determined at advertise time from the bind config, never from what the
 * hostname resolves to). A loopback-bound server skips advertising entirely
 * (task 4.2) — the alternative, publishing a `localhost`-resolvable record,
 * would still hand every OTHER machine an endpoint it cannot reach.
 *
 * Names are dashboard-owned (`pi-dashboard-<id12>-<port>[.local]`), never
 * `os.hostname()`, so the OS responder's host record is not contested.
 *
 * See change: stabilize-mdns-server-identity (D1–D3).
 */
export function advertiseDashboard(
  port: number,
  piPort: number,
  opts: AdvertiseOptions = {},
): AdvertiseVerdict {
  const verdict = shouldAdvertise(opts.bindHost);
  const log = opts.log ?? ((m: string) => console.log(m));
  if (!verdict.advertise) {
    log(`mDNS: ${verdict.reason}`);
    return verdict;
  }

  if (advert) {
    advert.active = false;
    advert.cancelSweep?.();
    unpublish(advert);
    advert = null;
  }
  const addresses =
    opts.addresses ??
    (net.isIP((opts.bindHost ?? "").replace(/^\[|\]$/g, ""))
      ? [(opts.bindHost ?? "").replace(/^\[|\]$/g, "")]
      : servedInterfaceAddresses(os.networkInterfaces()));
  if (addresses.length === 0) {
    const v = { advertise: false, reason: `no advertisable address for ${opts.bindHost || "all interfaces"}` };
    log(`mDNS: ${v.reason}`);
    return v;
  }

  const state: AdvertState = { port, piPort, opts, addresses, service: null, timers: [], active: true };
  advert = state;
  if (!publishAttempt(state, 1)) {
    advert = null;
    return { advertise: false, reason: "service announced before the address override could be installed" };
  }
  const names = deriveAdvertisedNames(opts.fingerprint ?? `legacy:${os.hostname()}`, port);
  log(`mDNS: advertising ${names.instance} at ${addresses.join(", ")}`);
  if (opts.resolveAddresses) {
    const schedule =
      opts.schedule ??
      ((fn: () => void, ms: number) => {
        const t = setInterval(fn, ms);
        t.unref?.();
        return () => clearInterval(t);
      });
    state.cancelSweep = schedule(() => void refreshAdvertisedAddresses(state), ADDRESS_REFRESH_MS);
  }
  return { advertise: true, reason: `${verdict.reason} as ${names.instance}` };
}

/**
 * Stop advertising this dashboard server.
 */
export function stopAdvertising(): void {
  if (advert) {
    advert.active = false;
    advert.cancelSweep?.();
    unpublish(advert);
    advert = null;
  }
  if (bonjourInstance) {
    bonjourInstance.destroy();
    bonjourInstance = null;
  }
}

/**
 * Check if a discovered service is running on the local machine.
 */
export function isLocalService(service: Service): boolean {
  const hostname = os.hostname();
  const host = service.host ?? "";

  // Direct hostname match
  if (host === hostname || host === `${hostname}.local` || host === "localhost") {
    return true;
  }

  // Check against local network addresses
  const localAddresses = getLocalAddresses();
  const serviceAddresses = service.addresses ?? [];
  return serviceAddresses.some(addr => localAddresses.has(addr));
}

function getLocalAddresses(): Set<string> {
  const addresses = new Set<string>(["127.0.0.1", "::1"]);
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      addresses.add(info.address);
    }
  }
  return addresses;
}

/**
 * Pick the best host string for a discovered service.
 *
 * Bonjour can advertise `service.host` as the OS computer-name (e.g. macOS
 * "MacBook 242") which contains characters that are not valid in a DNS
 * hostname — so the browser cannot resolve it. When that happens we fall back
 * to `service.addresses` (preferring IPv4 over IPv6) so the saved entry is
 * actually reachable.
 *
 * Rule: a host is DNS-safe iff it matches `[A-Za-z0-9.-]+` and does not
 * begin or end with a hyphen (RFC 1123, relaxed for the `.local` suffix).
 */
export function pickBestHost(service: Pick<Service, "host" | "addresses">): string {
  const host = service.host;
  const isDnsSafe =
    typeof host === "string" &&
    host.length > 0 &&
    /^[A-Za-z0-9.-]+$/.test(host) &&
    !host.startsWith("-") &&
    !host.endsWith("-");
  if (isDnsSafe) return host;

  const addresses = service.addresses ?? [];
  const ipv4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (ipv4) return ipv4;
  if (addresses.length > 0) return addresses[0];

  // Last-resort: keep the original host so we never return undefined.
  return host ?? "unknown";
}

/** Host for a LOCAL peer: first advertised non-link-local address, IPv4 preferred. */
function localPeerHost(service: Pick<Service, "host" | "addresses">): string {
  const usable = (service.addresses ?? []).filter((a) => net.isIP(a) && !isIpv6LinkLocal(a));
  return usable.find((a) => net.isIPv4(a)) ?? usable[0] ?? pickBestHost(service);
}

export function serviceToServer(service: Service, isLocal: boolean): DiscoveredServer {
  const txt = service.txt as Record<string, string> | undefined;
  const server: DiscoveredServer = {
    host: isLocal ? localPeerHost(service) : pickBestHost(service),
    port: service.port,
    piPort: parseInt(txt?.piPort ?? "9999", 10),
    version: txt?.version ?? "unknown",
    pid: parseInt(txt?.pid ?? "0", 10),
    isLocal,
    source: "mdns",
    addresses: [...(service.addresses ?? [])],
  };
  if (service.fqdn) server.instance = service.fqdn;
  if (txt?.fp) server.fingerprint = txt.fp;
  if (txt?.name) server.name = txt.name;
  return server;
}

/**
 * One-shot discovery: browse for dashboard servers with timeout.
 * Returns localhost servers first, then remote.
 */
export async function discoverDashboard(timeout = 2000): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const servers: DiscoveredServer[] = [];
    // Use a fresh Bonjour instance to avoid conflicts with the
    // singleton used by advertiseDashboard()
    const bonjour = new Bonjour();
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      browser.stop();
      bonjour.destroy();
      // Sort: local first
      servers.sort((a, b) => (a.isLocal === b.isLocal ? 0 : a.isLocal ? -1 : 1));
      resolve(servers);
    };

    const timer = setTimeout(finish, timeout);

    const browser = bonjour.find({ type: SERVICE_TYPE });
    browser.on("up", (service: Service) => {
      const isLocal = isLocalService(service);
      servers.push(serviceToServer(service, isLocal));
      // Resolve early once a local server is found
      if (isLocal) {
        clearTimeout(timer);
        // Small delay to collect any other simultaneous responses
        setTimeout(finish, 100);
      }
    });
  });
}

/**
 * Fallback discovery: probe localhost via health check when mDNS finds nothing.
 */
export async function discoverFallback(port: number): Promise<DiscoveredServer | null> {
  const status = await isDashboardRunning(port);
  if (!status.running) return null;

  return {
    host: "localhost",
    port,
    piPort: 9999, // Default — we can't know the actual piPort from health check alone
    version: "unknown",
    pid: status.pid ?? 0,
    isLocal: true,
    source: "fallback",
  };
}

/**
 * Full discovery: mDNS first, fallback to health check.
 */
export async function discoverDashboardWithFallback(
  configPort: number,
  mdnsTimeout = 2000,
): Promise<{ servers: DiscoveredServer[]; portConflict: boolean }> {
  const servers = await discoverDashboard(mdnsTimeout);
  if (servers.length > 0) {
    return { servers, portConflict: false };
  }

  // mDNS found nothing — try health check fallback
  const status = await isDashboardRunning(configPort);
  if (status.running) {
    return {
      servers: [{
        host: "localhost",
        port: configPort,
        piPort: 9999,
        version: "unknown",
        pid: status.pid ?? 0,
        isLocal: true,
        source: "fallback",
      }],
      portConflict: false,
    };
  }

  return { servers: [], portConflict: status.portConflict ?? false };
}

/**
 * Continuous browser that emits events when servers appear/disappear/change.
 *
 * Events: `server-up`, `server-down`, `server-update` (host/addresses/TXT of an
 * existing peer changed), `sweep` (a refresh sweep finished). Peers are keyed by service fqdn (see {@link peerKey}),
 * symmetric for up and down. `bonjour-service` never expires peers and never
 * reports address-only changes, so a periodic refresh sweep re-browses and
 * removes peers absent from {@link SWEEP_MISS_LIMIT} consecutive sweeps.
 *
 * See change: stabilize-mdns-server-identity (D4).
 */
export interface DashboardBrowser extends EventEmitter {
  /** Currently known servers, keyed by {@link peerKey}. */
  servers: Map<string, DiscoveredServer>;
  /** Run one refresh sweep now (also what the interval calls). */
  sweep(): Promise<void>;
  /** Stop browsing */
  stop(): void;
}

export interface BrowserDeps {
  /** Continuous-browse source (tests inject a fake emitter). */
  createBonjour?: () => { find(opts: { type: string }): Browser; destroy(): void };
  /** One sweep's browse result (tests inject; default: a 3 s fresh browse). */
  sweepBrowse?: () => Promise<Service[]>;
  sweepIntervalMs?: number;
  /** Interval seam; returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export const SWEEP_INTERVAL_MS = 60_000;
export const SWEEP_WINDOW_MS = 3_000;
export const SWEEP_MISS_LIMIT = 3;

function sameServer(a: DiscoveredServer, b: DiscoveredServer): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.piPort === b.piPort &&
    a.version === b.version &&
    a.pid === b.pid &&
    a.isLocal === b.isLocal &&
    a.fingerprint === b.fingerprint &&
    a.name === b.name &&
    JSON.stringify(a.addresses ?? []) === JSON.stringify(b.addresses ?? [])
  );
}

async function defaultSweepBrowse(): Promise<Service[]> {
  const bonjour = new Bonjour();
  const found = new Map<string, Service>();
  const browser = bonjour.find({ type: SERVICE_TYPE });
  const collect = (svc: Service) => found.set(svc.fqdn, svc);
  browser.on("up", collect);
  browser.on("srv-update", collect);
  browser.on("txt-update", collect);
  const requery = setTimeout(() => browser.update(), 1000);
  await new Promise<void>((r) => setTimeout(r, SWEEP_WINDOW_MS));
  clearTimeout(requery);
  browser.stop();
  bonjour.destroy();
  return Array.from(found.values());
}

export function createBrowser(deps: BrowserDeps = {}): DashboardBrowser {
  const emitter = new EventEmitter() as DashboardBrowser;
  emitter.servers = new Map();
  const misses = new Map<string, number>();

  const bonjour = deps.createBonjour ? deps.createBonjour() : new Bonjour();
  const browser: Browser = bonjour.find({ type: SERVICE_TYPE });

  /** Insert or refresh a peer; emits up (new) or update (changed). */
  const upsert = (service: Service): void => {
    const server = serviceToServer(service, isLocalService(service));
    const key = peerKey(server);
    misses.set(key, 0);
    const existing = emitter.servers.get(key);
    emitter.servers.set(key, server);
    if (!existing) emitter.emit("server-up", server);
    else if (!sameServer(existing, server)) emitter.emit("server-update", server);
  };

  browser.on("up", upsert);
  browser.on("srv-update", upsert);
  browser.on("txt-update", upsert);
  browser.on("down", (service: Service) => {
    const key = service.fqdn ?? `${service.host ?? "unknown"}:${service.port}`;
    const server = emitter.servers.get(key);
    if (server) {
      emitter.servers.delete(key);
      misses.delete(key);
      emitter.emit("server-down", server);
    }
  });

  emitter.sweep = async () => {
    let seen: Service[];
    try {
      seen = await (deps.sweepBrowse ?? defaultSweepBrowse)();
    } catch {
      return;
    }
    const seenKeys = new Set<string>();
    for (const svc of seen) {
      seenKeys.add(peerKey(serviceToServer(svc, false)));
      upsert(svc);
    }
    for (const [key, server] of Array.from(emitter.servers)) {
      if (seenKeys.has(key)) continue;
      const n = (misses.get(key) ?? 0) + 1;
      misses.set(key, n);
      if (n >= SWEEP_MISS_LIMIT) {
        emitter.servers.delete(key);
        misses.delete(key);
        emitter.emit("server-down", server);
      }
    }
    emitter.emit("sweep");
  };

  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      t.unref?.();
      return () => clearInterval(t);
    });
  const cancelSweep = schedule(() => void emitter.sweep(), deps.sweepIntervalMs ?? SWEEP_INTERVAL_MS);

  emitter.stop = () => {
    cancelSweep();
    browser.stop();
    bonjour.destroy();
  };

  return emitter;
}
