/**
 * B18 — pairing audit lines (harden-auth-credentials D2; test-plan AE24–AE28,
 * AE33, AE65, AE66, AX11(a), AX12).
 *
 * A sibling of `pairing.test.ts` (which another section edits concurrently).
 * The session is simulated the way the auth plugin tags one: `authVia` plus the
 * verified `sessionPayload` (the audit actor reads its `sub`).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";

const LOCAL_TOKEN = "local-secret-token";

let tmpDir: string;
let regPath: string;
let sessionSub: string | undefined;
let captured: string[];
const apps: FastifyInstance[] = [];
const spies: { mockRestore(): void }[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pairing-audit-"));
  regPath = path.join(tmpDir, "paired.json");
  sessionSub = "alice@example.com";
  captured = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      }),
    );
  }
});

afterEach(async () => {
  vi.useRealTimers();
  for (const s of spies.splice(0)) s.mockRestore();
  for (const app of apps.splice(0)) await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Seed a registry file with explicit ids (the registry mints UUIDs itself). */
function seedRegistry(
  rows: { id: string; token: string; tier?: string; pairedAt?: number; expiresAt?: number }[],
): PairedDeviceRegistry {
  fs.writeFileSync(
    regPath,
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        label: `L-${r.id}`,
        tokenHash: sha(r.token),
        createdAt: new Date(0).toISOString(),
        lastSeen: null,
        source: "pairing",
        tier: r.tier ?? "operate",
        ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt, pairedAt: r.pairedAt } : {}),
      })),
    ),
  );
  return new PairedDeviceRegistry(regPath);
}

async function mkApp(reg: PairedDeviceRegistry, opts: { pairing?: PairingManager } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  stampLegacyHook(app, LOCAL_TOKEN);
  apps.push(app);
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") {
      const r = req as unknown as { authVia: string; sessionPayload: { sub?: string } };
      r.authVia = "session";
      r.sessionPayload = { sub: sessionSub };
    }
  });
  registerBearerAuth(app, { registry: reg });
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity: {} as never,
    pairing: opts.pairing ?? ({} as never),
    registry: reg,
    localToken: LOCAL_TOKEN,
    hostAdmission: () => ({
      allowedHosts: [],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      bindHost: "localhost",
    }),
  });
  await app.ready();
  return app;
}

const SESSION = { "x-test-session": "1" };

const revoke = (
  app: FastifyInstance,
  id: string,
  opts: { ip?: string; headers?: Record<string, string> } = {},
) =>
  app.inject({
    method: "DELETE",
    url: `/api/paired-devices/${encodeURIComponent(id)}`,
    remoteAddress: opts.ip ?? "203.0.113.9",
    headers: opts.headers ?? SESSION,
  });

const mint = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  opts: { ip?: string; headers?: Record<string, string> } = {},
) =>
  app.inject({
    method: "POST",
    url: "/api/paired-devices",
    remoteAddress: opts.ip ?? "203.0.113.9",
    headers: { "content-type": "application/json", ...(opts.headers ?? SESSION) },
    payload,
  });

const linesWith = (needle: string) => captured.filter((l) => l.includes(needle));

describe("AE24 — device revoke is logged", () => {
  it("AE24: one `[pairing] revoked` line with the 8-char id, session actor and socket ip; no bearer/hash", async () => {
    const token = "bearer-token-AE24-canary";
    const reg = seedRegistry([{ id: "d0123456789abcdef", token }]);
    const app = await mkApp(reg);
    const res = await revoke(app, "d0123456789abcdef");
    expect(res.statusCode).toBe(200);
    const lines = linesWith("[pairing] revoked");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[pairing\] revoked id=d0123456 actor=session:\S{1,8} ip=203\.0\.113\.9$/);
    const all = captured.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain(sha(token));
  });
});

