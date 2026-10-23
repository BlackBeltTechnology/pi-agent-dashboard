/**
 * "Is this endpoint one the operator pinned?" — the gate in front of the
 * paired-device bearer.
 *
 * Pinned means canonical `host:port` EQUALITY with the configured endpoint or
 * with a pin-store entry's `lastEndpoint`. Canonical = lowercase host, no
 * trailing dot, bracketed-IPv6-insensitive, scheme-default port applied.
 *
 * Deliberately NOT `resolvePinForEndpoint`: that falls back to "the sole pin"
 * for ANY endpoint, so one stored pin would make every discovered host look
 * pinned and hand it the bearer. A discovery-only host is unpinned.
 *
 * See change: harden-bridge-inbound-and-discovery (D19).
 */
import { normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { ServerPinStore } from "./server-pin-store.js";

const DEFAULT_PORTS: Record<string, number> = { "ws:": 80, "wss:": 443, "http:": 80, "https:": 443 };

/** Canonical `host:port` key for an endpoint (`ws://h:9`, `h:9`, `[::1]:9`), or `undefined` if unparseable. */
export function canonicalEndpointKey(endpoint: string): string | undefined {
  const raw = endpoint.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `ws://${raw}`);
    const port = u.port ? Number(u.port) : DEFAULT_PORTS[u.protocol];
    if (port === undefined) return undefined;
    const host = normalizeHostKey(u.hostname);
    if (!host) return undefined;
    return `${host.includes(":") ? `[${host}]` : host}:${port}`;
  } catch {
    return undefined;
  }
}

export function isPinnedEndpoint(
  endpoint: string,
  known: { configured: ReadonlyArray<string | undefined>; pins: ServerPinStore },
): boolean {
  const key = canonicalEndpointKey(endpoint);
  if (!key) return false;
  const candidates = [...known.configured, ...known.pins.servers.map((s) => s.lastEndpoint)];
  return candidates.some((c) => c !== undefined && canonicalEndpointKey(c) === key);
}
