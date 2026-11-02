/**
 * `GET /api/health` reports the caller's own network-guard verdict (`networkAccess`) with
 * no admission side effects, bounded config I/O and exact-path session tagging.
 *
 * See change: surface-network-denial-on-health (test-plan #E1–#E13, #X3–#X5, #P1–#P3).
 */
import fs from "node:fs";
import path from "node:path";
import {
  GENERIC_NETWORK_DENIED_HINT,
  NETWORK_NOT_ALLOWED,
} from "@blackbelt-technology/pi-dashboard-shared/network-denial-signal.js";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../auth/auth.js";
import { evaluateNetworkPass, setNetworkDenialObserver } from "../auth/localhost-guard.js";
import { networkOnlySnapshot } from "../auth/network-trust-telemetry.js";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import { type TrustModeHome, useTrustModeHome } from "../test-support/trust-mode-home.js";
import { blockEvents } from "../tunnel/tunnel-block-events.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const github = { github: { clientId: "cid", clientSecret: "cs" } };
const REMOTE = "192.168.16.31";
const sessionCookie = () => `pi_dash_token=${signToken({ sub: "a@x", name: "A", username: "a", provider: "github" }, SECRET)}`;
const FIELD = { error: NETWORK_NOT_ALLOWED, hint: GENERIC_NETWORK_DENIED_HINT };

let th: TrustModeHome;
let handle: TestServerHandle | undefined;

