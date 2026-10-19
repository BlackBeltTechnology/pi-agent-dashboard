/**
 * P1: tail latency of the runtime-fallback path. Opt-in (`PI_BENCH=1`) so the
 * default suite stays deterministic. Prints p50/p95 for the PR.
 * See change: fix-provider-catalogue-first-run (test-plan #P1, design Risks).
 */
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { oauthRegistryReady, setOAuthRegistryRuntimeSource } from "../auth/provider-auth-registry.js";
import { getServerModelRuntime } from "../model-proxy/server-model-runtime.js";
import { _resetForTests } from "../package/provider-catalogue-cache.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

const ITERATIONS = 50;
const BUDGET_MS = 50;

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

describe.skipIf(process.env.PI_BENCH !== "1")("fallback catalogue latency (P1)", () => {
  afterAll(() => setOAuthRegistryRuntimeSource(undefined));

  it(`p95 < ${BUDGET_MS} ms for /status and /catalogue-ready, fired concurrently`, async () => {
    _resetForTests();
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await oauthRegistryReady();
    const app = Fastify({ logger: false });
    registerProviderAuthRoutes(app, {
      piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as never,
      browserGateway: { broadcastToAll: vi.fn() } as never,
    });
    await app.ready();

    const timed = async (url: string) => {
      const t0 = performance.now();
      await app.inject({ method: "GET", url });
      return performance.now() - t0;
    };
    // One discarded warm request.
    await Promise.all([timed("/api/provider-auth/status"), timed("/api/provider-auth/catalogue-ready")]);

    const status: number[] = [];
    const ready: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const [a, b] = await Promise.all([timed("/api/provider-auth/status"), timed("/api/provider-auth/catalogue-ready")]);
      status.push(a);
      ready.push(b);
    }
    console.log(
      `[P1] /status p50=${pct(status, 0.5).toFixed(2)}ms p95=${pct(status, 0.95).toFixed(2)}ms | ` +
        `/catalogue-ready p50=${pct(ready, 0.5).toFixed(2)}ms p95=${pct(ready, 0.95).toFixed(2)}ms`,
    );
    expect(pct(status, 0.95)).toBeLessThan(BUDGET_MS);
    expect(pct(ready, 0.95)).toBeLessThan(BUDGET_MS);
    await app.close();
  }, 60_000);
});
