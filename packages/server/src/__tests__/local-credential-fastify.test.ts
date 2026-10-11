/**
 * The edge stamp through a REAL Fastify instance on a real loopback socket:
 * method + request-target binding (E12) and stamp propagation / non-leak (E13).
 *
 * See change: loopback-credential-proof (tasks 2.12, 3.1).
 */
import type { AddressInfo } from "node:net";
import {
  canonicalBinding,
  httpPurpose,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalCredentialVerifier, hasLocalCredential } from "../auth/local-credential.js";

const TOKEN = "fastify-token-0123456789abcdefghijklmnopqrstuvwxyz";
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(configure?: (f: FastifyInstance) => void): Promise<{ port: number; seen: Record<string, unknown> }> {
  const f = Fastify();
  app = f;
  const seen: Record<string, unknown> = {};
  const v = createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: true, log: () => {} });
  const boundAt = Date.now() - 1000;
  f.addHook("onRequest", async (request) => {
    v.stamp(request.raw, { kind: "http", boundAt });
  });
  configure?.(f);
  f.all("/api/x", async (request, reply) => {
    if (!hasLocalCredential(request.headers)) {
      reply.code(401);
      return { success: false, error: "local credential required" };
    }
    return { success: true };
  });
  f.get("/probe", async (request) => {
    // Force Fastify's `Object.assign` copy of the headers.
    (request as unknown as { headers: Record<string, string> }).headers = { "x-extra": "1" };
    const copy = request.headers as Record<string, unknown>;
    seen.inCopy = hasLocalCredential(copy);
    seen.inRaw = hasLocalCredential(request.raw.headers);
    seen.json = JSON.stringify(request.raw.headers);
    seen.entries = Object.entries(copy).map(([k]) => k);
    return { ok: true };
  });
  await f.listen({ port: 0, host: "127.0.0.1" });
  return { port: (f.server.address() as AddressInfo).port, seen };
}

const proof = (port: number, method: string, target: string) =>
  mintProof({
    token: TOKEN,
    binding: canonicalBinding("127.0.0.1", port),
    purpose: httpPurpose(method, target),
  }).header;

describe("E12 HTTP purpose binds method + request target", () => {
  it("admits the exact request, refuses another method or target with an identical body", async () => {
    const { port } = await start();
    const target = new URL("http://127.0.0.1/api/x?a=1&b=%20c");
    const path = target.pathname + target.search;
    const url = `http://127.0.0.1:${port}${path}`;

    const ok = await fetch(url, { headers: { "X-Pi-Local-Proof": proof(port, "GET", path) } });
    expect(ok.status).toBe(200);

    const none = await fetch(`http://127.0.0.1:${port}/api/x`);
    const noneBody = await none.text();
    expect(none.status).toBe(401);

    const post = await fetch(url, { method: "POST", headers: { "X-Pi-Local-Proof": proof(port, "GET", path) } });
    expect(post.status).toBe(401);
    expect(await post.text()).toBe(noneBody);

    const other = await fetch(`http://127.0.0.1:${port}/api/x?a=1`, {
      headers: { "X-Pi-Local-Proof": proof(port, "GET", path) },
    });
    expect(other.status).toBe(401);
    expect(await other.text()).toBe(noneBody);
  });
});

describe("E13 stamp propagation and non-leak", () => {
  it("is visible in hooks, routes and Fastify's header copy; never serialized; unforgeable", async () => {
    let hookSaw: boolean | undefined;
    const { port, seen } = await start((f) => {
      f.addHook("onRequest", async (request) => {
        hookSaw = hasLocalCredential(request.headers);
      });
    });
    const res = await fetch(`http://127.0.0.1:${port}/probe`, {
      headers: { "X-Pi-Local-Proof": proof(port, "GET", "/probe") },
    });
    expect(res.status).toBe(200);
    expect(hookSaw).toBe(true);
    expect(seen.inRaw).toBe(true);
    expect(seen.inCopy).toBe(true);
    expect(String(seen.json)).not.toContain("local-credential");
    expect((seen.entries as string[]).some((k) => k.includes("local-credential"))).toBe(false);
  });

  it("a client header NAMED like the stamp grants nothing (a Symbol key cannot arrive over HTTP)", async () => {
    const { port } = await start();
    // `Symbol(local-credential)` is not even a legal header name, so the client
    // library refuses to send it; the closest spellings must grant nothing.
    const res = await fetch(`http://127.0.0.1:${port}/api/x`, {
      headers: { "local-credential": "proof", "x-local-credential": "proof" },
    });
    expect(res.status).toBe(401);
    await expect(
      fetch(`http://127.0.0.1:${port}/api/x`, { headers: { "Symbol(local-credential)": "proof" } }),
    ).rejects.toThrow();
  });
});
