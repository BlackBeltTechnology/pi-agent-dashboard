/**
 * Central identity road gate (D10/D14/D24; tasks 18.14 + 18.28). One Fastify
 * hook applies, per classified route:
 *  - session road  ⇒ exact owner equality (404 on mismatch, no oracle);
 *  - non-session   ⇒ the OPTIONAL host policy (403 on deny, fail-closed);
 *  - identity      ⇒ never gated.
 * Inert plane ⇒ no-op, even with a policy loaded (18.14 regression).
 */
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityRoadGate } from "../identity-road-gate.js";
import { PolicyRegistry } from "../policy-registry.js";
import { LOCAL_OPERATOR, markLocalOperator } from "../session-access.js";

const anna: Principal = { iss: "https://kc/realms/app", sub: "anna" };
const bela: Principal = { iss: "https://kc/realms/app", sub: "bela" };
const owners: Record<string, Principal | undefined> = { "s-anna": anna, "s-none": undefined };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(opts: {
  enforced: boolean;
  policy?: (input: { principal: Principal; action: string; resource: { kind: string } }) => Promise<boolean>;
  audit?: (e: unknown) => void;
}) {
  const registry = new PolicyRegistry({ trustedPolicyPlugin: "p", audit: opts.audit });
  if (opts.policy) registry.register("p", opts.policy as never);
  app = Fastify();
  // Mirror the real server's global limiter (CodeQL js/missing-rate-limiting).
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  // Stand-in for the resolver hook: `x-as: anna|bela|local` sets the principal.
  app.addHook("onRequest", async (req) => {
    const who = req.headers["x-as"];
    if (who === "anna") (req as { principal?: Principal }).principal = anna;
    if (who === "bela") (req as { principal?: Principal }).principal = bela;
    if (who === "local") markLocalOperator(req);
  });
  app.addHook(
    "preHandler",
    createIdentityRoadGate({
      isEnforced: () => opts.enforced,
      policy: registry,
      ownerOf: (id) => owners[id],
    }),
  );
  const ok = async () => ({ ok: true });
  app.post("/api/session/:id/prompt", ok);
  app.get("/api/git/status", ok);
  app.get("/api/plugins/acme/deals", ok);
  app.get("/api/brand-new-thing", ok);
  app.get("/api/health", ok);
  app.all("/live/:id/*", ok);
  app.all("/editor/:id/*", ok);
  app.get("/api/sessions", ok);
  return app;
}

const call = (a: FastifyInstance, method: "GET" | "POST", url: string, as?: string) =>
  a.inject({ method, url, headers: as ? { "x-as": as } : {} });

describe("inert plane (18.14)", () => {
  it("a loaded policy does NOT gate anything while identity is not enforced", async () => {
    const policy = vi.fn().mockResolvedValue(false);
    const a = await build({ enforced: false, policy });
    expect((await call(a, "GET", "/api/git/status")).statusCode).toBe(200);
    expect((await call(a, "POST", "/api/session/s-anna/prompt", "bela")).statusCode).toBe(200);
    expect(policy).not.toHaveBeenCalled();
  });
});

describe("session roads — owner equality", () => {
  it("owner passes; non-owner, principal-less and ownerless get 404", async () => {
    const a = await build({ enforced: true });
    expect((await call(a, "POST", "/api/session/s-anna/prompt", "anna")).statusCode).toBe(200);
    expect((await call(a, "POST", "/api/session/s-anna/prompt", "bela")).statusCode).toBe(404);
    expect((await call(a, "POST", "/api/session/s-anna/prompt")).statusCode).toBe(404);
    expect((await call(a, "POST", "/api/session/s-none/prompt", "anna")).statusCode).toBe(404);
    expect((await call(a, "POST", "/api/session/missing/prompt", "anna")).statusCode).toBe(404);
  });

  it("the D23 local operator reaches every session", async () => {
    const a = await build({ enforced: true });
    expect((await call(a, "POST", "/api/session/s-anna/prompt", "local")).statusCode).toBe(200);
  });

  it("the policy never decides a session road", async () => {
    const policy = vi.fn().mockResolvedValue(false);
    const a = await build({ enforced: true, policy });
    expect((await call(a, "POST", "/api/session/s-anna/prompt", "anna")).statusCode).toBe(200);
    expect(policy).not.toHaveBeenCalled();
  });
});