describe("AE25 — actor vocabulary by caller kind", () => {
  it("AE25: session / local token / loopback / device bearer on revoke and mint", async () => {
    const deviceToken = "device-bearer-AE25";
    const reg = seedRegistry([
      { id: "aaaaaaaa00000001", token: "t1" },
      { id: "aaaaaaaa00000002", token: "t2" },
      { id: "aaaaaaaa00000003", token: "t3" },
      { id: "aaaaaaaa00000004", token: "t4" },
      { id: "dddddddd00000009", token: deviceToken },
    ]);
    const app = await mkApp(reg);
    const token = { "x-pi-local-token": LOCAL_TOKEN };

    expect((await revoke(app, "aaaaaaaa00000001", { headers: SESSION })).statusCode).toBe(200);
    expect((await revoke(app, "aaaaaaaa00000002", { headers: token })).statusCode).toBe(200);
    expect((await revoke(app, "aaaaaaaa00000003", { ip: "127.0.0.1", headers: {} })).statusCode).toBe(200);
    const revoked = linesWith("[pairing] revoked");
    expect(revoked).toHaveLength(3);
    expect(revoked[0]).toMatch(/^\[pairing\] revoked id=aaaaaaaa actor=session:\S{1,8} ip=203\.0\.113\.9$/);
    expect(revoked[1]).toMatch(/ actor=local ip=203\.0\.113\.9$/);
    expect(revoked[2]).toMatch(/ actor=local ip=127\.0\.0\.1$/);

    captured.length = 0;
    expect((await mint(app, { label: "m1" }, { headers: SESSION })).statusCode).toBe(200);
    expect((await mint(app, { label: "m2" }, { headers: token })).statusCode).toBe(200);
    expect((await mint(app, { label: "m3" }, { ip: "127.0.0.1", headers: {} })).statusCode).toBe(200);
    const minted = linesWith("[pairing] minted");
    expect(minted).toHaveLength(3);
    expect(minted[0]).toMatch(/ actor=session:\S{1,8} ip=203\.0\.113\.9$/);
    expect(minted[1]).toMatch(/ actor=local ip=203\.0\.113\.9$/);
    expect(minted[2]).toMatch(/ actor=local ip=127\.0\.0\.1$/);

    captured.length = 0;
    const bearer = { authorization: `Bearer ${deviceToken}` };
    expect((await revoke(app, "aaaaaaaa00000004", { headers: bearer })).statusCode).toBe(401);
    expect((await mint(app, { label: "clone" }, { headers: bearer })).statusCode).toBe(401);
    expect(linesWith("revoked")).toHaveLength(0);
    expect(linesWith("minted")).toHaveLength(0);
  });
});

describe("AE26 — token mint is logged", () => {
  it("AE26: `[pairing] minted id=<8> tier=control actor=… ip=…`; plaintext token absent from all output", async () => {
    const reg = seedRegistry([]);
    const app = await mkApp(reg);
    const res = await mint(app, { label: "mcp", tier: "control" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { data: { token: string; device: { id: string } } };
    const lines = linesWith("[pairing] minted");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `[pairing] minted id=${body.data.device.id.slice(0, 8)} tier=control actor=session:alice_ex ip=203.0.113.9`,
    );
    const all = captured.join("\n");
    expect(all).not.toContain(body.data.token);
    expect(all).not.toContain(sha(body.data.token));
  });
});

describe("AE27 — peer ip is the socket peer only", () => {
  it("AE27: forwarding headers never reach the line", async () => {
    const reg = seedRegistry([{ id: "d0123456789abcdef", token: "t" }]);
    const app = await mkApp(reg);
    const res = await revoke(app, "d0123456789abcdef", {
      ip: "127.0.0.1",
      headers: {
        ...SESSION,
        "x-forwarded-for": "203.0.113.7",
        forwarded: "for=198.51.100.9",
        "x-real-ip": "203.0.113.8",
      },
    });
    expect(res.statusCode).toBe(200);
    const lines = linesWith("[pairing] revoked");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ ip=127\.0\.0\.1$/);
    for (const forged of ["203.0.113.7", "198.51.100.9", "203.0.113.8"]) expect(lines[0]).not.toContain(forged);
  });
});

