/**
 * Peer-server registry wiring: mDNS browser events → `peerServers` map +
 * browser broadcast + move-suggestion evaluation, plus the `selfServer` entry.
 *
 * Peers are keyed by the shared `peerKey` (service fqdn). This server excludes
 * itself only when it is local, on its own port AND (when the advert carries a
 * fingerprint) the fingerprint is its own — a machine running a COPY of this
 * server's `identity.key` is listed, not hidden. Adverts without `fp` use the
 * legacy local+port rule.
 *
 * See change: stabilize-mdns-server-identity (D4).
 */
import { type DashboardBrowser, type DiscoveredServer, peerKey } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import type { KnownServerMoves } from "./known-server-moves.js";

export interface PeerSelf {
  fingerprint: string;
  port: number;
  piPort: number;
  version: string;
  /** Display name (`dashboardName` or the OS hostname). */
  name: string;
  /** Host shown for this server in the selector (OS hostname). */
  host: string;
}

function isSelfPeer(peer: DiscoveredServer, self: Pick<PeerSelf, "fingerprint" | "port">): boolean {
  if (!peer.isLocal || peer.port !== self.port) return false;
  return peer.fingerprint ? peer.fingerprint === self.fingerprint : true;
}

/** This server as a `servers_discovered` entry. */
export function buildSelfServer(self: PeerSelf): DiscoveredServer {
  return {
    host: self.host,
    port: self.port,
    piPort: self.piPort,
    version: self.version,
    pid: process.pid,
    isLocal: true,
    source: "mdns",
    fingerprint: self.fingerprint,
    name: self.name,
  };
}

export function wirePeerServers(deps: {
  browser: Pick<DashboardBrowser, "on" | "servers">;
  peers: Map<string, DiscoveredServer>;
  self: () => PeerSelf;
  broadcast: (servers: DiscoveredServer[]) => void;
  moves?: KnownServerMoves;
}): void {
  const { browser, peers, moves } = deps;
  const changed = () => deps.broadcast(Array.from(peers.values()));
  const evaluate = (peer: DiscoveredServer) => {
    void moves?.onPeer(peer).catch((err: unknown) => console.warn("[known-servers] move evaluation failed:", err));
  };

  const upsert = (server: DiscoveredServer) => {
    if (isSelfPeer(server, deps.self())) return;
    peers.set(peerKey(server), server);
    changed();
    evaluate(server);
  };
  browser.on("server-up", upsert);
  browser.on("server-update", upsert);
  browser.on("server-down", (server: DiscoveredServer) => {
    peers.delete(peerKey(server));
    moves?.onPeerDown(server);
    changed();
  });
  // Each refresh sweep re-evaluates every listed peer (rate-limited per identity).
  browser.on("sweep", () => {
    for (const peer of peers.values()) evaluate(peer);
  });
}
