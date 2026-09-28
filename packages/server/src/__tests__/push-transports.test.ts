/**
 * Web Push + FCM transports with their network edge mocked.
 * Harness: `changelog-remote.test.ts` (mocked fetch).
 * See change: add-server-push-notifications (test-plan #X16, #X17).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPushDispatcher } from "../push/push-dispatcher.js";
import { createPushService } from "../push/push-service.js";
import { createPushTokenRegistry } from "../push/push-token-registry.js";
import { createFcmTransport } from "../push/push-transports/fcm.js";
import type { PushPayload, PushToken } from "../push/push-transports/types.js";
import { createWebPushTransport } from "../push/push-transports/web-push.js";

const payload: PushPayload = {
  type: "session_attention",
  trigger: "input",
  sessionId: "abc",
  title: "p: waiting for input",
  body: "m",
  url: "/session/abc",
};

const SUB = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/SECRETID",
  keys: { p256dh: "p", auth: "a" },
});

const quiet = { info() {}, warn() {}, error() {} };
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("web-push transport (test-plan #X16)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-transports-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function withStatuses(statuses: Array<number>) {
    const calls: Array<{ subscription: unknown; body: string; options: any }> = [];
    const sendNotification = vi.fn(async (subscription: unknown, body: string, options: any) => {
      calls.push({ subscription, body, options });
      const status = statuses.shift()!;
      if (status >= 200 && status < 300) return { statusCode: status, body: "", headers: {} };
      throw Object.assign(new Error(`Received unexpected response code ${status} for ${SUB}`), { statusCode: status });
    });
    const transport = createWebPushTransport({
      vapidKeys: { publicKey: "pub", privateKey: "priv" },
      contactEmail: "me@example.com",
      sendNotification,
    });
    return { transport, calls };
  }

  it.each([410, 404])("%i → token pruned", async (status) => {
    let t = 0;
    const registry = createPushTokenRegistry({ path: path.join(tmpDir, `t${status}.json`), now: () => t });
    const { transport } = withStatuses([status]);
    const r = registry.add({ deviceToken: SUB, transport: "web-push" });
    const d = createPushDispatcher({
      registry,
      transports: { "web-push": transport },
      coalesceWindowMs: 5_000,
      getSession: (id) => ({ id, cwd: "/p", name: "p" }) as any,
      logger: quiet,
    });
    d.fanout("abc", { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    await flush();
    expect(r.ok && registry.get(r.token.id)).toBeFalsy();
  });

  it("201 → ok and lastUsedAt updated; sends VAPID details and the JSON payload", async () => {
    let t = 1_000;
    const registry = createPushTokenRegistry({ path: path.join(tmpDir, "ok.json"), now: () => t });
    const { transport, calls } = withStatuses([201]);
    const r = registry.add({ deviceToken: SUB, transport: "web-push" });
    if (!r.ok) throw new Error("add");
    const d = createPushDispatcher({
      registry,
      transports: { "web-push": transport },
      coalesceWindowMs: 5_000,
      getSession: (id) => ({ id, cwd: "/p", name: "p" }) as any,
      logger: quiet,
      now: () => t,
    });
    t = 9_000;
    expect(await d.test(r.token.id)).toEqual([{ tokenId: r.token.id, ok: true }]);
    expect(registry.get(r.token.id)?.lastUsedAt).toBe(9_000);
    expect(calls[0].subscription).toEqual(JSON.parse(SUB));
    expect(JSON.parse(calls[0].body)).toMatchObject({ type: "session_attention", url: "/" });
    expect(calls[0].options.vapidDetails).toEqual({ subject: "mailto:me@example.com", publicKey: "pub", privateKey: "priv" });
  });

  it("a 500 is a failure that returns only the status, never the endpoint", async () => {
    const { transport } = withStatuses([500]);
    const res = await transport.send({ id: "x", deviceToken: SUB, transport: "web-push", registeredAt: 0, lastUsedAt: 0 }, payload);
    expect(res).toEqual({ ok: false, status: 500 });
  });
});

describe("FCM transport (test-plan #X17)", () => {
  let tmpDir: string;
  let saPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-fcm-test-"));
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    saPath = path.join(tmpDir, "sa.json");
    fs.writeFileSync(
      saPath,
      JSON.stringify({
        project_id: "proj-1",
        client_email: "svc@proj-1.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );
    (globalThis as any).__fcmPublicKey = publicKey;
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const fcmToken: PushToken = { id: "f1", deviceToken: "device-token-1", transport: "fcm", registeredAt: 0, lastUsedAt: 0 };

  function mockFetch(sendResponses: Array<{ status: number; body?: unknown }>) {
    const tokenCalls: string[] = [];
    const sendCalls: Array<{ url: string; auth: string; body: any }> = [];
    let n = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://oauth2.googleapis.com/token") {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
        tokenCalls.push(assertion);
        n++;
        return new Response(JSON.stringify({ access_token: `at-${n}`, expires_in: 3600 }), { status: 200 });
      }
      const headers = new Headers(init?.headers);
      sendCalls.push({ url: u, auth: headers.get("authorization") ?? "", body: JSON.parse(String(init?.body)) });
      const next = sendResponses.shift()!;
      return new Response(next.body === undefined ? "{}" : JSON.stringify(next.body), { status: next.status });
    });
    return { fetchImpl, tokenCalls, sendCalls };
  }

  it("signs an RS256 JWT, sends with a Bearer token, re-signs and retries once after 401", async () => {
    const m = mockFetch([{ status: 401 }, { status: 200, body: { name: "projects/proj-1/messages/1" } }]);
    const created = createFcmTransport({ serviceAccountPath: saPath, fetchImpl: m.fetchImpl as any });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const res = await created.transport.send(fcmToken, payload);
    expect(res.ok).toBe(true);
    expect(m.tokenCalls).toHaveLength(2);
    expect(m.sendCalls).toHaveLength(2);
    expect(m.sendCalls[0].url).toBe("https://fcm.googleapis.com/v1/projects/proj-1/messages:send");
    expect(m.sendCalls[0].auth).toBe("Bearer at-1");
    expect(m.sendCalls[1].auth).toBe("Bearer at-2");
    expect(m.sendCalls[1].body.message.token).toBe("device-token-1");
    expect(m.sendCalls[1].body.message.notification).toEqual({ title: payload.title, body: payload.body });

    // The assertion is a valid RS256 JWT signed with the service-account key.
    const [h, c, sig] = m.tokenCalls[0].split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({
      iss: "svc@proj-1.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
    });
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), (globalThis as any).__fcmPublicKey, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("caches the access token across sends", async () => {
    const m = mockFetch([{ status: 200 }, { status: 200 }]);
    const created = createFcmTransport({ serviceAccountPath: saPath, fetchImpl: m.fetchImpl as any });
    if (!created.ok) throw new Error(created.error);
    await created.transport.send(fcmToken, payload);
    await created.transport.send(fcmToken, payload);
    expect(m.tokenCalls).toHaveLength(1);
  });

  it("UNREGISTERED → gone (pruned by the dispatcher)", async () => {
    const m = mockFetch([
      { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } },
    ]);
    const created = createFcmTransport({ serviceAccountPath: saPath, fetchImpl: m.fetchImpl as any });
    if (!created.ok) throw new Error(created.error);
    const registry = createPushTokenRegistry({ path: path.join(tmpDir, "fcm-tokens.json") });
    const r = registry.add({ deviceToken: "device-token-1", transport: "fcm" });
    const d = createPushDispatcher({
      registry,
      transports: { fcm: created.transport },
      coalesceWindowMs: 5_000,
      getSession: (id) => ({ id, cwd: "/p" }) as any,
      logger: quiet,
    });
    d.fanout("abc", { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    await flush();
    expect(r.ok && registry.get(r.token.id)).toBeFalsy();
  });

  it("a missing service-account file disables FCM with a push.errors entry, without crashing", () => {
    const created = createFcmTransport({ serviceAccountPath: path.join(tmpDir, "missing.json") });
    expect(created.ok).toBe(false);

    const service = createPushService({
      config: { enabled: true, coalesceWindowMs: 30_000, fcm: { serviceAccountPath: path.join(tmpDir, "missing.json") } },
      dataDir: tmpDir,
      getSession: () => undefined,
      selfPort: () => null,
      logger: quiet,
    });
    expect(service.errors.some((e) => /fcm/i.test(e))).toBe(true);
    service.shutdown();
  });
});