describe("AE28 — log values are injection-safe", () => {
  it("AE28: a newline-bearing `sub` yields exactly one record with only safe values", async () => {
    sessionSub = "a\n[pairing] revoked id=ffffffff";
    const reg = seedRegistry([{ id: "d0123456789abcdef", token: "t" }]);
    const app = await mkApp(reg);
    const res = await revoke(app, "d0123456789abcdef");
    expect(res.statusCode).toBe(200);
    const records = captured.join("\n").split(/\r?\n/).filter((l) => l.includes("[pairing] revoked"));
    expect(records).toHaveLength(1);
    expect(captured.filter((l) => l.includes("[pairing] revoked"))).toHaveLength(1);
    const line = captured.find((l) => l.includes("[pairing] revoked")) as string;
    expect(line).not.toMatch(/[\r\n]/);
    for (const m of line.matchAll(/=(\S*)/g)) expect(m[1]).toMatch(/^[\w.:-]*$/);
  });
});

describe("AE33 — pairing decision lines keep their format", () => {
  it("AE33: expired / knock admitted / pending carry no ip= and no actor=", () => {
    let clock = 1_000_000;
    const reg = new PairedDeviceRegistry(regPath);
    const mgr = new PairingManager({
      registry: reg,
      getFingerprint: () => "sha256:test-fp",
      getReachableUrls: () => ["https://abc.share.zrok.io"],
      now: () => clock,
    });
    try {
      const knock = mgr.knock({ sourceKey: "192.168.16.31", name: "mbp", unencrypted: true, meta: {} });
      expect(knock.ok).toBe(true);
      const payload = mgr.createPayload();
      if (!payload) throw new Error("no payload");
      expect(mgr.redeem(payload.code, {}).ok).toBe(true);
      clock += 10 * 60_000;
      mgr.listPending(); // sweep → expiry of the live pending entries
      expect(captured.filter((l) => /^\[pairing\] knock admitted id=\S{8}$/.test(l))).toHaveLength(1);
      expect(captured.filter((l) => /^\[pairing\] pending id=\S{8}$/.test(l))).toHaveLength(1);
      expect(captured.filter((l) => /^\[pairing\] expired id=\S{8}$/.test(l)).length).toBeGreaterThanOrEqual(1);
      for (const l of captured) {
        expect(l).not.toContain("ip=");
        expect(l).not.toContain("actor=");
      }
    } finally {
      mgr.dispose();
    }
  });
});

describe("AE65 — audit values are sanitized, then prefix-cut", () => {
  it("AE65: sub decision table over a hostile device id and an IPv6 zone-id peer", async () => {
    const cases: [string, RegExp][] = [
      ["alice@example.com", /^\[pairing\] revoked id=ab_cd_ef actor=session:alice_ex ip=fe80::1_en0$/],
      ["a b/c", /^\[pairing\] revoked id=ab_cd_ef actor=session:a_b_c ip=fe80::1_en0$/],
      ["ok.name-1:x_2", /^\[pairing\] revoked id=ab_cd_ef actor=session:ok\.name- ip=fe80::1_en0$/],
    ];
    for (const [sub, expected] of cases) {
      captured.length = 0;
      sessionSub = sub;
      const reg = seedRegistry([{ id: "ab cd!ef0123456789", token: "t" }]);
      const app = await mkApp(reg);
      const res = await revoke(app, "ab cd!ef0123456789", { ip: "fe80::1%en0" });
      expect(res.statusCode, sub).toBe(200);
      const lines = linesWith("[pairing] revoked");
      expect(lines, sub).toHaveLength(1);
      expect(lines[0], sub).toMatch(expected);
    }
  });
});

describe("AX11 — a denied mutation leaves no success line", () => {
  it("AX11 (a): a device bearer's revoke is refused with no `[pairing] revoked` line", async () => {
    const reg = seedRegistry([
      { id: "aaaaaaaa00000001", token: "tA" },
      { id: "bbbbbbbb00000002", token: "tB" },
    ]);
    const app = await mkApp(reg);
    const res = await revoke(app, "bbbbbbbb00000002", { headers: { authorization: "Bearer tA" } });
    expect(res.statusCode).toBe(401);
    expect(linesWith("[pairing] revoked")).toHaveLength(0);
    expect(reg.list().map((d) => d.id)).toContain("bbbbbbbb00000002");
  });

  it("AX11 (a'): an unknown-id revoke (404) is not audited", async () => {
    const reg = seedRegistry([{ id: "aaaaaaaa00000001", token: "tA" }]);
    const app = await mkApp(reg);
    expect((await revoke(app, "no-such-device")).statusCode).toBe(404);
    expect(linesWith("revoked")).toHaveLength(0);
  });
});

