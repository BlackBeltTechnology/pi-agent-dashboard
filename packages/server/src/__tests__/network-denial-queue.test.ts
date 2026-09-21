/**
 * add-access-grants-and-review — tasks 4.1–4.9.
 *
 * The denial ledger generalizes from a tunnel-only advisory record into the
 * pending-access-request queue behind request→accept (design D5). These tests
 * prove:
 *   - denials from ANY guarded namespace fill the ledger (4.1),
 *   - all four anti-poisoning properties survive (4.2 — the pre-existing
 *     `tunnel-block-events.test.ts` suite is the primary evidence and is left
 *     UNCHANGED; a local four-property test guards the generalized role),
 *   - a refused `Origin` is captured without changing the IP dedupe key (4.3),
 *   - cap eviction degrades to today's terminal 403 and re-records on retry (4.4),
 *   - the queue is readable only by a trusted client (4.5),
 *   - accept writes trust through the existing config path and never mutates
 *     the ledger (4.6),
 *   - non-trustable entries offer no accept action (4.7),
 *   - no unauthenticated inbound endpoint creates a pending entry (4.8).
 *
 * See change: add-access-grants-and-review.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkGuard, createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import {
  acceptTargetFor,
  BlockEventBuffer,
  blockEvents,
} from "../tunnel/tunnel-block-events.js";

/** TEST-NET-3 — never a real peer. */
const UNTRUSTED = "203.0.113.5";
const GENUINE = "203.0.113.9";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, "..");

/** Minimal Fastify reply double, matching the guard's `code`/`send` surface. */
function mockReply() {
  const r: any = { statusCode: 0, body: null };
  r.code = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.send = (b: any) => {
    r.body = b;
    return r;
  };
  return r;
}

function configFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

