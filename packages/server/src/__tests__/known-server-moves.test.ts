/**
 * Verified move suggestions (test-plan #E20 #E21 #E22).
 * See change: stabilize-mdns-server-identity
 */

import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import type { ProveResult } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import type { Route } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { describe, expect, it, vi } from "vitest";
import { createKnownServerMoves } from "../known-server-moves.js";

const F = "sha256:" + "A".repeat(43);
const T0 = "2026-01-01T00:00:00.000Z";
const IFACES = {
  en0: [{ address: "192.168.16.31", netmask: "255.255.255.0", family: "IPv4", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "192.168.16.31/24" }],
  lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
} as never;

const httpRoute = (host: string, port = 8000): Route => ({ host, port, scheme: "http", source: "saved" });
const unpinned = (host: string): KnownServer => ({ host, port: 8000, addedAt: T0, routes: [httpRoute(host)] });
const pinned = (host = "home-imac-75112.local"): KnownServer => ({ ...unpinned(host), fingerprint: F });
const peer = (over: Partial<DiscoveredServer> = {}): DiscoveredServer => ({
  host: "192.168.16.220",
  port: 8000,
  piPort: 9999,
  version: "0.9.0",
  pid: 1,
  isLocal: false,
  source: "mdns",
  fingerprint: F,
  addresses: ["192.168.16.220"],
  ...over,
});

function mk(entries: KnownServer[], answers: Record<string, ProveResult> = {}) {
  let clock = 1_000_000;
  const logs: string[] = [];
  // http routes key as `host:port`; https routes keep their scheme
  const prove = vi.fn(async (u: string): Promise<ProveResult> => answers[u.replace("http://", "")] ?? { refused: "x" });
  const make = () =>
    createKnownServerMoves({ loadKnown: () => entries, prove, now: () => clock, interfaces: () => IFACES, log: (m) => logs.push(m) });
  return { moves: make(), make, prove, logs, answers, tick: (ms: number) => (clock += ms), entries };
}

describe("E20 advertisement alone pins nothing", () => {
  it("an unpinned entry yields no suggestion and no challenge", async () => {
    const entry = unpinned("192.168.16.220");
    const { moves, prove } = mk([entry]);
    await moves.onPeer(peer());
    expect(moves.suggestionFor(entry)).toBeUndefined();
    expect(prove).not.toHaveBeenCalled();
    expect(entry.fingerprint).toBeUndefined();
  });
});

describe("E21 verified move suggestion", () => {
  it("suggests when stored fails and the on-link peer proves", async () => {
    const e = pinned();
    const { moves, logs } = mk([e], { "192.168.16.220:8000": { proven: F } });
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toEqual({ host: "192.168.16.220", port: 8000 });
    expect(logs.join("\n")).toMatch(/move-suggested fp=A{16} home-imac-75112\.local -> 192\.168\.16\.220:8000/);
  });

  it("no suggestion when the stored address still proves", async () => {
    const e = pinned();
    const { moves } = mk([e], { "home-imac-75112.local:8000": { proven: F }, "192.168.16.220:8000": { proven: F } });
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toBeUndefined();
  });

  it("no suggestion when the peer fails its challenge", async () => {
    const e = pinned();
    const { moves } = mk([e]);
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toBeUndefined();
  });

  it("a different identity proven at the stored address is not a proof of F", async () => {
    const e = pinned();
    const { moves } = mk([e], { "home-imac-75112.local:8000": { proven: "sha256:G" }, "192.168.16.220:8000": { proven: F } });
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toEqual({ host: "192.168.16.220", port: 8000 });
  });

  it("an unpinned entry gets nothing", async () => {
    const e = unpinned("home-imac-75112.local");
    const { moves, prove } = mk([e], { "192.168.16.220:8000": { proven: F } });
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toBeUndefined();
    expect(prove).not.toHaveBeenCalled();
  });

  it("off-link and special addresses are never challenged", async () => {
    for (const addr of ["10.9.9.9", "127.0.0.1", "fe80::5", "0.0.0.0", "224.0.0.1"]) {
      const e = pinned();
      const { moves, prove, logs } = mk([e], { [`${addr}:8000`]: { proven: F } });
      await moves.onPeer(peer({ host: addr, addresses: [addr] }));
      expect(moves.suggestionFor(e)).toBeUndefined();
      expect(prove.mock.calls.map(([u]) => u)).toEqual(["http://home-imac-75112.local:8000"]);
      if (addr === "10.9.9.9") expect(logs.join("\n")).toMatch(/move-skipped/);
    }
  });
});