describe("non-session roads — optional host policy", () => {
  it("no policy ⇒ ungated (D24 default)", async () => {
    const a = await build({ enforced: true });
    expect((await call(a, "GET", "/api/git/status", "anna")).statusCode).toBe(200);
    expect((await call(a, "GET", "/api/brand-new-thing", "anna")).statusCode).toBe(200);
  });

  it("policy allow ⇒ 200 with the classified action + resource", async () => {
    const policy = vi.fn().mockResolvedValue(true);
    const a = await build({ enforced: true, policy });
    expect((await call(a, "GET", "/api/git/status", "anna")).statusCode).toBe(200);
    expect(policy).toHaveBeenCalledWith({
      principal: anna,
      action: "branch.read",
      resource: { kind: "branch", route: "/api/git/status" },
    });
  });

  it("policy deny ⇒ 403 + audit", async () => {
    const audit = vi.fn();
    const a = await build({ enforced: true, policy: async () => false, audit });
    const res = await call(a, "GET", "/api/git/status", "bela");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "forbidden" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "branch.read", reason: "false" }));
  });

  it("plugin-owned route is asked as plugin:<id>:<verb>", async () => {
    const policy = vi.fn().mockResolvedValue(true);
    const a = await build({ enforced: true, policy });
    await call(a, "GET", "/api/plugins/acme/deals", "anna");
    expect(policy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plugin:acme:read", resource: expect.objectContaining({ pluginId: "acme" }) }),
    );
  });

  it("unclassified route under a policy ⇒ 403 (fail-closed), policy not consulted", async () => {
    const policy = vi.fn().mockResolvedValue(true);
    const audit = vi.fn();
    const a = await build({ enforced: true, policy, audit });
    expect((await call(a, "GET", "/api/brand-new-thing", "anna")).statusCode).toBe(403);
    expect(policy).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: "unclassified" }));
  });

  it("principal-less request under a policy ⇒ 403", async () => {
    const a = await build({ enforced: true, policy: async () => true });
    expect((await call(a, "GET", "/api/git/status")).statusCode).toBe(403);
  });

  it("the local operator bypasses the policy (break-glass sees everything)", async () => {
    const policy = vi.fn().mockResolvedValue(false);
    const a = await build({ enforced: true, policy });
    expect((await call(a, "GET", "/api/git/status", "local")).statusCode).toBe(200);
    expect(policy).not.toHaveBeenCalled();
  });

  it("a throwing policy denies", async () => {
    const a = await build({
      enforced: true,
      policy: async () => {
        throw new Error("boom");
      },
    });
    expect((await call(a, "GET", "/api/git/status", "anna")).statusCode).toBe(403);
  });
});

describe("proxied roads /editor/ + /live/ are classified (18.37c)", () => {
  it("/live is asked as live.<verb> with a live resource; /editor as editor.write (opening an editor is a write capability)", async () => {
    const policy = vi.fn().mockResolvedValue(true);
    const a = await build({ enforced: true, policy });
    expect((await call(a, "GET", "/live/x/index.html", "anna")).statusCode).toBe(200);
    expect(policy).toHaveBeenLastCalledWith(expect.objectContaining({ action: "live.read", resource: expect.objectContaining({ kind: "live" }) }));
    expect((await call(a, "POST", "/live/x/api", "anna")).statusCode).toBe(200);
    expect(policy).toHaveBeenLastCalledWith(expect.objectContaining({ action: "live.write" }));
    expect((await call(a, "GET", "/editor/x/", "anna")).statusCode).toBe(200);
    expect(policy).toHaveBeenLastCalledWith(expect.objectContaining({ action: "editor.write", resource: expect.objectContaining({ kind: "editor" }) }));
  });

  it("a denying policy refuses them 403; no policy ⇒ ungated; the operator passes", async () => {
    const deny = vi.fn().mockResolvedValue(false);
    const a = await build({ enforced: true, policy: deny });
    expect((await call(a, "GET", "/live/x/index.html", "anna")).statusCode).toBe(403);
    expect((await call(a, "GET", "/editor/x/", "anna")).statusCode).toBe(403);
    expect((await call(a, "GET", "/editor/x/", "local")).statusCode).toBe(200);
    expect((await call(await build({ enforced: true }), "GET", "/editor/x/", "anna")).statusCode).toBe(200);
  });
});

describe("identity + handler-gated roads", () => {
  it("pre-auth and list roads are not decided by this gate", async () => {
    const policy = vi.fn().mockResolvedValue(false);
    const a = await build({ enforced: true, policy });
    expect((await call(a, "GET", "/api/health")).statusCode).toBe(200);
    expect((await call(a, "GET", "/api/sessions", "anna")).statusCode).toBe(200);
    expect(policy).not.toHaveBeenCalled();
  });
});

it("LOCAL_OPERATOR is the frozen break-glass principal", () => {
  expect(Object.isFrozen(LOCAL_OPERATOR)).toBe(true);
});
