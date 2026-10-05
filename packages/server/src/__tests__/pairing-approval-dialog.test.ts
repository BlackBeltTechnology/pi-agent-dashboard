/**
 * App-wide pairing approval dialog — server half (L1).
 * test-plan: E1–E6, E10–E12, X1–X4, X6–X8, X11 of change add-pairing-approval-dialog.
 * Exemplar: pairing.test.ts ("D12 compare-code approval", "E13", "X4", "X5").
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager, wirePendingHint } from "../pairing/pairing.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";

/** Pairing-code TTL, read from a live pending entry so it tracks `CODE_TTL_MS`. */
function ttlOf(mgr: PairingManager, now: number): number {
  const [p] = mgr.listPending();
  return p.expiresAt - now;
}

const LOCAL_TOKEN = "local-token-for-approval";
let tmpDir: string;
let clock: number;
const managers: PairingManager[] = [];
const apps: FastifyInstance[] = [];

function mkManager(opts: { realClock?: boolean } = {}) {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const mgr = new PairingManager({
    registry: reg,
    getFingerprint: () => "sha256:test-fp",
    getReachableUrls: () => ["https://a.example"],
    ...(opts.realClock ? {} : { now: () => clock }),
  });
  managers.push(mgr);
  return { mgr, reg };
}

function pend(mgr: PairingManager) {
  const p = mgr.createPayload()!;
  const r = mgr.redeem(p.code);
  if (!r.ok) throw new Error("redeem failed");
  return { code: p.code, pendingId: r.pendingId, confirmCode: r.confirmCode };
}

/** A confirm code guaranteed to differ from `real`. */
const wrong = (real: string) => (real === "11111111" ? "22222222" : "11111111");

async function mkApp(opts: { trusted?: string[]; deviceBearer?: boolean } = {}) {
  const { mgr, reg } = mkManager();
  const app = Fastify();
  apps.push(app);
  // Simulate a dashboard login session for the operator guard.
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") (req as unknown as { authVia: string }).authVia = "session";
  });
  if (opts.deviceBearer) registerBearerAuth(app, { registry: reg });
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard(opts.trusted ?? []),
    identity: {} as never,
    pairing: mgr,
    registry: reg,
    // Approval never honors bare loopback (D6): the operator presents the local token.
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
  return { app, mgr, reg };
}

const local = (app: FastifyInstance, method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method,
    url,
    remoteAddress: "127.0.0.1",
    headers: { ...(payload ? { "content-type": "application/json" } : {}), "x-pi-local-token": LOCAL_TOKEN, ...headers },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pairing-dlg-"));
  clock = 1_000_000;
});

