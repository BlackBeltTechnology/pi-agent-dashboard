import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCorsOriginAllowed } from "../auth/cors-origin.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import {
  configSnapshotParseCount,
  liveCorsAllowedOrigins,
  liveTrustedNetworks,
  resetConfigSnapshot,
} from "../config-snapshot.js";

/**
 * Tests the REAL CORS origin decision (`cors-origin.ts`), imported directly —
 * no hand-mirrored copy to drift out of sync. `server.ts` calls the same
 * function, so these assertions pin the exact production behavior.
 */

function allowed(
  origin: string | undefined,
  opts: { configured?: string[]; trusted?: string[]; tunnelUrl?: string | null } = {},
): boolean {
  return isCorsOriginAllowed(origin, {
    configuredOrigins: opts.configured ?? [],
    trustedNetworks: opts.trusted ?? [],
    getTunnelUrl: () => opts.tunnelUrl ?? null,
  });
}

describe("CORS origin validation", () => {
  it("allows requests with no origin (same-origin)", () => {
    expect(allowed(undefined)).toBe(true);
  });

  it("allows localhost on any port", () => {
    expect(allowed("http://localhost:3000")).toBe(true);
    expect(allowed("http://localhost:5173")).toBe(true);
    expect(allowed("https://localhost:8443")).toBe(true);
  });

  it("allows 127.0.0.1 on any port", () => {
    expect(allowed("http://127.0.0.1:3000")).toBe(true);
  });

  it("allows configured origins", () => {
    expect(allowed("https://dashboard.example.com", { configured: ["https://dashboard.example.com"] })).toBe(true);
  });

  it("allows the neutral static PWA shell", () => {
    expect(allowed("https://pi-dashboard.dev")).toBe(true);
  });

  it("rejects the opaque `Origin: null` (sandboxed live-server iframe, D7)", () => {
    expect(allowed("null")).toBe(false);
    // Even if someone mis-configured it, the explicit guard wins.
    expect(allowed("null", { configured: ["null"] })).toBe(false);
  });

  it("rejects unknown origins", () => {
    expect(allowed("https://evil.example.com")).toBe(false);
    expect(allowed("https://evil.example.com", { configured: ["https://good.example.com"] })).toBe(false);
  });

  it("rejects non-localhost remote origins without config", () => {
    expect(allowed("http://192.168.1.100:3000")).toBe(false);
  });

  describe("zrok tunnel origins (browser module-script regression)", () => {
    it("allows the currently-active tunnel URL", () => {
      const tunnelUrl = "https://cwanni9wce66.share.zrok.io";
      expect(allowed(tunnelUrl, { tunnelUrl })).toBe(true);
    });

    it("allows any *.share.zrok.io origin (URL rotation, stale tabs)", () => {
      expect(allowed("https://tgbdzzvlar6b.share.zrok.io")).toBe(true);
      expect(allowed("https://anyothershare123.share.zrok.io")).toBe(true);
    });

    it("does not allow non-zrok sibling hosts", () => {
      expect(allowed("https://share.zrok.io.attacker.com")).toBe(false);
      expect(allowed("https://evil.io")).toBe(false);
    });

    // support-zrok-v2 (E16/E17): plural v2 host allowed; spoof denied.
    it("E16: allows a v2 *.shares.zrok.io origin", () => {
      expect(allowed("https://x.shares.zrok.io")).toBe(true);
    });

    it("E17: denies a spoofed *.shares.zrok.io.attacker.com origin", () => {
      expect(allowed("https://foo.shares.zrok.io.attacker.com")).toBe(false);
    });
  });

  // Trusted-network origins for LAN-to-LAN switching.
  // See change: fix-remote-connect-cors-gates.
  describe("trusted-network origins (LAN-to-LAN switching)", () => {
    it("allows an origin whose host is in a trusted CIDR", () => {
      expect(allowed("http://192.168.16.242:8000", { trusted: ["192.168.16.0/24"] })).toBe(true);
    });

    it("allows an exact-IP trusted entry", () => {
      expect(allowed("http://10.0.0.5:8000", { trusted: ["10.0.0.5"] })).toBe(true);
    });

    it("allows a wildcard trusted entry", () => {
      expect(allowed("http://192.168.7.31:8000", { trusted: ["192.168.*.*"] })).toBe(true);
    });

    it("rejects an origin host NOT in any trusted network", () => {
      expect(allowed("http://192.168.99.5:8000", { trusted: ["192.168.16.0/24"] })).toBe(false);
    });

    it("preserves the null-origin refusal even with a permissive trusted network", () => {
      expect(allowed("null", { trusted: ["0.0.0.0/0"] })).toBe(false);
    });

    it("empty trusted networks preserves prior behavior (LAN origin denied)", () => {
      expect(allowed("http://192.168.16.242:8000", { trusted: [] })).toBe(false);
    });

    it("does not treat a DNS hostname as a trusted-network match", () => {
      // isBypassedHost matches IPs; a DNS name in a trusted CIDR does not match.
      expect(allowed("http://myhost.local:8000", { trusted: ["192.168.16.0/24"] })).toBe(false);
    });
  });
});