describe("E22 suggestion rate and lifecycle", () => {
  const setup = async () => {
    const e = pinned();
    const ctx = mk([e], { "192.168.16.220:8000": { proven: F } });
    await ctx.moves.onPeer(peer());
    expect(ctx.moves.suggestionFor(e)).toBeDefined();
    ctx.prove.mockClear();
    return { ...ctx, e };
  };

  it("sends no second challenge before 60 s", async () => {
    const { moves, prove, tick } = await setup();
    tick(30_000);
    await moves.onPeer(peer());
    expect(prove).not.toHaveBeenCalled();
    tick(31_000);
    await moves.onPeer(peer());
    expect(prove).toHaveBeenCalled();
  });

  it("withdraws (and logs) when the stored address proves again", async () => {
    const { moves, e, answers, tick, logs } = await setup();
    answers["home-imac-75112.local:8000"] = { proven: F };
    tick(61_000);
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toBeUndefined();
    expect(logs.join("\n")).toMatch(/move-withdrawn/);
  });

  it("withdraws when the peer disappears", async () => {
    const { moves, e } = await setup();
    moves.onPeerDown(peer());
    expect(moves.suggestionFor(e)).toBeUndefined();
  });

  it("withdraws after 10 minutes without re-verification", async () => {
    const { moves, e, tick, logs } = await setup();
    tick(10 * 60_000 + 1);
    expect(moves.suggestionFor(e)).toBeUndefined();
    expect(logs.join("\n")).toMatch(/move-withdrawn.*not re-verified/);
  });

  it("a new unit instance (restart) holds no suggestion", async () => {
    const { make, e } = await setup();
    expect(make().suggestionFor(e)).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Route-aware suggestions. See change: group-servers-by-identity (#X3, #X8, 3.3, 3.5)
// ════════════════════════════════════════════════════════════════════════
describe("route-aware move suggestions", () => {
  const tunnel: Route = { host: "tunnel.example.org", port: 443, scheme: "https", source: "pairing" };

  it("#X8 evaluates the primary route only: a stale LAN route with a proven tunnel route still gets a suggestion; the tunnel route is not the primary", async () => {
    const e: KnownServer = { ...pinned(), routes: [httpRoute("home-imac-75112.local"), tunnel] };
    const { moves, prove } = mk([e], { "192.168.16.220:8000": { proven: F }, "https://tunnel.example.org:443": { proven: F } });
    await moves.onPeer(peer());
    expect(moves.suggestionFor(e)).toEqual({ host: "192.168.16.220", port: 8000 });
    // the stored (primary) address was proved over http; the tunnel route was never challenged
    expect(prove.mock.calls.map(([u]) => u)).toEqual(["http://home-imac-75112.local:8000", "http://192.168.16.220:8000"]);
  });

  it("#X3 an https primary route is re-proved over https (its own scheme)", async () => {
    const e: KnownServer = { host: "lab.example.org", port: 443, addedAt: T0, fingerprint: F, routes: [{ host: "lab.example.org", port: 443, scheme: "https", source: "saved" }] };
    const { moves, prove } = mk([e], { "192.168.16.220:443": { proven: F } });
    await moves.onPeer(peer({ port: 443 }));
    expect(prove.mock.calls[0][0]).toBe("https://lab.example.org:443");
    expect(moves.suggestionFor(e)).toEqual({ host: "192.168.16.220", port: 443 });
  });

  it("#X8 the suggestion is withdrawn when the primary route proves again, whatever the other routes do", async () => {
    const e: KnownServer = { ...pinned(), routes: [httpRoute("home-imac-75112.local"), tunnel] };
    const ctx = mk([e], { "192.168.16.220:8000": { proven: F } });
    await ctx.moves.onPeer(peer());
    expect(ctx.moves.suggestionFor(e)).toBeDefined();
    ctx.answers["home-imac-75112.local:8000"] = { proven: F };
    ctx.tick(61_000);
    await ctx.moves.onPeer(peer());
    expect(ctx.moves.suggestionFor(e)).toBeUndefined();
    expect(ctx.logs.join("\n")).toMatch(/move-withdrawn/);
  });

  it("a peer on a port that is not the primary route's port is no move (the other route's port does not count)", async () => {
    const e: KnownServer = { ...pinned(), routes: [httpRoute("home-imac-75112.local", 8000), httpRoute("other.local", 9000)] };
    const { moves, prove } = mk([e], { "192.168.16.220:9000": { proven: F } });
    await moves.onPeer(peer({ port: 9000, addresses: ["192.168.16.220"] }));
    expect(moves.suggestionFor(e)).toBeUndefined();
    expect(prove).not.toHaveBeenCalled();
  });
});

// ── harden-peer-address-identity (test-plan #E13): walk the advert's addresses ──
describe("#E13 move suggestion walks the advert's eligible addresses", () => {
  const L = "sha256:" + "L".repeat(43);
  it("skips an address that proves this machine and suggests the one that proves F", async () => {
    const e = pinned();
    const { moves } = mk([e], { "192.168.16.31:8000": { proven: L }, "192.168.16.203:8000": { proven: F } });
    // 192.168.16.31 is this machine's own interface address (on-link); .203 is the peer
    await moves.onPeer(peer({ addresses: ["192.168.16.31", "192.168.16.203"] }));
    expect(moves.suggestionFor(e)).toEqual({ host: "192.168.16.203", port: 8000 });
  });

  it("challenges at most 4 addresses: F only at the 5th ⇒ no suggestion", async () => {
    const e = pinned();
    const addrs = ["192.168.16.51", "192.168.16.52", "192.168.16.53", "192.168.16.54", "192.168.16.55"];
    const { moves, prove } = mk([e], { "192.168.16.55:8000": { proven: F } });
    await moves.onPeer(peer({ addresses: addrs }));
    expect(moves.suggestionFor(e)).toBeUndefined();
    // 1 stored-address challenge + exactly 4 advert addresses
    expect(prove).toHaveBeenCalledTimes(1 + 4);
    expect(prove.mock.calls.map(([u]) => String(u))).not.toContain("http://192.168.16.55:8000");
  });

  it("never suggests an address that proves another identity", async () => {
    const e = pinned();
    const { moves } = mk([e], { "192.168.16.31:8000": { proven: L } });
    await moves.onPeer(peer({ addresses: ["192.168.16.31"] }));
    expect(moves.suggestionFor(e)).toBeUndefined();
  });
});