function readRawConfig(): Record<string, unknown> {
  const p = configFile();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

describe("4.1 — the ledger records denials from any guarded namespace", () => {
  beforeEach(() => blockEvents.clear());

  it("records a denial from a NON-tunnel guarded namespace (/api/sessions)", async () => {
    const hook = createNetworkGuardHook({ trustedNetworks: [] });
    await hook(
      { url: "/api/sessions", method: "GET", ip: UNTRUSTED, headers: {} } as never,
      mockReply() as never,
    );

    const entry = blockEvents.list().find((e) => e.ip === UNTRUSTED);
    expect(entry, "a non-tunnel namespace denial must fill the ledger").toBeDefined();
    expect(entry?.trustable).toBe(true);
  });

  it("records from another guarded namespace too (/editor/x)", async () => {
    const hook = createNetworkGuardHook({ trustedNetworks: [] });
    await hook(
      { url: "/editor/x", method: "GET", ip: UNTRUSTED, headers: {} } as never,
      mockReply() as never,
    );
    expect(blockEvents.list().some((e) => e.ip === UNTRUSTED)).toBe(true);
  });

  it("does NOT record an admitted request", async () => {
    const hook = createNetworkGuardHook({ trustedNetworks: ["10.0.0.0/8"] });
    await hook(
      { url: "/api/sessions", method: "GET", ip: "10.0.0.7", headers: {} } as never,
      mockReply() as never,
    );
    expect(blockEvents.list()).toHaveLength(0);
  });
});

describe("4.2 — the four anti-poisoning properties survive the queue role", () => {
  // The primary evidence is the UNCHANGED pre-existing
  // `tunnel-block-events.test.ts` suite (run separately). This guards the
  // generalized role explicitly, so a future edit that drops a property fails
  // here even if the legacy suite is edited alongside it.
  it("socket-peer dedupe, cap eviction, and trustable classification all hold", () => {
    const b = new BlockEventBuffer(3);
    // dedupe by IP (a flood coalesces)
    for (let i = 0; i < 50; i++) b.record(GENUINE, { proxied: false });
    expect(b.list().filter((e) => e.ip === GENUINE)).toHaveLength(1);
    expect(b.list().find((e) => e.ip === GENUINE)?.count).toBe(50);
    // cap + oldest-distinct eviction
    b.record("10.0.0.1", { proxied: false });
    b.record("10.0.0.2", { proxied: false });
    b.record("10.0.0.3", { proxied: false });
    expect(b.list().length).toBe(3);
    // trustable: loopback and proxy-terminated peers are never trustable
    b.record("127.0.0.1", { proxied: false });
    expect(b.list().find((e) => e.ip === "127.0.0.1")?.trustable).toBe(false);
    b.record("100.64.0.9", { proxied: true });
    expect(b.list().find((e) => e.ip === "100.64.0.9")?.trustable).toBe(false);
  });

  it("records the socket peer the caller passes, never a forwarding header", async () => {
    // The guard passes `request.ip`; a spoofed X-Forwarded-For must not become
    // the recorded key.
    blockEvents.clear();
    const hook = createNetworkGuardHook({ trustedNetworks: [] });
    await hook(
      {
        url: "/api/sessions",
        method: "GET",
        ip: UNTRUSTED,
        headers: { "x-forwarded-for": "1.2.3.4" },
      } as never,
      mockReply() as never,
    );
    expect(blockEvents.list().map((e) => e.ip)).toEqual([UNTRUSTED]);
  });
});

describe("4.3 — a refused origin is captured without changing the dedupe key", () => {
  it("captures the origin, still coalesces by IP, and keeps it on later retries", () => {
    const b = new BlockEventBuffer();
    b.record("203.0.113.20", { proxied: false, origin: "https://a.example" });
    b.record("203.0.113.20", { proxied: false, origin: "https://b.example" });

    const list = b.list();
    expect(list, "dedupe remains by socket-peer IP").toHaveLength(1);
    expect(list[0].count).toBe(2);
    expect(list[0].origin).toBe("https://a.example");

    // an origin-less retry must not erase the captured origin
    b.record("203.0.113.20", { proxied: false });
    expect(b.list()[0].origin).toBe("https://a.example");
  });

  it("the guard records the request's Origin header", async () => {
    blockEvents.clear();
    const hook = createNetworkGuardHook({ trustedNetworks: [] });
    await hook(
      {
        url: "/api/sessions",
        method: "GET",
        ip: UNTRUSTED,
        headers: { origin: "https://refused.example" },
      } as never,
      mockReply() as never,
    );
    expect(blockEvents.list()[0].origin).toBe("https://refused.example");
  });

  it("sanitizes a hostile origin (control characters stripped, length bounded)", () => {
    const b = new BlockEventBuffer();
    b.record("203.0.113.30", {
      proxied: false,
      origin: "https://evil.example\r\n[fake] line",
    });
    expect(b.list()[0].origin).not.toMatch(/[\r\n]/);
    // Exact value, not a `startsWith` URL prefix check: CodeQL flags prefix/substring URL
    // comparisons as incomplete sanitization (js/incomplete-url-substring-sanitization), because
    // `https://evil.example` also prefixes `https://evil.example.evil.com`. `sanitizeOrigin`
    // strips C0/DEL control characters (incl. the injected CRLF) and trims, so the exact result
    // is stronger than the prefix check it replaces.
    expect(b.list()[0].origin).toBe("https://evil.example[fake] line");

    const long = new BlockEventBuffer();
    long.record("203.0.113.31", { proxied: false, origin: `https://${"a".repeat(600)}` });
    expect(long.list()[0].origin?.length).toBeLessThanOrEqual(256);
  });
});

describe("4.4 — eviction under the queue role degrades and re-records", () => {
  it("evicts the oldest distinct IP; the evicted peer's retry re-records it", () => {
    const b = new BlockEventBuffer(2);
    b.record("10.0.0.1", { proxied: false });
    b.record("10.0.0.2", { proxied: false });
    b.record("10.0.0.3", { proxied: false }); // flood evicts 10.0.0.1

    expect(b.list().map((e) => e.ip)).not.toContain("10.0.0.1");
    expect(b.list().length).toBe(2);

    // The peer's retry is recorded again as a fresh pending request — the
    // pre-existing terminal 403 was the only observable while evicted.
    b.record("10.0.0.1", { proxied: false });
    expect(b.list().map((e) => e.ip)).toContain("10.0.0.1");
    expect(b.list().length).toBe(2);
  });

  it("recording a flood has no grant side effect (config is untouched)", () => {
    const before = JSON.stringify(readRawConfig());
    const b = new BlockEventBuffer(5);
    for (let i = 0; i < 100; i++) b.record(`10.0.1.${i}`, { proxied: false });
    expect(JSON.stringify(readRawConfig())).toBe(before);
  });
});

// ─── Route-level: the pending queue and its accept action ────────────────────
describe("4.5–4.8 — pending queue route surface", () => {
  let handle: TestServerHandle;
  const routes: Array<{ method: string | string[]; url: string }> = [];

  beforeAll(async () => {
    handle = await createTestServer({ onRoute: (r) => routes.push(r) });
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
  });

  beforeEach(() => {
    blockEvents.clear();
  });

  const url = (p: string) => `http://127.0.0.1:${handle.httpPort}${p}`;
  /** A tunnel/proxy peer: loopback socket + a forwarding header. */
  const TUNNELED = { "x-forwarded-for": UNTRUSTED };

  it("4.5 lists pending requests to a trusted client", async () => {
    blockEvents.record(GENUINE, { proxied: false, origin: "https://refused.example" });
    const res = await fetch(url("/api/tunnel/block-events"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { events: Array<{ ip: string; origin?: string }> } };
    expect(body.success).toBe(true);
    expect(body.data.events.map((e) => e.ip)).toContain(GENUINE);
    expect(body.data.events.find((e) => e.ip === GENUINE)?.origin).toBe("https://refused.example");
  });

  it("4.5 refuses an unauthenticated read", async () => {
    const res = await fetch(url("/api/tunnel/block-events"), { headers: TUNNELED });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("network_not_allowed");
  });

  it("4.6 accept adds the peer to trusted networks via the existing config write path", async () => {
    blockEvents.record(GENUINE, { proxied: false });
    const ledgerBefore = JSON.stringify(blockEvents.list());

    const res = await fetch(url("/api/tunnel/block-events"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ip: GENUINE }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const cfg = readRawConfig() as { auth?: { bypassHosts?: string[] } };
    expect(cfg.auth?.bypassHosts).toContain(GENUINE);

    // The ledger is advisory: accepting never mutates it.
    expect(JSON.stringify(blockEvents.list())).toBe(ledgerBefore);
  });

  it("4.6 recording/list never mutates trusted-network policy", async () => {
    const before = JSON.stringify(readRawConfig());
    blockEvents.record(UNTRUSTED, { proxied: false });
    await fetch(url("/api/tunnel/block-events"));
    expect(JSON.stringify(readRawConfig())).toBe(before);
  });

  it("4.7 refuses accept for a loopback peer (trusting it would trust the tunnel)", async () => {
    blockEvents.record("127.0.0.1", { proxied: false });
    const before = JSON.stringify(readRawConfig());
    const res = await fetch(url("/api/tunnel/block-events"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ip: "127.0.0.1" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_acceptable");
    expect(JSON.stringify(readRawConfig())).toBe(before);
  });

  it("4.7 refuses accept for a proxy-terminated peer", async () => {
    blockEvents.record("100.64.0.9", { proxied: true });
    const res = await fetch(url("/api/tunnel/block-events"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ip: "100.64.0.9" }),
    });
    expect(res.status).toBe(403);
    expect(acceptTargetFor(blockEvents.list()[0])).toBeNull();
  });

  it("4.7 refuses accept for a peer with no recorded pending request", async () => {
    const res = await fetch(url("/api/tunnel/block-events"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ip: "198.51.100.7" }),
    });
    expect(res.status).toBe(404);
  });

  it("4.8 an unauthenticated remote cannot accept", async () => {
    blockEvents.record(GENUINE, { proxied: false });
    const before = JSON.stringify(readRawConfig());
    const res = await fetch(url("/api/tunnel/block-events"), {
      method: "POST",
      headers: { ...TUNNELED, "content-type": "application/json" },
      body: JSON.stringify({ ip: GENUINE }),
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(readRawConfig())).toBe(before);
  });

  it("4.8 the ledger is written ONLY by the guard (source inventory)", () => {
    // The invariant: no inbound route creates a pending entry. The only
    // non-test module that calls `blockEvents.record` is the network guard.
    const offenders = fs
      .readdirSync(SERVER_SRC, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.parentPath.includes("__tests__"))
      .map((e) => path.join(e.parentPath, e.name))
      .filter((f) => /blockEvents\s*\.\s*record\s*\(/.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(SERVER_SRC, f));
    expect(offenders).toEqual([path.join("auth", "localhost-guard.ts")]);
    // The accept route must not write the ledger either.
    const sysRoutes = fs.readFileSync(path.join(SERVER_SRC, "routes", "system-routes.ts"), "utf-8");
    expect(/blockEvents\s*\.\s*record\s*\(/.test(sysRoutes)).toBe(false);
  });

  it("4.8 route inventory exposes the queue on GET+POST only", () => {
    const blockEventRoutes = routes
      .flatMap((r) => (Array.isArray(r.method) ? r.method : [r.method]).map((m) => `${m} ${r.url}`))
      .filter((r) => r.startsWith("GET ") || r.startsWith("POST "))
      .filter((r) => r.includes("/api/tunnel/block-events"));
    expect(blockEventRoutes.sort()).toEqual([
      "GET /api/tunnel/block-events",
      "POST /api/tunnel/block-events",
    ]);
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────
describe("X9 — ledger recording never disrupts the denial", () => {
  it("swallows a record() throw and still sends the 403", async () => {
    const spy = vi.spyOn(blockEvents, "record").mockImplementation(() => {
      throw new Error("ledger unavailable");
    });
    try {
      const guard = createNetworkGuard([]);
      const reply = mockReply();
      await guard(
        { ip: UNTRUSTED, headers: {}, isAuthenticated: false } as never,
        reply as never,
      );
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error).toBe("network_not_allowed");
    } finally {
      spy.mockRestore();
    }
  });
});