beforeEach(() => {
  th = useTrustModeHome();
  blockEvents.clear();
});
afterEach(async () => {
  setNetworkDenialObserver(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  await handle?.stop();
  handle = undefined;
  th.restore();
});

async function boot(
  cfg: Parameters<TrustModeHome["setTrustConfig"]>[0],
  extra: Partial<Parameters<typeof createTestServer>[0]> = {},
): Promise<TestServerHandle> {
  th.setTrustConfig(cfg);
  handle = await createTestServer(extra);
  return handle;
}
const oauth = { authConfig: { secret: SECRET, providers: github } as AuthConfig };

async function get(url: string, headers: Record<string, string> = {}, remoteAddress = REMOTE) {
  const res = await handle!.server.inject({ method: "GET", url, remoteAddress, headers });
  let body: Record<string, unknown> = {};
  try { body = res.json(); } catch { /* non-JSON */ }
  return { status: res.statusCode, body };
}

describe("health verdict (real wired server)", () => {
  it("E1/E2 unpaired remote: health field present, guarded route 403 with the same hint", async () => {
    await boot({ trustMode: "pair" });
    const h = await get("/api/health");
    expect(h.status).toBe(200);
    expect(h.body.networkAccess).toEqual(FIELD);
    expect(h.body.localProof).toBeUndefined();
    const g = await get("/api/paired-devices");
    expect(g.status).toBe(403);
    expect(g.body.error).toBe(FIELD.error);
    expect(g.body.hint).toBe(FIELD.hint);
  }, 60_000);

  it("E3 OAuth-seeded: field present, guarded route 401", async () => {
    await boot({ trustMode: "pair" }, oauth);
    expect((await get("/api/health")).body.networkAccess).toEqual(FIELD);
    expect((await get("/api/paired-devices")).status).toBe(401);
  }, 60_000);

  it("E4 passkeys-only: field present", async () => {
    await boot({ trustMode: "pair", extra: { auth: { passkeys: { enabled: true } } } });
    expect((await get("/api/health")).body.networkAccess).toEqual(FIELD);
  }, 60_000);

  it("E5/E7/E13 admitted callers see no field; exact-path tagging", async () => {
    await boot({ trustMode: "pair" }, oauth);
    const mint = await proofFetch(`http://127.0.0.1:${handle!.httpPort}/api/paired-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "e5" }),
    });
    const token = ((await mint.json()) as { data: { token: string } }).data.token;
    expect((await get("/api/health", { authorization: `Bearer ${token}` })).body.networkAccess).toBeUndefined();
    expect((await get("/api/health", { cookie: sessionCookie() })).body.networkAccess).toBeUndefined();
    expect((await get("/api/health?x=1", { cookie: sessionCookie() })).body.networkAccess).toBeUndefined();
    expect((await get("/api/health?probe=1", { cookie: sessionCookie() })).body.networkAccess).toBeUndefined();
    // Not prefix-matched: /api/healthcheck is not the health exemption.
    const hc = await get("/api/healthcheck", { cookie: sessionCookie() });
    expect(hc.body.networkAccess).toBeUndefined();
    expect(hc.status).not.toBe(200);
    // loopback + proof
    const proofed = await proofFetch(`http://127.0.0.1:${handle!.httpPort}/api/health`);
    expect(((await proofed.json()) as Record<string, unknown>).networkAccess).toBeUndefined();
  }, 60_000);

  it("E5f/E9 legacy covering list admits; presence tracks own admission", async () => {
    await boot({ trustMode: "legacy", trustedNetworks: ["192.168.16.0/24"] });
    expect((await get("/api/health")).body.networkAccess).toBeUndefined();
    expect((await get("/api/paired-devices")).body.error).not.toBe(NETWORK_NOT_ALLOWED);
    await handle!.stop();
    handle = undefined;
    await boot({ trustMode: "pair" });
    expect((await get("/api/health")).body.networkAccess).toEqual(FIELD);
    expect((await get("/api/paired-devices")).status).toBe(403);
  }, 60_000);

  it("E6/E10 bare loopback under strict: localProof only", async () => {
    await boot({});
    const res = await fetch(`http://127.0.0.1:${handle!.httpPort}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.localProof).toBe("required");
    expect(body.networkAccess).toBeUndefined();
  }, 60_000);

  it("E8 value carries no posture, identical across modes", async () => {
    await boot({ trustMode: "pair" });
    const a = await get("/api/health");
    await handle!.stop();
    handle = undefined;
    await boot({ trustMode: "legacy", trustedNetworks: ["10.0.0.0/8"] });
    const b = await get("/api/health");
    expect(a.body.networkAccess).toEqual(b.body.networkAccess);
    const blob = JSON.stringify(b.body.networkAccess);
    for (const leak of ["192.168", "10.0.0.0", "pair", "legacy"]) expect(blob).not.toContain(leak);
    expect(b.body.accessGrants).toBeFalsy();
    expect(b.body.trustPosture).toBeFalsy();
  }, 60_000);

  it("X3/X4 health polling has no denial or network-only side effects", async () => {
    await boot({ trustMode: "pair" });
    const observer = vi.fn();
    setNetworkDenialObserver(observer);
    for (let i = 0; i < 20; i++) await get("/api/health");
    expect(observer).not.toHaveBeenCalled();
    expect(blockEvents.list().length).toBe(0);
    await get("/api/paired-devices");
    expect(observer).toHaveBeenCalledTimes(1);
    await handle!.stop();
    handle = undefined;

    await boot({ trustMode: "legacy", trustedNetworks: ["192.168.16.0/24"] });
    const before = networkOnlySnapshot();
    for (let i = 0; i < 20; i++) await get("/api/health");
    expect(networkOnlySnapshot().admissions).toBe(before.admissions);
    await get("/api/paired-devices");
    expect(networkOnlySnapshot().admissions).toBe(before.admissions + 1);
  }, 60_000);
});

describe("verdict I/O bound and staleness (real wired server)", () => {
  /** Config `statSync` calls attributable to the verdict (stack passes through `memoAdmissionList`). */
  let attributed = 0;
  const spyStats = () => {
    attributed = 0;
    const orig = fs.statSync;
    return vi.spyOn(fs, "statSync").mockImplementation(((...args: Parameters<typeof fs.statSync>) => {
      if (String(args[0]).endsWith(path.join(".pi", "dashboard", "config.json")) && /memoAdmissionList/.test(new Error().stack ?? "")) attributed++;
      return (orig as (...a: unknown[]) => unknown)(...args);
    }) as never);
  };

  it("P1 ≤1 config statSync per TTL window; P3 refresh count; X5 staleness bound", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await boot({ trustMode: "pair" });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    await get("/api/health"); // prime
    spyStats();
    for (let i = 0; i < 100; i++) await get("/api/health");
    expect(attributed).toBeLessThanOrEqual(1);
    attributed = 0;
    vi.setSystemTime(new Date("2030-01-01T00:00:00.500Z"));
    await get("/api/health");
    vi.setSystemTime(new Date("2030-01-01T00:00:01.100Z"));
    await get("/api/health");
    expect(attributed).toBe(1); // t=0 refresh was in the priming request; only t=1.1 s refreshes

    // X5: switch to a covering legacy list; ≥1 s later the verdict follows.
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: ["192.168.16.0/24"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:02.500Z"));
    expect((await get("/api/health")).body.networkAccess).toBeUndefined();
  }, 60_000);
});

describe("evaluateNetworkPass (pure core)", () => {
  const req = (over: Record<string, unknown> = {}) =>
    ({ ip: REMOTE, headers: {}, url: "/api/health", routeOptions: { url: "/api/health" }, ...over }) as never;

  it("E12 arms, and the admission list is read only when no earlier arm admits", () => {
    const readTrusted = vi.fn(() => ["192.168.16.0/24"]);
    const strict = createLocalTrustContext("t".repeat(32), () => true);
    const o = { readTrusted, localToken: undefined, localTrust: strict };
    expect(evaluateNetworkPass(req({ isAuthenticated: true }), o).passed).toBe("auth");
    expect(readTrusted).not.toHaveBeenCalled();
    const t = evaluateNetworkPass(req(), o);
    expect(t).toEqual({ passed: "trusted", trustedList: ["192.168.16.0/24"] });
    const none = evaluateNetworkPass(req({ ip: "203.0.113.9" }), o);
    expect(none.passed).toBeNull();
    expect(none.trustedList).toBeDefined();
  });
});
