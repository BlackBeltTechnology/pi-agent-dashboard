/**
 * `/api/push/*` REST API: registration validation + capacity, opaque test
 * endpoint, secret-free listing, 404 while disabled, auth before disabled.
 * Harness: `auth-plugin.test.ts` (bare Fastify + `inject`, `remoteAddress`).
 * See change: add-server-push-notifications
 * (test-plan #E21–#E25, #E34–#E36, #X12, #X13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPushService, type PushService } from "../push/push-service.js";
import type { PushLogger, PushTransport } from "../push/push-transports/types.js";
import { registerPushRoutes } from "../routes/push-routes.js";

const sub = (over: Record<string, unknown> = {}, keys: Record<string, unknown> = { p256dh: "p", auth: "a" }) =>
  JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/SECRETID", keys, ...over });

describe("push routes (enabled)", () => {
  let tmpDir: string;
  let service: PushService;
  let app: FastifyInstance;
  let lines: string[];

  async function boot(transports: Partial<Record<"web-push" | "fcm" | "webhook", PushTransport>> = {}) {
    lines = [];
    const logger: PushLogger = {
      info: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
      warn: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
      error: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    };
    service = createPushService({
      config: { enabled: true, coalesceWindowMs: 30_000, webPush: { contactEmail: "me@example.com" } },
      dataDir: tmpDir,
      getSession: () => undefined,
      selfPort: () => 8000,
      logger,
      lookupAll: async () => [{ address: "192.168.1.20", family: 4 }],
      transports,
    });
    app = Fastify();
    registerPushRoutes(app, { getPush: () => service });
    await app.ready();
  }

  const register = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/push/register", payload });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-routes-test-"));
    await boot();
  });

  afterEach(async () => {
    await app.close();
    service.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates web-push subscriptions (test-plan #E21)", async () => {
    expect((await register({ transport: "web-push", deviceToken: sub({ endpoint: "http://push.example/x" }) })).statusCode).toBe(400);
    expect((await register({ transport: "web-push", deviceToken: sub({}, { p256dh: "p" }) })).statusCode).toBe(400);
    const ok = await register({ transport: "web-push", deviceToken: sub() });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().tokenId).toBe("string");
  });

  it("refuses a web-push endpoint on a link-local / metadata address", async () => {
    const res = await register({ transport: "web-push", deviceToken: sub({ endpoint: "https://169.254.169.254/push/x" }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("/push/x");
    expect(service.registry.list()).toHaveLength(0);
  });

  it("caps at 50 distinct tokens; re-registering an existing one still works (test-plan #E22)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await register({ transport: "fcm", deviceToken: `fcm-${i}` });
      expect(r.statusCode).toBe(200);
      ids.push(r.json().tokenId);
    }
    expect((await register({ transport: "fcm", deviceToken: "fcm-50" })).statusCode).toBe(409);
    const again = await register({ transport: "fcm", deviceToken: "fcm-7" });
    expect(again.statusCode).toBe(200);
    expect(again.json().tokenId).toBe(ids[7]);
  });

  it("bounds sessionFilter (test-plan #E23)", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `s${i}`);
    expect((await register({ transport: "fcm", deviceToken: "a", sessionFilter: hundred })).statusCode).toBe(200);
    expect((await register({ transport: "fcm", deviceToken: "b", sessionFilter: [...hundred, "x"] })).statusCode).toBe(400);
    expect((await register({ transport: "fcm", deviceToken: "c", sessionFilter: [""] })).statusCode).toBe(400);
    expect((await register({ transport: "fcm", deviceToken: "d", sessionFilter: "A" })).statusCode).toBe(400);
  });

  it("bounds label at 64 chars (test-plan #E24)", async () => {
    const url = "http://192.168.1.20:8787/api/hooks/h1?key=k";
    expect((await register({ transport: "webhook", deviceToken: url, label: "x".repeat(64) })).statusCode).toBe(200);
    expect((await register({ transport: "webhook", deviceToken: `${url}2`, label: "x".repeat(65) })).statusCode).toBe(400);
  });

  it("rejects an unknown transport and an empty fcm token (test-plan #E25)", async () => {
    expect((await register({ transport: "apns", deviceToken: "x" })).statusCode).toBe(400);
    expect((await register({ transport: "fcm", deviceToken: "" })).statusCode).toBe(400);
    expect(service.registry.list()).toHaveLength(0);
  });

  it("POST /api/push/test with no tokens and no body → 200 {results: []} (test-plan #E34)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/push/test" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
  });

  it("lists web-push by host only; SECRETID never in responses or logs (test-plan #X12)", async () => {
    await app.close();
    service.shutdown();
    await boot({ "web-push": { kind: "web-push", send: async () => ({ ok: false, status: 500 }) as any } });
    const r = await register({ transport: "web-push", deviceToken: sub() });
    const tokenId = r.json().tokenId;
    const tested = await app.inject({ method: "POST", url: "/api/push/test", payload: { tokenId } });
    const listed = await app.inject({ method: "GET", url: "/api/push/register" });
    expect(listed.json().tokens).toEqual([
      expect.objectContaining({ tokenId, transport: "web-push", display: "fcm.googleapis.com browser", consecutiveFailures: 1 }),
    ]);
    expect(Object.keys(listed.json().tokens[0]).sort()).toEqual(
      ["consecutiveFailures", "display", "lastUsedAt", "registeredAt", "tokenId", "transport"],
    );
    const all = [r.body, tested.body, listed.body, ...lines].join("\n");
    expect(all).toContain("fcm.googleapis.com browser");
    expect(all).not.toContain("SECRETID");
  });

  it("test results are opaque: exactly {tokenId, ok:false} (test-plan #X13)", async () => {
    await app.close();
    service.shutdown();
    let n = 0;
    await boot({
      webhook: {
        kind: "webhook",
        send: async () => (n++ === 0 ? { ok: false, status: 500 } : { ok: false, errorCode: "UND_ERR_HEADERS_TIMEOUT" }) as any,
      },
    });
    const a = (await register({ transport: "webhook", deviceToken: "http://192.168.1.20:8787/a" })).json().tokenId;
    const b = (await register({ transport: "webhook", deviceToken: "http://192.168.1.20:8787/b" })).json().tokenId;
    const res = await app.inject({ method: "POST", url: "/api/push/test", payload: {} });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as unknown[];
    expect(results).toHaveLength(2);
    expect(results).toEqual(expect.arrayContaining([{ tokenId: a, ok: false }, { tokenId: b, ok: false }]));
  });

  it("DELETE removes a token (204) and 404s an unknown one", async () => {
    const id = (await register({ transport: "fcm", deviceToken: "x" })).json().tokenId;
    expect((await app.inject({ method: "DELETE", url: `/api/push/register/${id}` })).statusCode).toBe(204);
    expect(service.registry.list()).toHaveLength(0);
    expect((await app.inject({ method: "DELETE", url: `/api/push/register/${id}` })).statusCode).toBe(404);
  });

  it("GET /api/push/vapid-public-key returns the public key", async () => {
    const res = await app.inject({ method: "GET", url: "/api/push/vapid-public-key" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: service.vapidPublicKey });
  });
});

describe("push routes (disabled) (test-plan #E35, #E36)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every route answers 404 for a loopback caller; no VAPID file, no outbound call (test-plan #E35)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const home = process.env.HOME!;
    const app = Fastify();
    registerPushRoutes(app, { getPush: () => null });
    await app.ready();
    const calls = [
      { method: "GET", url: "/api/push/vapid-public-key" },
      { method: "GET", url: "/api/push/register" },
      { method: "POST", url: "/api/push/register", payload: { transport: "fcm", deviceToken: "x" } },
      { method: "DELETE", url: "/api/push/register/abc" },
      { method: "POST", url: "/api/push/test" },
    ] as const;
    for (const c of calls) {
      const res = await app.inject({ ...c, remoteAddress: "127.0.0.1" } as any);
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
    await app.close();
    expect(fs.existsSync(path.join(home, ".pi", "dashboard", "push-vapid.json"))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("an unauthenticated non-loopback caller gets 401, not 404 (test-plan #E36)", async () => {
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const app = Fastify();
    await registerAuthPlugin(app, {
      authConfig: {
        secret: "test-secret-32-chars-long-abcdef",
        providers: { github: { clientId: "cid", clientSecret: "csecret" } },
      },
      port: 8000,
      resolvedTrustedNetworks: [],
    });
    registerPushRoutes(app, { getPush: () => null });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/push/vapid-public-key", remoteAddress: "203.0.113.7" });
    expect(res.statusCode).toBe(401);
    const reg = await app.inject({
      method: "POST",
      url: "/api/push/register",
      payload: { transport: "fcm", deviceToken: "x" },
      remoteAddress: "203.0.113.7",
    });
    expect(reg.statusCode).toBe(401);
    await app.close();
  });
});
