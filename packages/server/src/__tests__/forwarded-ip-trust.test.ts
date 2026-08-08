// S1/S2 — the authorization gates MUST keep deciding on the socket peer, never
// on a forwarding header.
//
// Background: `auth.redirectBaseUrl` exists to support a reverse-proxy
// deployment, and a first draft of that work proposed enabling Fastify's
// `trustProxy` so the session cookie's `Secure` flag could be derived from
// `X-Forwarded-Proto`. `trustProxy` also rewrites `request.ip` from
// `X-Forwarded-For` — and `request.ip` is exactly what BOTH bypasses read:
//
//   - networkGuard bypass  → localhost-guard.ts  `isBypassedHost(request.ip, trustedNetworks)`
//   - auth-gate bypass     → auth-plugin.ts      `isBypassedHost(request.ip, authState.bypassHosts)`
//
// With `trustProxy` on, anyone able to reach the port directly could send
// `X-Forwarded-For: <an address inside a trusted CIDR>` and pass both gates —
// including the gate on `PUT /api/config`. localhost-guard.ts states the
// invariant in prose ("The recorded IP is the SOCKET PEER (`request.ip`) only
// — never a forwarding header"); these tests make it executable.
//
// The Secure flag is derived from the resolved redirect base instead (D14).
// If anyone enables `trustProxy` later, these tests go red — that is the point.
//
// See change: config-override-oauth-redirect-base (design D14, test-plan S1/S2).

import { describe, expect, it } from "vitest";
import { validateWsUpgrade } from "../auth/auth-plugin.js";
import { createNetworkGuard, isBypassedHost } from "../auth/localhost-guard.js";

const TRUSTED = ["10.0.0.0/8"];
const SPOOFED = "10.1.2.3"; // inside TRUSTED — the address an attacker would claim

describe("S1: REST gate ignores X-Forwarded-For", () => {
  async function inject(headers: Record<string, string>) {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    app.addHook("preHandler", createNetworkGuard(TRUSTED));
    app.get("/guarded", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/guarded", headers });
    await app.close();
    return res;
  }

  it("denies a request whose X-Forwarded-For claims a trusted address", async () => {
    const res = await inject({ "x-forwarded-for": SPOOFED });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });

  it("denies X-Real-IP spoofing too", async () => {
    const res = await inject({ "x-real-ip": SPOOFED });
    expect(res.statusCode).toBe(403);
  });

  it("denies a forwarded chain whose first hop is trusted", async () => {
    const res = await inject({ "x-forwarded-for": `${SPOOFED}, 203.0.113.9` });
    expect(res.statusCode).toBe(403);
  });

  it("still admits a genuinely local request carrying no forwarding header", async () => {
    const res = await inject({});
    expect(res.statusCode).toBe(200);
  });

  it("the trusted CIDR really would admit that address if it were the peer", () => {
    // Guards against a vacuous suite: if TRUSTED did not actually cover SPOOFED,
    // the assertions above would pass no matter how request.ip were derived.
    expect(isBypassedHost(SPOOFED, TRUSTED)).toBe(true);
  });
});

describe("S1: Fastify is not configured to trust proxy headers", () => {
  it("a default Fastify instance reports trustProxy off", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    // `trustProxy` IS on `initialConfig` at runtime but is absent from the
    // published type, so read it through a narrow view rather than `any` — the
    // assertion must keep testing the real runtime value.
    const initialConfig = app.initialConfig as Readonly<{ trustProxy?: boolean | string }>;
    expect(initialConfig.trustProxy).toBeFalsy();
    await app.close();
  });

  it("server.ts does not pass trustProxy", async () => {
    // Structural pin: the runtime assertions above only cover a locally built
    // app, so read the real construction site too.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../server.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/trustProxy\s*:/);
  });
});

describe("S2: WS upgrade authorizes on the same address as REST", () => {
  const SECRET = "test-secret";

  it("rejects an upgrade from an untrusted peer that claims a trusted X-Forwarded-For", () => {
    const allowed = validateWsUpgrade(undefined, "203.0.113.9", SECRET, TRUSTED, {
      headers: { "x-forwarded-for": SPOOFED },
    });
    expect(allowed).toBe(false);
  });

  it("rejects a loopback peer that carries a forwarding header (proxy hop, not same-host)", () => {
    const allowed = validateWsUpgrade(undefined, "127.0.0.1", SECRET, TRUSTED, {
      headers: { "x-forwarded-for": SPOOFED },
    });
    expect(allowed).toBe(false);
  });

  it("admits the peer when the SOCKET address is genuinely in the trusted range", () => {
    const allowed = validateWsUpgrade(undefined, SPOOFED, SECRET, TRUSTED, {});
    expect(allowed).toBe(true);
  });

  it("REST and WS agree for the same spoofed input", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    app.addHook("preHandler", createNetworkGuard(TRUSTED));
    app.get("/guarded", async () => ({ ok: true }));
    const rest = await app.inject({
      method: "GET",
      url: "/guarded",
      headers: { "x-forwarded-for": SPOOFED },
    });
    await app.close();

    const ws = validateWsUpgrade(undefined, "127.0.0.1", SECRET, TRUSTED, {
      headers: { "x-forwarded-for": SPOOFED },
    });

    expect(rest.statusCode).toBe(403);
    expect(ws).toBe(false);
  });
});
