/**
 * "Accessible at" endpoint enumeration — every address the dashboard answers
 * on, tagged `{ kind, url, tls }`, multi-sourced from:
 *   - active provider endpoints (public / mesh / magicdns),
 *   - a manual operator `https`/`wss` endpoint (`pairing.publicBaseUrls`),
 *   - this host's LAN + loopback addresses.
 *
 * The `tls` tag is ADVISORY. The authoritative "never advertise plain http in
 * the pairing payload" gate stays server-side at read time in
 * `PairingManager.reachableUrls()` (D4/D14). `toReachableUrlStrings()` flattens
 * every endpoint to a URL string for that gate to filter; the tagged list here
 * additionally drives the "Accessible at" panel and the no-TLS link QRs.
 *
 * See change: add-tunnel-providers.
 */
import os from "node:os";
import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

/** Loopback + non-internal IPv4 LAN endpoints for `port` (all no-TLS http). */
export function localEndpoints(port: number, ifaces = os.networkInterfaces()): TunnelEndpoint[] {
  const out: TunnelEndpoint[] = [{ kind: "local", url: `http://localhost:${port}`, tls: false }];
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const info of addrs) {
      if (info.internal) continue;
      if (info.family !== "IPv4" && (info.family as unknown as number) !== 4) continue;
      out.push({ kind: "lan", url: `http://${info.address}:${port}`, tls: false });
    }
  }
  return out;
}

/** Manual operator endpoints from `pairing.publicBaseUrls`, tagged public. */
export function manualEndpoints(publicBaseUrls: string[] | undefined): TunnelEndpoint[] {
  return (publicBaseUrls ?? [])
    .map((raw) => raw.trim())
    .filter((u) => u.length > 0)
    .map((url) => ({ kind: "public" as const, url, tls: /^(https|wss):\/\//i.test(url) }));
}

export interface CollectArgs {
  /** Endpoints from the active provider's `status()/connect()`. */
  providerEndpoints?: TunnelEndpoint[];
  publicBaseUrls?: string[];
  port: number;
  /** Include LAN/local addresses (default true). */
  includeLocal?: boolean;
}

/** Merge every source into one deduped tagged list. */
export function collectEndpoints(args: CollectArgs): TunnelEndpoint[] {
  const all: TunnelEndpoint[] = [
    ...(args.providerEndpoints ?? []),
    ...manualEndpoints(args.publicBaseUrls),
    ...(args.includeLocal === false ? [] : localEndpoints(args.port)),
  ];
  const seen = new Set<string>();
  const out: TunnelEndpoint[] = [];
  for (const ep of all) {
    const key = ep.url.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
  }
  return out;
}

/**
 * Flatten tagged endpoints to URL strings for the pairing dep
 * (`getReachableUrls`). The https/wss gate is NOT applied here — it stays
 * authoritative in `reachableUrls()`, so a plain-http endpoint flattened here
 * is still dropped before it can enter the pairing payload.
 */
export function toReachableUrlStrings(endpoints: TunnelEndpoint[]): string[] {
  return endpoints.map((e) => e.url);
}
