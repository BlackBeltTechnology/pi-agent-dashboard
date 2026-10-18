/**
 * Network-only admission telemetry (test-plan E15, E16).
 *
 * E15: a request/upgrade admitted SOLELY because the peer matched the trusted
 * list is counted exactly once (per-route guard + universal hook share one
 * per-request marker); a credentialed one is never counted.
 * E16: the in-memory store is bounded (256 peers, LRU eviction, 7 d window, 1 h
 * per-peer log throttle).
 *
 * See change: retire-trusted-networks-bypass (design D4).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeWsUpgrade } from "../auth/auth-plugin.js";
import { createNetworkGuard, createNetworkGuardHook } from "../auth/localhost-guard.js";
import {
  createNetworkTrustTelemetry,
  LOG_THROTTLE_MS,
  MAX_PEERS,
  networkOnlySnapshot,
  noteNetworkOnlyAdmission,
  resetNetworkTrustTelemetryForTests,
  WINDOW_MS,
} from "../auth/network-trust-telemetry.js";

const LISTED = "192.168.16.20";
const LIST = ["192.168.16.0/24"];
const SECRET = "s".repeat(32);

describe("E15 network-only admissions are counted once", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetNetworkTrustTelemetryForTests();
    app = Fastify({ logger: false });
    // Stands in for the OAuth / bearer hooks: tags the request as authenticated
    // BEFORE the guards run, the way `registerAuthPlugin` / `bearer-auth` do.
    app.addHook("onRequest", async (request) => {
      const via = request.headers["x-test-auth"];
      if (via === "device" || via === "session") {
        (request as any).isAuthenticated = true;
        (request as any).authVia = via;
      }
    });
    // Both guards, exactly as server.ts wires them: universal hook + the
    // per-route preHandler on the same request.
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => LIST, logDenial: () => {} }));
    app.get("/api/sessions", { preHandler: createNetworkGuard(() => LIST) }, async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetNetworkTrustTelemetryForTests();
  });

  const get = (headers: Record<string, string> = {}, remoteAddress = LISTED) =>
    app.inject({ method: "GET", url: "/api/sessions", remoteAddress, headers });

  it("unauthenticated listed peer through BOTH guards counts exactly +1", async () => {
    const before = networkOnlySnapshot().admissions;
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(networkOnlySnapshot().admissions - before).toBe(1);
    expect(networkOnlySnapshot().distinctPeers).toBe(1);
  });

  it("a device-cookie (bearer) request from a listed peer counts +0", async () => {
    const before = networkOnlySnapshot().admissions;
    expect((await get({ "x-test-auth": "device" })).statusCode).toBe(200);
    expect(networkOnlySnapshot().admissions - before).toBe(0);
    expect(networkOnlySnapshot().distinctPeers).toBe(0);
  });

  it("a login-session request from a listed peer counts +0", async () => {
    const before = networkOnlySnapshot().admissions;
    expect((await get({ "x-test-auth": "session" })).statusCode).toBe(200);
    expect(networkOnlySnapshot().admissions - before).toBe(0);
  });

  it("an unlisted, unauthenticated peer is refused and not counted", async () => {
    const before = networkOnlySnapshot().admissions;
    expect((await get({}, "198.51.100.23")).statusCode).toBe(403);
    expect(networkOnlySnapshot().admissions - before).toBe(0);
  });

  it("each separate request counts once (two requests → +2, one peer)", async () => {
    await get();
    await get();
    const snap = networkOnlySnapshot();
    expect(snap.admissions).toBe(2);
    expect(snap.distinctPeers).toBe(1);
  });

  const ws = (extra: Partial<Parameters<typeof authorizeWsUpgrade>[0]> = {}) =>
    authorizeWsUpgrade({
      remoteAddress: LISTED,
      secret: SECRET,
      headers: {},
      trustedNetworks: LIST,
      scope: "browser",
      ...extra,
    });

  it("a ticketed WS upgrade from a listed peer counts +0 (ticket consumed)", () => {
    let consumed = 0;
    const res = ws({
      ticket: "t-1",
      consumeTicket: () => {
        consumed++;
        return { ok: true };
      },
    });
    expect(res.ok).toBe(true);
    expect(consumed).toBe(1);
    expect(networkOnlySnapshot().admissions).toBe(0);
  });

  it("a ticketless WS upgrade from a listed peer counts +1", () => {
    const res = ws({ consumeTicket: () => ({ ok: false, reason: "missing" }) });
    expect(res.ok).toBe(true);
    expect(networkOnlySnapshot().admissions).toBe(1);
    expect(networkOnlySnapshot().distinctPeers).toBe(1);
  });

  it("a ticketless WS upgrade with an INVALID ticket still counts (the match alone admitted it)", () => {
    const res = ws({ ticket: "bad", consumeTicket: () => ({ ok: false, reason: "unknown" }) });
    expect(res.ok).toBe(true);
    expect(networkOnlySnapshot().admissions).toBe(1);
  });

  it("an unlisted ticketless WS upgrade is refused and not counted", () => {
    expect(ws({ remoteAddress: "198.51.100.23" }).ok).toBe(false);
    expect(networkOnlySnapshot().admissions).toBe(0);
  });

  it("the per-request marker dedupes a source seen by two guards", () => {
    const source = { ip: LISTED };
    noteNetworkOnlyAdmission(source);
    noteNetworkOnlyAdmission(source);
    expect(networkOnlySnapshot().admissions).toBe(1);
  });
});

describe("E16 telemetry bounds (fake clock)", () => {
  const T0 = Date.UTC(2026, 0, 1, 12, 17, 33, 0); // deliberately not hour-aligned
  const peer = (ip: string) => ({ ip });

  it("257th peer evicts the LEAST RECENTLY SEEN, not the re-seen oldest", () => {
    const lines: string[] = [];
    const t = createNetworkTrustTelemetry((l) => lines.push(l));
    for (let i = 0; i < MAX_PEERS; i++) t.note(peer(`10.0.${Math.floor(i / 256)}.${i % 256}`), T0 + i);
    expect(t.snapshot(T0 + MAX_PEERS).distinctPeers).toBe(MAX_PEERS);

    // The oldest peer (10.0.0.0) is re-seen; the next-oldest (10.0.0.1) is now the LRU.
    const tReseen = T0 + 10 * 60_000;
    t.note(peer("10.0.0.0"), tReseen);
    const t257 = tReseen + 60_000; // the oldest was re-seen 1 min ago
    t.note(peer("172.16.0.1"), t257);
    expect(t.snapshot(t257).distinctPeers).toBe(MAX_PEERS);

    // Observable via the per-peer log throttle: a retained peer inside its
    // throttle window stays silent; an evicted peer logs as new again.
    lines.length = 0;
    t.note(peer("10.0.0.0"), t257 + 1_000);
    expect(lines).toHaveLength(0); // re-seen peer survived (and is throttled)
    t.note(peer("10.0.0.1"), t257 + 2_000);
    expect(lines).toHaveLength(1); // the LRU was evicted
    expect(lines[0]).toContain("10.0.0.1");
  });

  it("a peer last seen 7 d + 1 ms ago is gone from the snapshot; exactly 7 d is kept", () => {
    const t = createNetworkTrustTelemetry(() => {});
    t.note(peer("192.168.16.20"), T0);
    expect(t.snapshot(T0 + WINDOW_MS).distinctPeers).toBe(1);
    expect(t.snapshot(T0 + WINDOW_MS + 1).distinctPeers).toBe(0);
    // Counters age out too (hour-bucketed, so within one bucket of the window).
    const after = t.snapshot(T0 + WINDOW_MS + 60 * 60_000 + 1);
    expect(after).toEqual({ admissions: 0, distinctPeers: 0, lastAt: null });
  });

  it("a stale peer ages out while a refreshed one stays", () => {
    const t = createNetworkTrustTelemetry(() => {});
    t.note(peer("10.1.1.1"), T0);
    t.note(peer("10.2.2.2"), T0 + 1_000);
    t.note(peer("10.1.1.1"), T0 + WINDOW_MS); // refreshed just in time
    // 10.2.2.2 was last seen 7 d − 1 s before this point … not yet stale.
    expect(t.snapshot(T0 + WINDOW_MS + 500).distinctPeers).toBe(2);
    expect(t.snapshot(T0 + WINDOW_MS + 1_001).distinctPeers).toBe(1);
  });

  it("50 admissions within 59 min → one log line; one more at 61 min → a second", () => {
    const lines: string[] = [];
    const t = createNetworkTrustTelemetry((l) => lines.push(l));
    for (let i = 0; i < 50; i++) t.note(peer("192.168.16.20"), T0 + Math.floor((i * 59 * 60_000) / 49));
    expect(lines).toHaveLength(1);
    expect(t.snapshot(T0 + 59 * 60_000).admissions).toBe(50);
    t.note(peer("192.168.16.20"), T0 + 61 * 60_000);
    expect(lines).toHaveLength(2);
    expect(t.snapshot(T0 + 61 * 60_000).admissions).toBe(51);
  });

  it("the throttle boundary is exactly LOG_THROTTLE_MS from the previous line", () => {
    const lines: string[] = [];
    const t = createNetworkTrustTelemetry((l) => lines.push(l));
    t.note(peer("192.168.16.20"), T0);
    t.note(peer("192.168.16.20"), T0 + LOG_THROTTLE_MS - 1);
    expect(lines).toHaveLength(1);
    t.note(peer("192.168.16.20"), T0 + LOG_THROTTLE_MS);
    expect(lines).toHaveLength(2);
  });

  it("the throttle is per peer, and a log line names the peer", () => {
    const lines: string[] = [];
    const t = createNetworkTrustTelemetry((l) => lines.push(l));
    t.note(peer("192.168.16.20"), T0);
    t.note(peer("192.168.16.21"), T0 + 1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("192.168.16.20");
    expect(lines[0]).toContain("[trusted-networks]");
  });

  it("snapshot exposes counts only — never a peer address", () => {
    const t = createNetworkTrustTelemetry(() => {});
    t.note(peer("192.168.16.20"), T0);
    const snap = t.snapshot(T0);
    expect(Object.keys(snap).sort()).toEqual(["admissions", "distinctPeers", "lastAt"]);
    expect(JSON.stringify(snap)).not.toContain("192.168");
  });
});
