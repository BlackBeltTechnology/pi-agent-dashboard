/**
 * `/plugin-assets` under the host's baseline CSP, and the server latency budget of the runtime-client
 * endpoints (10 runtime-eligible plugins × 50 files, warm stat cache, localhost).
 *
 * See change: decouple-plugins-from-core (tasks 6.10, 6.11; test-plan #E83 CSP half, #P4).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache, clearStatusStore, getPluginStatusStore, registerPluginAssetsRoute } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsp, buildStrictCsp, registerCsp } from "../auth/csp.js";
import { grantClientTrust } from "../auth/plugin-trust-store.js";
import { getRuntimeClientRegistry, installRuntimeClientRegistry, resetRuntimeClientRegistry } from "../plugin-runtime-clients.js";
import { registerPluginActivationRoutes } from "../routes/plugin-activation-routes.js";
import { registerPluginRuntimeClientRoutes } from "../routes/plugin-runtime-client-routes.js";

const HOME_OVERRIDE = path.join(os.tmpdir(), `pi-plugin-assets-int-${process.pid}`);
let originalHome: string | undefined;
let repoRoot: string;
let app: FastifyInstance | undefined;

function mk(id: string, files = 50): void {
  const dir = path.join(repoRoot, "packages", id);
  fs.mkdirSync(path.join(dir, "dist", "client"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "client", "index.js"), `export default "${id}";\n`);
  for (let i = 1; i < files; i++) fs.writeFileSync(path.join(dir, "dist", "client", `chunk-${i}.js`), `export const n = ${i};\n`);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: id, version: "1.0.0", "pi-dashboard-plugin": { id, displayName: id, claims: [], client: "./src/c.tsx", clientBundle: "./dist/client/index.js", hostApi: "^1.0.0" } }),
  );
  getPluginStatusStore().setStatus({ id, displayName: id, enabled: true, loaded: true, claims: 0 });
}

beforeEach(() => {
  clearDiscoveryCache();
  clearStatusStore();
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME_OVERRIDE, ".pi", "dashboard"), { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = HOME_OVERRIDE;
  repoRoot = path.join(os.tmpdir(), `plugin-assets-int-root-${process.pid}-${Date.now()}`);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  resetRuntimeClientRegistry();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("E83: the host baseline CSP stamps /plugin-assets; there is no per-app CSP", () => {
  it.each(["report", "enforce"] as const)("%s mode", async (mode) => {
    mk("ext", 2);
    const reg = installRuntimeClientRegistry({ repoRoot, declaredIds: () => ["flows"] });
    const sha = reg.currentContentHash("ext") as string;
    grantClientTrust("ext", sha);
    app = Fastify({ logger: false });
    registerCsp(app, mode);
    registerPluginAssetsRoute(app, { getRegistry: getRuntimeClientRegistry });
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/plugin-assets/ext/${sha}/index.js` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    // `report`: baseline + strict Report-Only; `enforce`: strict enforcing. A non-HTML asset carries no nonce.
    const ro = [res.headers["content-security-policy-report-only"]].flat().filter((v): v is string => typeof v === "string");
    const en = [res.headers["content-security-policy"]].flat().filter((v): v is string => typeof v === "string");
    expect(ro.map((v) => v.split("; report-uri")[0])).toEqual(mode === "report" ? [buildCsp(), buildStrictCsp()] : []);
    expect(en.map((v) => v.split("; report-uri")[0])).toEqual(mode === "enforce" ? [buildStrictCsp()] : []);
  });
});

describe("P4: runtime-client endpoints stay within the server latency budget", () => {
  async function p95(url: string, n = 200): Promise<number> {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const res = await (app as FastifyInstance).inject({ method: "GET", url });
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length * 0.95)];
  }

  it("10 admitted plugins × 50 files: GET /api/plugins and /api/plugins/runtime-clients p95 ≤ 50 ms, /plugin-assets p95 ≤ 10 ms", async () => {
    for (let i = 0; i < 10; i++) mk(`perf${i}`);
    const reg = installRuntimeClientRegistry({ repoRoot, declaredIds: () => ["flows"] });
    for (let i = 0; i < 10; i++) grantClientTrust(`perf${i}`, reg.currentContentHash(`perf${i}`) as string);
    app = Fastify({ logger: false });
    registerPluginActivationRoutes(app, { networkGuard: async () => undefined, broadcast: () => {}, repoRoot });
    registerPluginRuntimeClientRoutes(app, { networkGuard: async () => undefined, broadcast: () => {}, repoRoot, log: { info: () => {} } });
    registerPluginAssetsRoute(app, { getRegistry: getRuntimeClientRegistry });
    await app.ready();

    const listing = await app.inject({ method: "GET", url: "/api/plugins/runtime-clients" });
    expect(listing.json().plugins).toHaveLength(10);
    const sha = reg.currentContentHash("perf4") as string;

    expect(await p95("/api/plugins")).toBeLessThanOrEqual(50);
    expect(await p95("/api/plugins/runtime-clients")).toBeLessThanOrEqual(50);
    expect(await p95(`/plugin-assets/perf4/${sha}/chunk-9.js`)).toBeLessThanOrEqual(10);
  }, 60_000);
});
