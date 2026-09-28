/**
 * add-access-grants-and-review — tasks 5.1 and 5.2.
 *
 * 5.1: a refused CORS origin is recorded in the denial ledger without changing
 * the CORS decision or the response.
 * 5.2: every allowance branch is classified, and ONLY a configured origin is
 * revocable — loopback, the active/live tunnel, the zrok wildcard, the neutral
 * shell, and a `trustedNetworks` host are structural and cannot be revoked from
 * the configured list.
 *
 * See change: add-access-grants-and-review.
 */
import cors from "@fastify/cors";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { type CorsOriginOptions, classifyCorsOrigin, isCorsOriginAllowed } from "../auth/cors-origin.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { blockEvents } from "../tunnel/tunnel-block-events.js";

const UNTRUSTED = "203.0.113.5";

/** Options with a knob for each structural branch. */
function opts(over: Partial<CorsOriginOptions> = {}): CorsOriginOptions {
  return {
    configuredOrigins: [],
    trustedNetworks: [],
    getTunnelUrl: () => null,
    getLiveTunnelOrigins: () => [],
    ...over,
  };
}

describe("5.2 — configured vs structural CORS allowances", () => {
  const cases: Array<{
    label: string;
    origin: string | undefined;
    o: CorsOriginOptions;
    kind: string;
    allowed: boolean;
    revocable: boolean;
  }> = [
    {
      label: "no Origin (same-origin navigation)",
      origin: undefined,
      o: opts(),
      kind: "same-origin",
      allowed: true,
      revocable: false,
    },
    {
      label: "opaque `null` origin",
      origin: "null",
      o: opts({ configuredOrigins: ["null"] }),
      kind: "opaque",
      allowed: false,
      revocable: false,
    },
    {
      label: "loopback, any port",
      origin: "http://localhost:5173",
      o: opts(),
      kind: "loopback",
      allowed: true,
      revocable: false,
    },
    {
      label: "the active tunnel URL",
      origin: "https://abc.share.zrok.io",
      o: opts({ getTunnelUrl: () => "https://abc.share.zrok.io", allowZrokWildcard: false }),
      kind: "active-tunnel",
      allowed: true,
      revocable: false,
    },
    {
      label: "a live non-primary tunnel origin",
      origin: "https://mac.tail1234.ts.net",
      o: opts({ getLiveTunnelOrigins: () => ["https://mac.tail1234.ts.net"] }),
      kind: "live-tunnel",
      allowed: true,
      revocable: false,
    },
    {
      label: "the zrok wildcard",
      origin: "https://stranger.share.zrok.io",
      o: opts(),
      kind: "zrok-wildcard",
      allowed: true,
      revocable: false,
    },
    {
      label: "the neutral static PWA shell",
      origin: "https://pi-dashboard.dev",
      o: opts(),
      kind: "pwa-shell",
      allowed: true,
      revocable: false,
    },
    {
      label: "a trustedNetworks host",
      origin: "http://192.168.16.242:8000",
      o: opts({ trustedNetworks: ["192.168.16.0/24"] }),
      kind: "trusted-network",
      allowed: true,
      revocable: false,
    },
    {
      label: "an explicitly configured origin",
      origin: "https://dashboard.example.com",
      o: opts({ configuredOrigins: ["https://dashboard.example.com"] }),
      kind: "configured",
      allowed: true,
      revocable: true,
    },
    {
      label: "an unknown origin",
      origin: "https://evil.example.com",
      o: opts({ configuredOrigins: ["https://good.example.com"] }),
      kind: "denied",
      allowed: false,
      revocable: false,
    },
  ];

  for (const c of cases) {
    it(`${c.label} → ${c.kind} (allowed=${c.allowed}, revocable=${c.revocable})`, () => {
      const decision = classifyCorsOrigin(c.origin, c.o);
      expect(decision).toEqual({ allowed: c.allowed, revocable: c.revocable, kind: c.kind });
      // The boolean decision must not drift from the classification.
      expect(isCorsOriginAllowed(c.origin, c.o)).toBe(c.allowed);
    });
  }

  it("revoking a configured origin cannot remove a structural allowance for the same origin", () => {
    // A configured entry for an origin that is ALSO structurally allowed is
    // classified by the structural branch, because deleting it from the
    // configured list would not actually remove the allowance.
    const loopback = classifyCorsOrigin("http://localhost:5173", opts({ configuredOrigins: ["http://localhost:5173"] }));
    expect(loopback.kind).toBe("loopback");
    expect(loopback.revocable).toBe(false);

    const trusted = classifyCorsOrigin(
      "http://10.0.0.5:8000",
      opts({ configuredOrigins: ["http://10.0.0.5:8000"], trustedNetworks: ["10.0.0.0/8"] }),
    );
    expect(trusted.kind).toBe("trusted-network");
    expect(trusted.revocable).toBe(false);
  });
});

describe("5.1 — a refused origin is recorded without changing the CORS decision", () => {
  beforeEach(() => blockEvents.clear());

  it("records the refused origin and leaves the CORS response unchanged", async () => {
    const REFUSED = "https://refused.example";
    const corsOpts = opts();

    const app = Fastify();
    app.decorateRequest("isAuthenticated", false);
    await app.register(cors, {
      origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin ?? undefined, corsOpts)),
      credentials: true,
    });
    app.addHook(
      "onRequest",
      createNetworkGuardHook({ trustedNetworks: [], getBypassUrls: () => [], getPairingPrefixes: () => [] }),
    );
    app.get("/api/sessions", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: UNTRUSTED,
      headers: { origin: REFUSED },
    });
    await app.close();

    // The denial is sent; the refused origin was recorded on the peer's entry.
    expect(res.statusCode).toBe(403);
    expect(blockEvents.list().find((e) => e.ip === UNTRUSTED)?.origin).toBe(REFUSED);

    // The CORS decision itself is UNCHANGED: no ACAO for the refused origin,
    // and an allowed origin still decides the same way.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(isCorsOriginAllowed(REFUSED, corsOpts)).toBe(false);
    expect(isCorsOriginAllowed("http://localhost:5173", corsOpts)).toBe(true);
    expect(classifyCorsOrigin(REFUSED, corsOpts).allowed).toBe(false);
  });
});
