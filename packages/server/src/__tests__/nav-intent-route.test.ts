/**
 * POST /api/nav-intent behind the mutation-origin gate + CORS allowlist
 * (change: harden-client-sinks, test-plan #X4). Exemplar: cors.test.ts.
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCorsOriginAllowed } from "../auth/cors-origin.js";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { NavIntents } from "../auth/nav-intent.js";
import { registerNavIntentRoutes } from "../routes/nav-intent-routes.js";

let app: FastifyInstance;
let intents: NavIntents;
const opts = () => ({ configuredOrigins: [], trustedNetworks: [] });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  intents = new NavIntents();
  app = Fastify({ logger: false });
  await app.register(cors, { origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin ?? undefined, opts())), credentials: true });
  app.addHook("onRequest", createMutationOriginGate(opts));
  registerNavIntentRoutes(app, { networkGuard: async () => {}, intents, principalOf: () => "local-operator" });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const BODY = { kind: "file-view", target: { cwd: "/home/op/p", path: "page.html" } };

describe("cross-site mint refused (#X4)", () => {
  it("a hostile Origin is refused by the mutation-origin gate, with no ACAO and no intent", async () => {
    const mint = vi.spyOn(intents, "mint");
    const res = await app.inject({
      method: "POST",
      url: "/api/nav-intent",
      headers: { origin: "https://evil.example", host: "127.0.0.1:8000", "content-type": "application/json" },
      payload: JSON.stringify(BODY),
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.body).not.toMatch(/"ni"/);
    expect(mint).not.toHaveBeenCalled();
  });

  it("a same-origin caller mints, and the intent verifies for the same principal + target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/nav-intent",
      headers: { host: "127.0.0.1:8000", "content-type": "application/json" },
      payload: JSON.stringify(BODY),
    });
    expect(res.statusCode).toBe(200);
    const { ni } = res.json() as { ni: string };
    const verify = (target: unknown) =>
      app.inject({
        method: "POST",
        url: "/api/nav-intent/verify",
        headers: { host: "127.0.0.1:8000", "content-type": "application/json" },
        payload: JSON.stringify({ ni, kind: "file-view", target }),
      });
    expect((await verify(BODY.target)).json()).toMatchObject({ ok: true });
    expect((await verify({ ...BODY.target, path: "other.html" })).json()).toMatchObject({ ok: false });
  });

  it("a malformed mint body → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/nav-intent",
      headers: { host: "127.0.0.1:8000", "content-type": "application/json" },
      payload: JSON.stringify({ kind: "nope", target: {} }),
    });
    expect(res.statusCode).toBe(400);
  });
});