afterEach(async () => {
  for (const m of managers.splice(0)) m.dispose();
  for (const a of apps.splice(0)) await a.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("E1 — lockout BVA via approvePending", () => {
  it("attemptsLeft 4,3,2,1 then locked_out; correct code after lockout still locked_out", () => {
    const { mgr, reg } = mkManager();
    const d = pend(mgr);
    const bad = wrong(d.confirmCode);
    for (const left of [4, 3, 2, 1]) {
      expect(mgr.approvePending(d.pendingId, bad)).toEqual({ ok: false, error: "mismatch", attemptsLeft: left });
    }
    expect(mgr.approvePending(d.pendingId, bad)).toEqual({ ok: false, error: "locked_out" });
    expect(mgr.approvePending(d.pendingId, d.confirmCode)).toEqual({ ok: false, error: "locked_out" });
    expect(reg.list()).toHaveLength(0);
  });
});

describe("E2 — budget shared across entry points", () => {
  it("3 wrong by code + 2 wrong by pendingId → locked_out", () => {
    const { mgr } = mkManager();
    const d = pend(mgr);
    const bad = wrong(d.confirmCode);
    for (let i = 0; i < 3; i++) expect(mgr.approve(d.code, bad).ok).toBe(false);
    expect(mgr.approvePending(d.pendingId, bad)).toEqual({ ok: false, error: "mismatch", attemptsLeft: 1 });
    expect(mgr.approvePending(d.pendingId, bad)).toEqual({ ok: false, error: "locked_out" });
  });
});

describe("E3 — budget belongs to one pending device (D8)", () => {
  it("re-redeem after lockout creates a new pending with a fresh budget", () => {
    const { mgr, reg } = mkManager();
    const a = pend(mgr);
    for (let i = 0; i < 5; i++) mgr.approvePending(a.pendingId, wrong(a.confirmCode));
    expect(mgr.approvePending(a.pendingId, a.confirmCode)).toEqual({ ok: false, error: "locked_out" });
    // Force a different confirm code for B so the assertion is not flaky.
    let b = mgr.redeem(a.code);
    while (b.ok && b.confirmCode === a.confirmCode) b = mgr.redeem(a.code);
    if (!b.ok) throw new Error("re-redeem failed");
    expect(b.confirmCode).not.toBe(a.confirmCode);
    expect(mgr.approvePending(b.pendingId, b.confirmCode).ok).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });
});

describe("E4 — approve-pending label BVA", () => {
  it.each([
    ["absent", undefined, 200, "device"],
    ["padded", " x ", 200, "x"],
    ["64 bytes", "x".repeat(64), 200, "x".repeat(64)],
    ["65 bytes", "x".repeat(65), 400, null],
    ["66 bytes (33×é)", "é".repeat(33), 400, null],
    ["a number", 123, 400, null],
  ])("%s", async (_n, label, want, stored) => {
    const { app, mgr, reg } = await mkApp();
    const d = pend(mgr);
    const res = await local(app, "POST", "/api/pair/approve-pending", {
      pendingId: d.pendingId,
      confirmCode: d.confirmCode,
      ...(label === undefined ? {} : { label }),
    });
    expect(res.statusCode).toBe(want);
    if (stored === null) {
      expect(reg.list()).toHaveLength(0);
      expect(mgr.listPending().map((p) => p.pendingId)).toEqual([d.pendingId]);
    } else {
      expect(reg.list().map((r) => r.label)).toEqual([stored]);
    }
  });
});

describe("E5 — redeemer metadata bounds", () => {
  async function redeemWith(headers: Record<string, string>) {
    const { app, mgr } = await mkApp();
    const p = mgr.createPayload()!;
    const r = await app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      remoteAddress: "127.0.0.1",
      headers: { "content-type": "application/json", ...headers },
      payload: { code: p.code },
    });
    expect(r.statusCode).toBe(200);
    const list = await local(app, "GET", "/api/pair/pending");
    expect(list.statusCode).toBe(200);
    return list.json().data[0];
  }

  it.each([256, 257, 2000])("UA of %i chars → ≤256", async (n) => {
    const row = await redeemWith({ "user-agent": "u".repeat(n) });
    expect(row.userAgent.length).toBe(256);
  });

  it("host of 300 chars → ≤253; first XFF hop kept", async () => {
    const { app, mgr } = await mkApp();
    const p = mgr.createPayload()!;
    // Host is bounded in the manager; exercise it directly (an unadmitted
    // Host never reaches the operator list route in a real server anyway).
    mgr.redeem(p.code, { host: "h".repeat(300), forwardedFor: "1.2.3.4, 5.6.7.8", remoteAddress: "10.0.0.1" });
    const row = (await local(app, "GET", "/api/pair/pending")).json().data[0];
    expect(row.viaHost.length).toBe(253);
    expect(row.forwardedFor).toBe("1.2.3.4");
    expect(row.remoteAddress).toBe("10.0.0.1");
  });

  it("XFF via the route keeps only the first hop", async () => {
    const row = await redeemWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(row.forwardedFor).toBe("1.2.3.4");
  });

  it("no forwarded field when the header is absent", async () => {
    const row = await redeemWith({});
    expect(row).not.toHaveProperty("forwardedFor");
  });
});

describe("E6 — pending list carries no secrets", () => {
  it("has pendingId/metadata/expiresAt/attemptsLeft; body never contains the code or confirm code", async () => {
    const { app, mgr } = await mkApp();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code, { userAgent: "UA", host: "h.example", remoteAddress: "10.0.0.2" });
    if (!r.ok) throw new Error("redeem failed");
    const res = await local(app, "GET", "/api/pair/pending");
    const row = res.json().data[0];
    expect(row).toMatchObject({
      pendingId: r.pendingId,
      userAgent: "UA",
      viaHost: "h.example",
      remoteAddress: "10.0.0.2",
      attemptsLeft: 5,
    });
    expect(typeof row.expiresAt).toBe("number");
    expect(res.body).not.toContain(p.code);
    expect(res.body).not.toContain(r.confirmCode);
  });
});

describe("X11 — old /api/pair/approve route unchanged", () => {
  it("correct → 200 + device; wrong → 400 mismatch with additive attemptsLeft", async () => {
    const { app, mgr } = await mkApp();
    const d = pend(mgr);
    const bad = await local(app, "POST", "/api/pair/approve", { code: d.code, confirmCode: wrong(d.confirmCode) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ success: false, error: "mismatch", attemptsLeft: 4 });
    const ok = await local(app, "POST", "/api/pair/approve", { code: d.code, confirmCode: d.confirmCode });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.source).toBe("pairing");
  });
});

