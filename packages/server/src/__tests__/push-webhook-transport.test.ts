/**
 * Webhook transport against real local `http.createServer` receivers: no
 * redirect following, outcome mapping, 5 s abort, delivery-time SSRF re-check
 * with a pinned connection, and URL redaction everywhere.
 * Harness: `changelog-remote.test.ts` (remote-call tests), local receivers.
 * See change: add-server-push-notifications (test-plan #X5–#X11).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPushService, type PushService } from "../push/push-service.js";
import type { PushLogger, PushPayload, PushToken } from "../push/push-transports/types.js";
import { createWebhookTransport } from "../push/push-transports/webhook.js";
import type { LookupAll } from "../push/push-transports/webhook-url.js";
import { registerPushRoutes } from "../routes/push-routes.js";

interface Receiver {
  port: number;
  requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>;
  connections: number;
  close(): Promise<void>;
}

async function receiver(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Receiver> {
  const requests: Receiver["requests"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      handler(req, res);
    });
  });
  const rec: Receiver = {
    port: 0,
    requests,
    connections: 0,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
  server.on("connection", () => {
    rec.connections++;
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  rec.port = (server.address() as AddressInfo).port;
  return rec;
}

const payload: PushPayload = {
  type: "session_attention",
  trigger: "turn_end",
  sessionId: "abc-123",
  title: "proj: turn finished",
  body: "m1",
  url: "/session/abc-123",
};

const token = (url: string, label?: string): PushToken => ({
  id: "t1",
  deviceToken: url,
  transport: "webhook",
  ...(label ? { label } : {}),
  registeredAt: 0,
  lastUsedAt: 0,
});

function captureLogger() {
  const lines: string[] = [];
  const logger: PushLogger = {
    info: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    warn: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
    error: (m, f) => lines.push(`${m} ${JSON.stringify(f ?? {})}`),
  };
  return { logger, lines };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};

describe("webhook transport", () => {
  const receivers: Receiver[] = [];
  let tmpDir: string;
  let service: PushService | undefined;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-webhook-test-"));
  });

  afterEach(async () => {
    await Promise.all(receivers.splice(0).map((r) => r.close()));
    service?.shutdown();
    service = undefined;
    await app?.close();
    app = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function stack(opts: { lookupAll?: LookupAll; timeoutMs?: number; logger?: PushLogger } = {}) {
    service = createPushService({
      config: { enabled: true, coalesceWindowMs: 5_000 },
      dataDir: tmpDir,
      getSession: (id) => ({ id, cwd: "/tmp/proj", name: "proj", model: "m1" }) as any,
      selfPort: () => null,
      logger: opts.logger ?? captureLogger().logger,
      lookupAll: opts.lookupAll,
      webhookTimeoutMs: opts.timeoutMs,
    });
    app = Fastify();
    registerPushRoutes(app, { getPush: () => service ?? null });
    await app.ready();
    return service;
  }

  it("POSTs the payload as JSON exactly once", async () => {
    const r = await receiver((_q, s) => s.writeHead(204).end());
    receivers.push(r);
    const t = createWebhookTransport({ selfPort: () => null });
    const res = await t.send(token(`http://127.0.0.1:${r.port}/api/hooks/h1?key=k`), payload);
    expect(res.ok).toBe(true);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0].method).toBe("POST");
    expect(r.requests[0].url).toBe("/api/hooks/h1?key=k");
    expect(r.requests[0].headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(r.requests[0].body)).toEqual(payload);
  });

  it("does not follow a 302 (test-plan #X5)", async () => {
    const target = await receiver((_q, s) => s.writeHead(200).end());
    const redirector = await receiver((_q, s) =>
      s.writeHead(302, { Location: `http://127.0.0.1:${target.port}/x` }).end(),
    );
    receivers.push(target, redirector);
    const svc = await stack();
    const added = svc.registry.add({ deviceToken: `http://127.0.0.1:${redirector.port}/h`, transport: "webhook" });
    const results = await svc.dispatcher.test();
    expect(results).toEqual([{ tokenId: added.ok ? added.token.id : "", ok: false }]);
    expect(target.requests).toHaveLength(0);
    expect(svc.registry.list()).toHaveLength(1);
  });

  it("410 prunes the token from memory and file (test-plan #X6)", async () => {
    const r = await receiver((_q, s) => s.writeHead(410).end());
    receivers.push(r);
    const svc = await stack();
    svc.registry.add({ deviceToken: `http://127.0.0.1:${r.port}/h`, transport: "webhook" });
    svc.dispatcher.fanout("s1", { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    await new Promise((res) => setTimeout(res, 200));
    expect(svc.registry.list()).toHaveLength(0);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "push-tokens.json"), "utf-8"));
    expect(onDisk.tokens).toEqual([]);
  });

  it("404 ×3 keeps the token and reports consecutiveFailures 3; a later 200 resets it (test-plan #X7)", async () => {
    let status = 404;
    const r = await receiver((_q, s) => s.writeHead(status).end());
    receivers.push(r);
    const svc = await stack();
    svc.registry.add({ deviceToken: `http://127.0.0.1:${r.port}/h`, transport: "webhook" });
    for (const sid of ["a", "b", "c"]) {
      svc.dispatcher.fanout(sid, { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    }
    await new Promise((res) => setTimeout(res, 300));
    const list = await app!.inject({ method: "GET", url: "/api/push/register" });
    expect(list.statusCode).toBe(200);
    expect(list.json().tokens[0].consecutiveFailures).toBe(3);
    status = 200;
    svc.dispatcher.fanout("d", { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    await new Promise((res) => setTimeout(res, 200));
    const after = await app!.inject({ method: "GET", url: "/api/push/register" });
    expect(after.json().tokens[0].consecutiveFailures).toBe(0);
  });

  it("429 then 500: both failures, one request each, token kept (test-plan #X8)", async () => {
    const statuses = [429, 500];
    const r = await receiver((_q, s) => s.writeHead(statuses.shift() ?? 200).end());
    receivers.push(r);
    const svc = await stack();
    const added = svc.registry.add({ deviceToken: `http://127.0.0.1:${r.port}/h`, transport: "webhook" });
    const id = added.ok ? added.token.id : "";
    expect(await svc.dispatcher.test(id)).toEqual([{ tokenId: id, ok: false }]);
    expect(r.requests).toHaveLength(1);
    expect(await svc.dispatcher.test(id)).toEqual([{ tokenId: id, ok: false }]);
    expect(r.requests).toHaveLength(2);
    expect(svc.registry.list()).toHaveLength(1);
  });

  it("aborts a hanging receiver at 5 000 ms (test-plan #X9)", async () => {
    const r = await receiver(() => {
      /* never respond */
    });
    receivers.push(r);
    const { logger, lines } = captureLogger();
    const t = createWebhookTransport({ selfPort: () => null });
    const started = Date.now();
    const res = await t.send(token(`http://127.0.0.1:${r.port}/h`), payload);
    const elapsed = Date.now() - started;
    expect(res.ok).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(4_750);
    expect(elapsed).toBeLessThanOrEqual(5_250 + 500);
    // The dispatcher logs the failure; exercise it end to end with a short timeout.
    const svc = await stack({ logger, timeoutMs: 200 });
    svc.registry.add({ deviceToken: `http://127.0.0.1:${r.port}/h`, transport: "webhook" });
    await svc.dispatcher.test();
    expect(lines.some((l) => /"outcome":"failed"/.test(l))).toBe(true);
  }, 15_000);

  it("re-vets at delivery: a hostname rebound to 169.254.169.254 opens no connection (test-plan #X10)", async () => {
    const r = await receiver((_q, s) => s.writeHead(200).end());
    receivers.push(r);
    let answer = "127.0.0.1";
    const lookupAll: LookupAll = async () => [{ address: answer, family: 4 }];
    const svc = await stack({ lookupAll });
    const reg = await app!.inject({
      method: "POST",
      url: "/api/push/register",
      payload: { transport: "webhook", deviceToken: `http://hook.test:${r.port}/h` },
    });
    expect(reg.statusCode).toBe(200);
    // Pinned: `hook.test` does not resolve in real DNS, so reaching the
    // receiver proves the connection used the vetted address.
    expect(await svc.dispatcher.test()).toEqual([{ tokenId: reg.json().tokenId, ok: true }]);
    expect(r.connections).toBe(1);

    answer = "169.254.169.254";
    expect(await svc.dispatcher.test()).toEqual([{ tokenId: reg.json().tokenId, ok: false }]);
    expect(r.connections).toBe(1);
    expect(svc.registry.list()).toHaveLength(1);
  });

  it("never echoes the path or key in responses or logs (test-plan #X11)", async () => {
    const { logger, lines } = captureLogger();
    const lookupAll: LookupAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const svc = await stack({ logger, lookupAll, timeoutMs: 300 });
    // ECONNREFUSED / TLS failure: nothing serves https on 127.0.0.1:8443 in the test.
    svc.registry.add({
      deviceToken: "https://hooks.example:8443/api/hooks/h1?key=s3cret",
      transport: "webhook",
      label: "nanoMuse",
    });
    // 500 and timeout on real receivers carrying the same secret-bearing path.
    const five = await receiver((_q, s) => s.writeHead(500).end("oops /api/hooks/h1?key=s3cret"));
    const hang = await receiver(() => {});
    receivers.push(five, hang);
    svc.registry.add({ deviceToken: `http://127.0.0.1:${five.port}/api/hooks/h1?key=s3cret`, transport: "webhook", label: "nanoMuse" });
    svc.registry.add({ deviceToken: `http://127.0.0.1:${hang.port}/api/hooks/h1?key=s3cret`, transport: "webhook", label: "nanoMuse" });

    const tested = await app!.inject({ method: "POST", url: "/api/push/test", payload: {} });
    svc.dispatcher.fanout("s", { eventType: "agent_end", after: { status: "idle" }, unreadEdge: true });
    await new Promise((res) => setTimeout(res, 600));
    await flush();
    const listed = await app!.inject({ method: "GET", url: "/api/push/register" });

    const output = [tested.body, listed.body, ...lines].join("\n");
    expect(output).toContain("nanoMuse (https://hooks.example:8443)");
    expect(output).toContain(`nanoMuse (http://127.0.0.1:${five.port})`);
    expect(output).not.toContain("/api/hooks/h1");
    expect(output).not.toContain("s3cret");
    expect(tested.json().results.every((x: { ok: boolean }) => x.ok === false)).toBe(true);
  });
});
