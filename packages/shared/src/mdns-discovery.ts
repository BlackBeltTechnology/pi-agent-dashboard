/**
 * mDNS discovery module for pi-dashboard.
 * Advertises and discovers `_pi-dashboard._tcp` services on the local network.
 */
import { Bonjour, type Service, type Browser } from "bonjour-service";
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
}

let bonjourInstance: Bonjour | null = null;
let publishedService: Service | null = null;

function getBonjour(): Bonjour {
  if (!bonjourInstance) {
    bonjourInstance = new Bonjour();
  }
  return bonjourInstance;
}

/**
 * Advertise this dashboard server on mDNS.
 */
export function advertiseDashboard(port: number, piPort: number): void {
  const bonjour = getBonjour();
  const pkg = { version: "0.0.0" }; // Will be replaced by actual version
  try {
    const pkgJson = require("../../package.json");
    pkg.version = pkgJson.version ?? "0.0.0";
  } catch { /* ignore */ }

  publishedService = bonjour.publish({
    name: `pi-dashboard-${os.hostname()}-${port}`,
    type: SERVICE_TYPE,
    port,
    txt: {
      version: pkg.version,
      pid: String(process.pid),
      piPort: String(piPort),
    },
  });
}

/**
 * Stop advertising this dashboard server.
 */
export function stopAdvertising(): void {
  if (publishedService) {
    publishedService.stop?.(() => {});
    publishedService = null;
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

function serviceToServer(service: Service, isLocal: boolean): DiscoveredServer {
  const txt = service.txt as Record<string, string> | undefined;
  return {
    host: pickBestHost(service),
    port: service.port,
    piPort: parseInt(txt?.piPort ?? "9999", 10),
    version: txt?.version ?? "unknown",
    pid: parseInt(txt?.pid ?? "0", 10),
    isLocal,
    source: "mdns",
  };
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
 * Continuous browser that emits events when servers appear/disappear.
 */
export interface DashboardBrowser extends EventEmitter {
  /** Currently known servers */
  servers: Map<string, DiscoveredServer>;
  /** Stop browsing */
  stop(): void;
}

export function createBrowser(): DashboardBrowser {
  const emitter = new EventEmitter() as DashboardBrowser;
  emitter.servers = new Map();

  const bonjour = new Bonjour();
  const browser: Browser = bonjour.find({ type: SERVICE_TYPE });

  browser.on("up", (service: Service) => {
    const isLocal = isLocalService(service);
    const server = serviceToServer(service, isLocal);
    const key = `${server.host}:${server.port}`;
    emitter.servers.set(key, server);
    emitter.emit("server-up", server);
  });

  browser.on("down", (service: Service) => {
    const host = service.host ?? "unknown";
    const key = `${host}:${service.port}`;
    const server = emitter.servers.get(key);
    if (server) {
      emitter.servers.delete(key);
      emitter.emit("server-down", server);
    }
  });

  emitter.stop = () => {
    browser.stop();
    bonjour.destroy();
  };

  return emitter;
}