describe("E10 — deny state edges", () => {
  it("live → 200; repeat → 404; approved → 404; expired → 404; unknown → 404", async () => {
    const { app, mgr } = await mkApp();
    const live = pend(mgr);
    expect((await local(app, "POST", "/api/pair/deny", { pendingId: live.pendingId })).statusCode).toBe(200);
    const again = await local(app, "POST", "/api/pair/deny", { pendingId: live.pendingId });
    expect(again.statusCode).toBe(404);
    expect(again.json().error).toBe("no_pending");

    const approved = pend(mgr);
    expect(mgr.approvePending(approved.pendingId, approved.confirmCode).ok).toBe(true);
    expect((await local(app, "POST", "/api/pair/deny", { pendingId: approved.pendingId })).statusCode).toBe(404);

    const expired = pend(mgr);
    clock += ttlOf(mgr, clock) + 1_000;
    expect((await local(app, "POST", "/api/pair/deny", { pendingId: expired.pendingId })).statusCode).toBe(404);

    expect(
      (await local(app, "POST", "/api/pair/deny", { pendingId: "00000000-0000-4000-8000-000000000000" })).statusCode,
    ).toBe(404);
  });
});

describe("E10b — a locked-out request cannot be denied", () => {
  it("deny after lockout → no_pending; the code stays re-redeemable (D8)", () => {
    const { mgr } = mkManager();
    const d = pend(mgr);
    for (let i = 0; i < 5; i++) mgr.approvePending(d.pendingId, wrong(d.confirmCode));
    expect(mgr.deny(d.pendingId)).toEqual({ ok: false, error: "no_pending" });
    expect(mgr.redeem(d.code).ok).toBe(true);
  });
});

describe("E11 — a denied code is dead", () => {
  it("re-redeem → invalid_code; poll(old) → rejected; never approvable", () => {
    const { mgr, reg } = mkManager();
    const d = pend(mgr);
    expect(mgr.deny(d.pendingId)).toEqual({ ok: true });
    expect(mgr.redeem(d.code)).toEqual({ ok: false, error: "invalid_code" });
    expect(mgr.poll(d.pendingId)).toEqual({ status: "rejected" });
    expect(mgr.approvePending(d.pendingId, d.confirmCode).ok).toBe(false);
    expect(mgr.approve(d.code, d.confirmCode).ok).toBe(false);
    expect(reg.list()).toHaveLength(0);
  });
});

describe("E12 — premature redemption kept when not denied", () => {
  it("B overwrites A; approving B works; poll(A) unknown, poll(B) approved + token", () => {
    const { mgr, reg } = mkManager();
    const a = pend(mgr);
    const b = mgr.redeem(a.code);
    if (!b.ok) throw new Error("redeem failed");
    expect(mgr.approvePending(b.pendingId, b.confirmCode).ok).toBe(true);
    expect(mgr.poll(a.pendingId)).toEqual({ status: "unknown" });
    const pb = mgr.poll(b.pendingId);
    expect(pb.status).toBe("approved");
    if (pb.status === "approved") expect(reg.verify(pb.token)).not.toBeNull();
  });
});

describe("X1–X3 — pending routes are operator-only", () => {
  it("X1: bearer / forwarded remote / trusted-network → 401|403; genuine-local and session → 200", async () => {
    const { app, reg } = await mkApp({ trusted: ["10.0.0.0/8"], deviceBearer: true });
    const phone = reg.add("phone");
    const refused = [
      await app.inject({
        method: "GET",
        url: "/api/pair/pending",
        remoteAddress: "203.0.113.9",
        headers: { authorization: `Bearer ${phone.token}` },
      }),
      await app.inject({
        method: "GET",
        url: "/api/pair/pending",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      await app.inject({ method: "GET", url: "/api/pair/pending", remoteAddress: "10.1.2.3" }),
    ];
    for (const r of refused) expect([401, 403]).toContain(r.statusCode);
    expect((await local(app, "GET", "/api/pair/pending")).statusCode).toBe(200);
    const session = await app.inject({
      method: "GET",
      url: "/api/pair/pending",
      remoteAddress: "203.0.113.9",
      headers: { "x-test-session": "1" },
    });
    expect(session.statusCode).toBe(200);
  });

  it("X2: a paired-device bearer cannot deny; the device stays pending", async () => {
    const { app, mgr, reg } = await mkApp({ deviceBearer: true });
    const phone = reg.add("phone");
    const d = pend(mgr);
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/deny",
      remoteAddress: "203.0.113.9",
      headers: { authorization: `Bearer ${phone.token}`, "content-type": "application/json" },
      payload: { pendingId: d.pendingId },
    });
    expect([401, 403]).toContain(res.statusCode);
    expect(mgr.poll(d.pendingId)).toEqual({ status: "pending" });
  });

  it("X3: a paired-device bearer with the correct confirm code cannot approve-pending", async () => {
    const { app, mgr, reg } = await mkApp({ deviceBearer: true });
    const phone = reg.add("phone");
    const d = pend(mgr);
    const before = reg.list().length;
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/approve-pending",
      remoteAddress: "203.0.113.9",
      headers: { authorization: `Bearer ${phone.token}`, "content-type": "application/json" },
      payload: { pendingId: d.pendingId, confirmCode: d.confirmCode },
    });
    expect([401, 403]).toContain(res.statusCode);
    expect(reg.list()).toHaveLength(before);
  });
});