// ─── D15: the CORS allow-list is read LIVE, not captured at boot ─────────────
//
// `server.ts` used to close its `origin` callback over a boot snapshot, so an
// origin added by the gateway action stayed denied until restart — and a denied
// origin is exactly the ERR_ABORTED module-script failure this change exists to
// fix. These assertions run against the REAL expressions the server calls
// (`liveCorsAllowedOrigins` / `liveTrustedNetworks`), not a mirrored copy.
// Test plan rows: G23, G24, P3, P4, P5.
// See change: config-override-oauth-redirect-base.
describe("live config reads (D15)", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  function writeConfig(value: unknown) {
    fs.writeFileSync(configFile, JSON.stringify(value));
    resetConfigSnapshot();
  }

  /** Rewrite WITHOUT resetting — the cache must notice by itself. */
  function rewriteBehindTheCache(value: unknown) {
    fs.writeFileSync(configFile, JSON.stringify(value));
  }

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-config-"));
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
    resetConfigSnapshot();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
    resetConfigSnapshot();
  });

  // #G23
  it("admits an origin added after boot, with no restart", () => {
    writeConfig({ cors: { allowedOrigins: [] } });
    const decide = () =>
      isCorsOriginAllowed("https://pi.example.com", {
        configuredOrigins: liveCorsAllowedOrigins(),
        trustedNetworks: liveTrustedNetworks(),
        getTunnelUrl: () => null,
      });
    expect(decide()).toBe(false);

    rewriteBehindTheCache({ cors: { allowedOrigins: ["https://pi.example.com"] } });
    expect(decide()).toBe(true);
  });

  // #G24 — the same liveness for the trusted-network gate: for an `http://`
  // gateway that list is the ONLY way in.
  it("admits a CIDR added after boot, with no restart", async () => {
    writeConfig({ trustedNetworks: [] });
    const app = Fastify();
    app.addHook("preHandler", createNetworkGuard(() => liveTrustedNetworks()));
    app.get("/api/config", async () => ({ success: true }));
    await app.ready();

    const before = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "10.4.0.9" });
    expect(before.statusCode).toBe(403);

    rewriteBehindTheCache({ trustedNetworks: ["10.4.0.0/24"] });
    const after = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "10.4.0.9" });
    expect(after.statusCode).toBe(200);
    await app.close();
  });

  // #P3 / #P4 — an unchanged config must cost exactly ONE read+parse no matter
  // how many decisions ride on it. `networkGuard` is a preHandler on EVERY
  // request, so a per-call `loadConfig()` would be a per-request file read.
  it("parses the config once across 1k origin decisions and 10k guard reads", () => {
    writeConfig({ cors: { allowedOrigins: ["https://pi.example.com"] }, trustedNetworks: ["10.0.0.0/8"] });
    // resetConfigSnapshot() ran inside writeConfig, so the counter starts at 0.
    for (let i = 0; i < 1000; i++) liveCorsAllowedOrigins();
    for (let i = 0; i < 10_000; i++) liveTrustedNetworks();
    expect(configSnapshotParseCount()).toBe(1);
  });

  it("keeps the steady-state read cheap", () => {
    writeConfig({ trustedNetworks: ["10.0.0.0/8"] });
    liveTrustedNetworks();
    const started = performance.now();
    const N = 10_000;
    for (let i = 0; i < N; i++) liveTrustedNetworks();
    const perCallUs = ((performance.now() - started) * 1000) / N;
    // Budget: a `statSync` is ~2 µs and a full read+parse ~25 µs. 50 µs leaves
    // headroom for a loaded CI box while still failing loudly if someone
    // reinstates a per-call read+parse.
    expect(perCallUs).toBeLessThan(50);
  });

  // #P5 — the cache MUST stay mtime-gated. Turning it into a boot snapshot
  // would silently reinstate the very bug D15 exists to fix, and every other
  // assertion here would still pass.
  it("observes a rewrite that happens mid-run, without an explicit invalidation", () => {
    writeConfig({ trustedNetworks: ["10.0.0.0/8"] });
    const observed: string[][] = [];
    for (let i = 0; i < 100; i++) {
      if (i === 50) rewriteBehindTheCache({ trustedNetworks: ["192.168.0.0/16"] });
      observed.push(liveTrustedNetworks());
    }
    expect(observed[49]).toEqual(["10.0.0.0/8"]);
    expect(observed[99]).toEqual(["192.168.0.0/16"]);
    expect(configSnapshotParseCount()).toBe(2);
  });
});
