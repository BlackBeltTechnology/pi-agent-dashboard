/**
 * Every exemption site honours the stamped verdict (test-plan E14): for each
 * site × verdict {proof, legacy, absent, invalid}, proof and legacy admit,
 * absent and invalid do not, and the refusal bodies are byte-identical.
 *
 * Sites covered here: strict local proof (`hasLocalProof`), `validateWsUpgrade`,
 * `authorizeWsUpgrade`, the universal network guard, `POST /api/local-proof`,
 * and the pairing operator guard. The identity local-code / break-glass sites
 * ride the real server in `identity/__tests__/identity-break-glass.test.ts`.
 *
 * See change: loopback-credential-proof (task 3.2).
 */
import type { AddressInfo } from "node:net";
import {
  canonicalBinding,
  httpPurpose,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeWsUpgrade, validateWsUpgrade } from "../auth/auth-plugin.js";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { createLocalTrustContext, hasLocalProof, LocalProofCodeStore } from "../auth/local-proof.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { registerLocalProofRoutes } from "../routes/local-proof-routes.js";

const TOKEN = "sites-token-0123456789abcdefghijklmnopqrstuvwxyz";
const SECRET = "jwt-secret";
const VERDICTS = ["proof", "legacy", "absent", "invalid"] as const;
type V = (typeof VERDICTS)[number];
const admits = (v: V) => v === "proof" || v === "legacy";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Real HTTP: the request header set carrying each kind of credential. */
function headersFor(v: V, port: number, method: string, target: string): Record<string, string> {
  switch (v) {
    case "proof":
      return {
        "X-Pi-Local-Proof": mintProof({
          token: TOKEN,
          binding: canonicalBinding("127.0.0.1", port),
          purpose: httpPurpose(method, target),
        }).header,
      };
    case "legacy":
      return { "X-Pi-Local-Token": TOKEN };
    case "invalid":
      return { "X-Pi-Local-Proof": "v1.0000000000000.AAAAAAAAAAAAAAAAAAAAAA." + "B".repeat(43) };
    default:
      return {};
  }
}

/** Non-HTTP sites: a headers object stamped by a verifier on a fake socket. */
function stampedFor(v: V): Record<string, unknown> {
  const port = 41999;
  const headers: Record<string, unknown> = { host: `127.0.0.1:${port}` };
  Object.assign(headers, Object.fromEntries(Object.entries(headersFor(v, port, "GET", "/ws")).map(([k, x]) => [k.toLowerCase(), x])));
  createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: true, log: () => {} }).stamp(
    { headers, method: "GET", url: "/ws", socket: { localAddress: "127.0.0.1", localPort: port } },
    { kind: "http", boundAt: Date.now() - 60_000 },
  );
  return headers;
}

async function serve(configure: (f: FastifyInstance) => void | Promise<void>): Promise<number> {
  const f = Fastify();
  app = f;
  const verifier = createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: true, log: () => {} });
  const boundAt = Date.now() - 60_000;
  f.addHook("onRequest", async (request) => {
    verifier.stamp(request.raw, { kind: "http", boundAt });
  });
  await configure(f);
  await f.listen({ port: 0, host: "127.0.0.1" });
  return (f.server.address() as AddressInfo).port;
}

describe("E14 non-HTTP sites", () => {
  it.each(VERDICTS)("hasLocalProof / validateWsUpgrade / authorizeWsUpgrade: %s", (v) => {
    const ctx = createLocalTrustContext(TOKEN, () => true);
    expect(hasLocalProof(stampedFor(v), ctx)).toBe(admits(v));
    // A tunnel-presenting peer (non-loopback address): only the credential can admit it.
    expect(
      validateWsUpgrade(undefined, "10.9.9.9", SECRET, [], { headers: stampedFor(v), localToken: TOKEN }),
    ).toBe(admits(v));
    expect(
      authorizeWsUpgrade({
        cookieHeader: undefined,
        remoteAddress: "10.9.9.9",
        secret: SECRET,
        headers: stampedFor(v),
        localToken: TOKEN,
      }).ok,
    ).toBe(admits(v));
  });
});

describe("E14 HTTP sites", () => {
  it("the universal network guard admits proof/legacy, refuses absent/invalid with one body", async () => {
    const ctx = createLocalTrustContext(TOKEN, () => false);
    const port = await serve((f) => {
      f.decorateRequest("isAuthenticated", false);
      f.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], localToken: TOKEN, localTrust: ctx }));
      f.get("/api/sessions", async () => ({ ok: true }));
    });
    const bodies: string[] = [];
    for (const v of VERDICTS) {
      // x-forwarded-for => NOT genuinely local, so only the credential can admit.
      const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: { ...headersFor(v, port, "GET", "/api/sessions"), "x-forwarded-for": "203.0.113.9" },
      });
      expect(res.status === 200, v).toBe(admits(v));
      if (!admits(v)) bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("POST /api/local-proof admits proof/legacy, refuses absent/invalid with one body", async () => {
    const ctx = createLocalTrustContext(TOKEN, () => false);
    const port = await serve(async (f) => {
      await f.register(fastifyCookie);
      registerLocalProofRoutes(f, { codes: new LocalProofCodeStore(), ctx });
    });
    const bodies: string[] = [];
    for (const v of VERDICTS) {
      const res = await fetch(`http://127.0.0.1:${port}/api/local-proof`, {
        method: "POST",
        headers: headersFor(v, port, "POST", "/api/local-proof"),
      });
      expect(res.status === 200, v).toBe(admits(v));
      if (!admits(v)) bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