describe("AX12 — audit write failure is fail-open", () => {
  it("AX12: a throwing `[pairing]` sink never fails revoke or mint", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    process.on("uncaughtException", onUnhandled);
    try {
      const reg = seedRegistry([{ id: "d0123456789abcdef", token: "t" }]);
      const app = await mkApp(reg);
      for (const s of spies.splice(0)) s.mockRestore();
      for (const method of ["log", "info", "warn", "error", "debug"] as const) {
        spies.push(
          vi.spyOn(console, method).mockImplementation(() => {
            throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
          }),
        );
      }
      const del = await revoke(app, "d0123456789abcdef");
      expect(del.statusCode).toBe(200);
      expect(reg.list().map((d) => d.id)).not.toContain("d0123456789abcdef");
      const post = await mint(app, { label: "after" });
      expect(post.statusCode).toBe(200);
      expect(reg.list().map((d) => d.label)).toContain("after");
      // The server keeps serving.
      expect((await app.inject({ method: "GET", url: "/api/paired-devices", headers: SESSION, remoteAddress: "127.0.0.1" })).statusCode).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      process.off("uncaughtException", onUnhandled);
    }
  });
});

describe("AE66 — refused rotations are audited", () => {
  const rotate = (app: FastifyInstance, token: string) =>
    app.inject({
      method: "POST",
      url: "/api/paired-devices/rotate",
      remoteAddress: "203.0.113.9",
      headers: { authorization: `Bearer ${token}` },
    });

  it("AE66: superseded and expired rotations log `rotate_refused`; an unknown-id revoke logs nothing", async () => {
    const T = 1_700_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const DAY = 86_400_000;
    const reg = seedRegistry([
      { id: "a1b2c3d4e5f60001", token: "bearer-A", pairedAt: T, expiresAt: T + 7 * DAY },
      { id: "e1e2e3e4e5e60002", token: "bearer-E", pairedAt: T - 8 * DAY, expiresAt: T - DAY },
    ]);
    const app = await mkApp(reg);

    // (a) A rotates at T (200), then presents rotate again at T + 10 s (inside the grace window).
    const first = await rotate(app, "bearer-A");
    expect(first.statusCode).toBe(200);
    const newToken = (JSON.parse(first.payload) as { token: string }).token;
    const seen = [...captured];
    captured.length = 0;
    vi.setSystemTime(T + 10_000);
    const stale = await rotate(app, "bearer-A");
    expect(stale.statusCode).toBe(409);
    expect(linesWith("[pairing] rotate_refused")).toEqual([
      "[pairing] rotate_refused id=a1b2c3d4 reason=bearer_superseded ip=203.0.113.9",
    ]);

    // (b) an expired bearer presents rotate.
    seen.push(...captured);
    captured.length = 0;
    const expired = await rotate(app, "bearer-E");
    expect(expired.statusCode).toBe(401);
    expect(linesWith("[pairing] rotate_refused")).toEqual([
      "[pairing] rotate_refused id=e1e2e3e4 reason=bearer_expired ip=203.0.113.9",
    ]);

    // (c) an unknown-id revoke is refused with no audit line at all.
    seen.push(...captured);
    captured.length = 0;
    expect((await revoke(app, "no-such-device")).statusCode).toBe(404);
    expect(captured.filter((l) => l.startsWith("[pairing]"))).toEqual([]);

    // No line carries a bearer or a hash.
    seen.push(...captured);
    for (const secret of ["bearer-A", "bearer-E", newToken, sha("bearer-A"), sha("bearer-E"), sha(newToken)]) {
      expect(seen.join("\n")).not.toContain(secret);
    }
  });
});
