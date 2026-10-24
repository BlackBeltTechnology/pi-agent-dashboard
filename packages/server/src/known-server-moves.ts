/**
 * Verified move suggestions for renamed known servers.
 *
 * A pinned known entry whose stored address stopped proving its identity, while
 * a discovered peer at another address DOES prove it, gets an in-memory
 * suggestion. Nothing is persisted here: only an operator accepting the
 * suggestion (known-servers-routes `accept-move`) rewrites config. An advert
 * alone never writes anything — every suggestion rests on a passed identity
 * challenge.
 *
 * Challenge surface is bounded: only peers matching a pinned (fingerprint,
 * port); at most one evaluation per (fingerprint, port) per 60 s; targets must
 * be on one of this server's own subnets and not loopback / link-local /
 * unspecified / multicast.
 *
 * An entry is evaluated on its PRIMARY route only (the first `http` route, else the
 * first route — the `host`/`port` mirror): the stored address is re-proved in that
 * route's own scheme and a suggestion moves that route alone; the entry's other
 * routes are untouched. Peers found by mDNS are always `http`.
 *
 * See change: stabilize-mdns-server-identity (D6), group-servers-by-identity (D2).
 */
import net from "node:net";
import os from "node:os";
import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { formatHostPort, normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { primaryRoute, type Route } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import type { ProveResult } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";

/** Min gap between evaluations of one (fingerprint, port). */
const MOVE_CHALLENGE_INTERVAL_MS = 60_000;
/** At most this many addresses of one advert are challenged per evaluation (a shared bridge address may answer as another machine). */
const MOVE_MAX_CHALLENGES = 4;
/** A suggestion not re-verified for this long is withdrawn. */
const MOVE_SUGGESTION_TTL_MS = 10 * 60_000;

export interface MoveTarget {
  host: string;
  port: number;
}

export interface KnownServerMovesDeps {
  loadKnown: () => KnownServer[];
  prove: (baseUrl: string) => Promise<ProveResult>;
  now?: () => number;
  interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  log?: (message: string) => void;
}

interface Suggestion extends MoveTarget {
  /** `normalizeHostKey` of the entry's host when the suggestion was made. */
  fromHost: string;
  verifiedAt: number;
}

export interface KnownServerMoves {
  /** Evaluate a peer on up / update / sweep. */
  onPeer(peer: DiscoveredServer): Promise<void>;
  /** The peer vanished: drop its suggestion. */
  onPeerDown(peer: DiscoveredServer): void;
  /** Current suggestion for a persisted entry, if any. */
  suggestionFor(entry: KnownServer): MoveTarget | undefined;
  /** Drop an entry's suggestion (after accept, or when it proved stale). */
  withdraw(entry: KnownServer, reason: string): void;
}

const keyOf = (fingerprint: string, port: number) => `${fingerprint}|${port}`;
/** The entry's primary route (`routes` is never empty: `parseKnownServers` guarantees one). */
const primaryOf = (entry: KnownServer): Route => primaryRoute(entry.routes) as Route;
const short = (fingerprint: string) => fingerprint.replace(/^sha256:/, "").slice(0, 16);

function isSpecial(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254) || (a >= 224 && a <= 239);
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower === "::" || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

/** True when `address` lies in a subnet of one of this machine's interfaces. */
function isOnLink(address: string, interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): boolean {
  const family = net.isIPv4(address) ? "ipv4" : net.isIPv6(address) ? "ipv6" : undefined;
  if (!family) return false;
  const list = new net.BlockList();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || !info.cidr) continue;
      const prefix = Number(info.cidr.split("/")[1]);
      if (!Number.isInteger(prefix)) continue;
      try {
        list.addSubnet(info.address, prefix, info.family === "IPv4" ? "ipv4" : "ipv6");
      } catch {
        /* skip malformed interface */
      }
    }
  }
  return list.check(address, family);
}

