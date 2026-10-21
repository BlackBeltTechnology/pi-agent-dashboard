/**
 * Verified move suggestions (test-plan #E20 #E21 #E22).
 * See change: stabilize-mdns-server-identity
 */

import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import type { ProveResult } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { describe, expect, it, vi } from "vitest";
import { createKnownServerMoves } from "../known-server-moves.js";

const F = "sha256:" + "A".repeat(43);
const T0 = "2026-01-01T00:00:00.000Z";
const IFACES = {
  en0: [{ address: "192.168.16.31", netmask: "255.255.255.0", family: "IPv4", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "192.168.16.31/24" }],
  lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
} as never;

const pinned = (host = "home-imac-75112.local"): KnownServer => ({ host, port: 8000, addedAt: T0, fingerprint: F });
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
  const prove = vi.fn(async (u: string): Promise<ProveResult> => answers[u.replace("http://", "")] ?? { refused: "x" });
  const make = () =>
    createKnownServerMoves({ loadKnown: () => entries, prove, now: () => clock, interfaces: () => IFACES, log: (m) => logs.push(m) });
  return { moves: make(), make, prove, logs, answers, tick: (ms: number) => (clock += ms), entries };
}

describe("E20 advertisement alone pins nothing", () => {
  it("an unpinned entry yields no suggestion and no challenge", async () => {
    const entry: KnownServer = { host: "192.168.16.220", port: 8000, addedAt: T0 };
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
    const e: KnownServer = { host: "home-imac-75112.local", port: 8000, addedAt: T0 };
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
