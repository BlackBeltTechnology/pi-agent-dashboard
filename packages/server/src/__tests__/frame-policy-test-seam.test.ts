/**
 * Test-only frame-policy verdict seam (change: rich-chat-links, task 9.12).
 * The seam is default off and REFUSED in production builds; when armed it answers
 * `allowed` / `refused` for `.test` fixture hosts without any socket, through the real
 * route + probe (so the SSRF vetting still runs on the stubbed hop).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { resolveFramePolicyTestSeam } from "../lib/frame-policy-test-seam.js";
import { registerFramePolicyRoutes } from "../routes/frame-policy-routes.js";

const DASH = "http://127.0.0.1:8000";
const corsOpts = () => ({ configuredOrigins: [], trustedNetworks: [], getTunnelUrl: () => null });
const VERDICTS = "framed-allowed.test=allowed,framed-refused.test=refused";
const log = () => ({ warn: vi.fn() });

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function verdictOf(env: NodeJS.ProcessEnv, origin: string): Promise<{ status: number; verdict?: string }> {
  app = Fastify({ logger: false });
  app.addHook("onRequest", createMutationOriginGate(corsOpts));
  vi.spyOn(console, "log").mockImplementation(() => {});
  registerFramePolicyRoutes(app, {
    networkGuard: async () => {},
    corsOpts,
    ownOrigins: () => [],
    ownPorts: () => [8000],
    probe: resolveFramePolicyTestSeam(env, log()),
  });
  await app.ready();
  const res = await app.inject({
    method: "POST",
    url: "/api/web/frame-policy",
    headers: { origin: DASH, "content-type": "application/json" },
    payload: { origin },
  });
  return { status: res.statusCode, verdict: (res.json() as { verdict?: string }).verdict };
}

describe("resolveFramePolicyTestSeam", () => {
  it("is off by default", () => {
    const l = log();
    expect(resolveFramePolicyTestSeam({}, l)).toBeUndefined();
    expect(l.warn).not.toHaveBeenCalled();
  });

  it("ignores the verdict list without the harness seed", () => {
    expect(resolveFramePolicyTestSeam({ PI_E2E_FRAME_POLICY_VERDICTS: VERDICTS }, log())).toBeUndefined();
  });

  it("REFUSES the seam in a production build, even with the harness seed, and says so", () => {
    const l = log();
    const env = { PI_E2E_SEED: "1", NODE_ENV: "production", PI_E2E_FRAME_POLICY_VERDICTS: VERDICTS };
    expect(resolveFramePolicyTestSeam(env, l)).toBeUndefined();
    expect(l.warn).toHaveBeenCalledWith(expect.stringContaining("not available in production"));
  });

  it("drops entries whose host is not under .test", () => {
    const l = log();
    const env = { PI_E2E_SEED: "1", PI_E2E_FRAME_POLICY_VERDICTS: "example.com=allowed,bad=allowed,x.test=maybe" };
    expect(resolveFramePolicyTestSeam(env, l)).toBeUndefined();
    expect(l.warn).toHaveBeenCalledTimes(3);
  });
});

describe("frame-policy route with the seam armed", () => {
  const armed = { PI_E2E_SEED: "1", PI_E2E_FRAME_POLICY_VERDICTS: VERDICTS };

  it("answers allowed / refused for the configured .test hosts without a socket", async () => {
    expect(await verdictOf(armed, "https://framed-allowed.test")).toEqual({ status: 200, verdict: "allowed" });
    await app?.close();
    expect(await verdictOf(armed, "https://framed-refused.test")).toEqual({ status: 200, verdict: "refused" });
  });

  it("in a production build the same host takes the real transport (no stubbed verdict)", async () => {
    const prod = { ...armed, NODE_ENV: "production" };
    const out = await verdictOf(prod, "https://framed-allowed.test");
    expect(out.verdict).not.toBe("allowed");
  });
});