export function createKnownServerMoves(deps: KnownServerMovesDeps): KnownServerMoves {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const interfaces = deps.interfaces ?? os.networkInterfaces;
  const suggestions = new Map<string, Suggestion>();
  const lastEvaluated = new Map<string, number>();

  const drop = (key: string, fingerprint: string, reason: string) => {
    const s = suggestions.get(key);
    if (!s) return;
    suggestions.delete(key);
    log(`[known-servers] move-withdrawn fp=${short(fingerprint)} ${s.fromHost} -> ${s.host}:${s.port} (${reason})`);
  };

  const expire = () => {
    for (const [key, s] of Array.from(suggestions)) {
      if (now() - s.verifiedAt >= MOVE_SUGGESTION_TTL_MS) drop(key, key.split("|")[0], "not re-verified");
    }
  };

  /** Advertised addresses that are safe and on-link to challenge, in advert order. */
  const challengeableAddresses = (peer: DiscoveredServer): string[] => {
    const candidates = peer.addresses?.length ? peer.addresses : net.isIP(peer.host) ? [peer.host] : [];
    const ifaces = interfaces();
    return candidates.filter((a) => net.isIP(a) && !isSpecial(a) && isOnLink(a, ifaces));
  };

  return {
    async onPeer(peer) {
      const fingerprint = peer.fingerprint;
      if (!fingerprint) return;
      expire();
      for (const entry of deps.loadKnown()) {
        const primary = primaryOf(entry);
        if (entry.fingerprint !== fingerprint || primary.port !== peer.port) continue;
        const key = keyOf(fingerprint, peer.port);
        const storedKey = normalizeHostKey(primary.host);
        // The entry already points at where this peer lives — not a move.
        if (storedKey === normalizeHostKey(peer.host) || peer.addresses?.some((a) => normalizeHostKey(a) === storedKey)) {
          drop(key, fingerprint, "peer is at the stored address");
          continue;
        }
        const last = lastEvaluated.get(key);
        if (last !== undefined && now() - last < MOVE_CHALLENGE_INTERVAL_MS) continue;
        lastEvaluated.set(key, now());

        const stored = await deps.prove(`${primary.scheme}://${formatHostPort(primary.host, primary.port)}`);
        if ("proven" in stored && stored.proven === fingerprint) {
          drop(key, fingerprint, "stored address answers again");
          continue;
        }
        const eligible = challengeableAddresses(peer);
        if (eligible.length === 0) {
          log(
            `[known-servers] move-skipped fp=${short(fingerprint)}: no on-link address among ${(peer.addresses ?? [peer.host]).join(", ")}`,
          );
          continue;
        }
        // An advertised address may reach this very machine or another one (shared virtual-bridge IPs):
        // walk them in order and suggest only an address that itself proves the pinned identity.
        let target: string | undefined;
        for (const address of eligible.slice(0, MOVE_MAX_CHALLENGES)) {
          const proof = await deps.prove(`http://${formatHostPort(address, peer.port)}`);
          if ("proven" in proof && proof.proven === fingerprint) {
            target = address;
            break;
          }
        }
        if (!target) continue;
        const existing = suggestions.get(key);
        suggestions.set(key, { host: normalizeHostKey(target), port: peer.port, fromHost: storedKey, verifiedAt: now() });
        if (!existing || existing.host !== normalizeHostKey(target)) {
          log(`[known-servers] move-suggested fp=${short(fingerprint)} ${primary.host} -> ${target}:${peer.port}`);
        }
      }
    },

    onPeerDown(peer) {
      if (!peer.fingerprint) return;
      drop(keyOf(peer.fingerprint, peer.port), peer.fingerprint, "peer disappeared");
    },

    suggestionFor(entry) {
      if (!entry.fingerprint) return undefined;
      expire();
      const primary = primaryOf(entry);
      const s = suggestions.get(keyOf(entry.fingerprint, primary.port));
      return s && s.fromHost === normalizeHostKey(primary.host) ? { host: s.host, port: s.port } : undefined;
    },

    withdraw(entry, reason) {
      if (entry.fingerprint) drop(keyOf(entry.fingerprint, primaryOf(entry).port), entry.fingerprint, reason);
    },
  };
}