describe("X4 — the hint carries nothing", () => {
  it("add / approve / deny / lockout / expire each broadcast exactly {type}", () => {
    vi.useFakeTimers();
    const { mgr } = mkManager({ realClock: true });
    const frames: unknown[] = [];
    wirePendingHint(mgr, (m) => frames.push(m));

    const a = pend(mgr); // add
    mgr.approvePending(a.pendingId, a.confirmCode); // approve
    const b = pend(mgr); // add
    mgr.deny(b.pendingId); // deny
    const c = pend(mgr); // add
    for (let i = 0; i < 5; i++) mgr.approvePending(c.pendingId, wrong(c.confirmCode)); // lockout
    pend(mgr); // add
    vi.advanceTimersByTime(ttlOf(mgr, Date.now()) + 1_000); // expire

    expect(frames).toHaveLength(8);
    for (const f of frames) expect(f).toStrictEqual({ type: "pair_pending_changed" });
  });
});

describe("X6/X7 — pushed expiry and timer hygiene (D4b)", () => {
  it("X6: an idle pending device expires on time: one emission, list empty, expired logged", () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { mgr } = mkManager({ realClock: true });
    pend(mgr);
    let n = 0;
    mgr.onPendingChanged(() => n++);
    vi.advanceTimersByTime(ttlOf(mgr, Date.now()) + 50);
    expect(n).toBe(1);
    expect(mgr.listPending()).toEqual([]);
    expect(log.mock.calls.some(([l]) => /^\[pairing\] expired id=[0-9a-f]{8}$/.test(String(l)))).toBe(true);
  });

  it.each(["approve", "deny", "overwrite"] as const)(
    "X7: after %s at t=10s the cleared timer emits nothing at the original expiry",
    (action) => {
      vi.useFakeTimers();
      vi.spyOn(console, "log").mockImplementation(() => {});
      const { mgr } = mkManager({ realClock: true });
      const d = pend(mgr);
      const ttl = ttlOf(mgr, Date.now());
      vi.advanceTimersByTime(10_000);
      let n = 0;
      mgr.onPendingChanged(() => n++);
      if (action === "approve") mgr.approvePending(d.pendingId, d.confirmCode);
      else if (action === "deny") mgr.deny(d.pendingId);
      else mgr.redeem(d.code);
      const afterAction = n;
      vi.advanceTimersByTime(ttl - 10_000 + 100); // past the ORIGINAL expiry
      expect(n).toBe(afterAction);
    },
  );

  it("X7: dispose() leaves no active timers", () => {
    vi.useFakeTimers();
    const { mgr } = mkManager({ realClock: true });
    pend(mgr);
    pend(mgr);
    expect(vi.getTimerCount()).toBe(2);
    mgr.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("X8 — logs carry no metadata or secrets", () => {
  it("every line is a bare [pairing] transition with an 8-hex id", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const { mgr } = mkManager();
    const ua = "evil\r\n[pairing] approved id=forged";
    const meta = { userAgent: ua, host: "evil.host.example", remoteAddress: "10.9.8.7", forwardedFor: "198.51.100.7" };

    const p1 = mgr.createPayload()!;
    const r1 = mgr.redeem(p1.code, meta);
    if (!r1.ok) throw new Error("redeem failed");
    mgr.approvePending(r1.pendingId, wrong(r1.confirmCode));
    const ok = mgr.approvePending(r1.pendingId, r1.confirmCode);
    const polled = mgr.poll(r1.pendingId);
    const p2 = mgr.createPayload()!;
    const r2 = mgr.redeem(p2.code, meta);
    if (!r2.ok) throw new Error("redeem failed");
    mgr.deny(r2.pendingId);

    expect(ok.ok).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const secrets = [
      "evil",
      "forged",
      "evil.host.example",
      "10.9.8.7",
      "198.51.100.7",
      p1.code,
      p2.code,
      r1.confirmCode,
      r2.confirmCode,
      polled.status === "approved" ? polled.token : "never",
    ];
    for (const l of lines) {
      expect(l).toMatch(/^\[pairing\] (pending|approved|denied|mismatch|locked_out|expired) id=[0-9a-f]{8}/);
      expect(l).not.toMatch(/[\r\n]/);
      for (const s of secrets) expect(l).not.toContain(s);
    }
  });
});
