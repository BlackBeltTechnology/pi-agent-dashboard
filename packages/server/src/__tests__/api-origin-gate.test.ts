/**
 * The mutating-REST Origin gate (issue #625, design D4).
 *
 * The blind-CSRF half of the chain: CORS hid the RESPONSE from an attacker page
 * but never stopped the REQUEST, so `fetch("/api/tunnel-connect", {method:
 * "POST", mode:"no-cors"})` from any site executed with the user's ambient
 * trust. One `onRequest` hook refuses it.
 *
 * Driven through the REAL hook factory (`createMutationOriginGate`) so the
 * ordering, the method set and the post-routing path rule are all under test,
 * with stub handlers that make "the handler never ran" directly observable.
 *
 * Folds test-plan #E12–#E17, #X3.
 * See change: fix-ws-origin-cswsh.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const ATTACKER = "http://attacker.example";
const LOOPBACK = "http://127.0.0.1:8000";

const handler = vi.fn(async () => ({ ok: true }));

/** An app carrying the real gate plus stubs at the real route patterns. */
function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook(
    "onRequest",
    createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] })),
  );
  for (const url of [
    "/api/tunnel-connect",
    "/api/pair/challenge",
    "/auth/logout",
    "/auth/login",
    "/editor/thing",
  ]) {
    app.route({ method: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"], url, handler });
  }
  app.get("/auth/callback/github", handler);
  return app;
}

describe("mutating REST Origin gate", () => {
  let app: FastifyInstance;
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    handler.mockClear();
    errors = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    spy.mockRestore();
  });

  const inject = (method: string, url: string, origin?: string) =>
    app.inject({ method: method as "GET", url, headers: origin === undefined ? {} : { origin } });

  // #E12 — the method × origin matrix.
  describe("#E12 method × origin", () => {
    const MUTATING = ["POST", "PUT", "DELETE", "PATCH"];
    const SAFE = ["GET", "HEAD", "OPTIONS"];

    for (const method of MUTATING) {
      for (const origin of [ATTACKER, "null"]) {
        it(`${method} with origin ${origin} → 403, handler never runs`, async () => {
          const res = await inject(method, "/api/tunnel-connect", origin);
          expect(res.statusCode).toBe(403);
          expect(res.json()).toEqual({ error: "untrusted origin" });
          expect(handler).not.toHaveBeenCalled();
        });
      }

      for (const [label, origin] of [
        ["absent", undefined],
        ["loopback", LOOPBACK],
      ] as const) {
        it(`${method} with ${label} origin → not 403`, async () => {
          const res = await inject(method, "/api/tunnel-connect", origin);
          expect(res.statusCode).not.toBe(403);
          expect(handler).toHaveBeenCalled();
        });
      }
    }

    for (const method of SAFE) {
      it(`${method} with an attacker origin → not 403 (reads are CORS's job)`, async () => {
        const res = await inject(method, "/api/tunnel-connect", ATTACKER);
        expect(res.statusCode).not.toBe(403);
      });
    }

    it("logs one sanitized [csrf-gate] line per refusal", async () => {
      await inject("POST", "/api/tunnel-connect", ATTACKER);
      const lines = errors.filter((l) => l.includes("[csrf-gate]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("POST");
      expect(lines[0]).toContain("/api/tunnel-connect");
      expect(lines[0]).toContain(`origin=${ATTACKER}`);
    });
  });

  // #E13 — path tricks route (or fail to route) but never bypass the gate.
  describe("#E13 path variants never reach the handler", () => {
    for (const url of ["//api/tunnel-connect", "/api//tunnel-connect", "/API/tunnel-connect"]) {
      it(`POST ${url} with an attacker origin → 403 or 404, handler never runs`, async () => {
        const res = await inject("POST", url, ATTACKER);
        expect([403, 404]).toContain(res.statusCode);
        expect(handler).not.toHaveBeenCalled();
      });
    }
  });

  // #E15 — the gate is a floor on `/api/` + logout, and nothing else.
  describe("#E15 scope", () => {
    it("does not gate the OAuth callback (a GET, reachable through tunnels)", async () => {
      const res = await inject("GET", "/auth/callback/github?code=x", ATTACKER);
      expect(res.statusCode).not.toBe(403);
    });

    for (const url of ["/auth/login", "/editor/thing"]) {
      it(`does not gate POST ${url}`, async () => {
        const res = await inject("POST", url, ATTACKER);
        expect(res.json()).not.toEqual({ error: "untrusted origin" });
      });
    }
  });

  // #E16 / #E17 — the pairing flows that must keep working.
  describe("#E16/#E17 pairing", () => {
    it("#E16 admits a plain-LAN page posting to its own dashboard (Host match)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/pair/challenge",
        headers: { host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000" },
      });
      expect(res.statusCode).not.toBe(403);
    });

    it("#E17 admits the static pi-dashboard.dev pairing shell", async () => {
      const res = await inject("POST", "/api/pair/challenge", "https://pi-dashboard.dev");
      expect(res.statusCode).not.toBe(403);
    });
  });

  // #X3 — malformed Origin values deny without throwing.
  describe("#X3 malformed Origin", () => {
    for (const origin of ["", "null ", "not a url"]) {
      it(`POST with origin ${JSON.stringify(origin)} → 403`, async () => {
        const res = await inject("POST", "/api/tunnel-connect", origin);
        expect(res.statusCode).toBe(403);
        expect(handler).not.toHaveBeenCalled();
      });
    }
  });
});

// #E14 — `POST /auth/logout` is the one mutating auth route, and a refusal must
// not clear the session cookie (the drive-by logout this gate exists to stop).
describe("#E14 POST /auth/logout", () => {
  let handle: TestServerHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
  });

  it("403s an attacker origin without clearing the cookie, and still logs out from loopback", async () => {
    handle = await createTestServer({
      authConfig: {
        secret: "test-secret-abc",
        providers: { github: { clientId: "x", clientSecret: "y" } },
      },
    });
    const url = `http://127.0.0.1:${handle.httpPort}/auth/logout`;

    const refused = await fetch(url, { method: "POST", headers: { origin: ATTACKER }, redirect: "manual" });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("set-cookie") ?? "").not.toContain("pi_dash_token");

    const ok = await fetch(url, {
      method: "POST",
      headers: { origin: `http://127.0.0.1:${handle.httpPort}` },
      redirect: "manual",
    });
    expect(ok.status).not.toBe(403);
    expect(ok.headers.get("set-cookie") ?? "").toContain("pi_dash_token");
  }, 30000);

  it("is wired into the real server: an attacker-origin /api/ mutation is refused", async () => {
    handle = await createTestServer();
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/ws-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ATTACKER },
      body: JSON.stringify({ scope: "browser" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "untrusted origin" });
  }, 30000);
});
