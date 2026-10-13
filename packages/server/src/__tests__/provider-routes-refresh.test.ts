/**
 * `POST /api/providers/:name/refresh` — explicit per-provider models refresh
 * (custom-provider-crud delta; test-plan E1–E6, X1, X2, X5).
 *
 * Harness mirrors `provider-routes-single-provider.test.ts` (real file under
 * the test-isolated HOME, mocked registry singleton); the upstream probe is
 * stubbed so each scenario controls the endpoint's answer.
 *
 * See change: add-provider-models-refresh.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probeState = vi.hoisted(() => ({
  result: { ok: true, status: 200, modelCount: 7, sample: ["a"] } as any,
}));

vi.mock("../package/provider-probe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../package/provider-probe.js")>();
  return { ...actual, probeProvider: vi.fn(async () => probeState.result) };
});

vi.mock("../model-proxy/registry-singleton.js", () => ({
  refreshModelRegistry: vi.fn().mockResolvedValue(undefined),
}));

import { refreshModelRegistry } from "../model-proxy/registry-singleton.js";
import { probeProvider } from "../package/provider-probe.js";
import { clearProviderHealth, getAllProviderHealth } from "../routes/provider-health-cache.js";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const PROVIDERS_PATH = join(PROVIDERS_DIR, "providers.json");

let backup: string | null = null;
beforeEach(() => {
  try { backup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
  clearProviderHealth();
  vi.mocked(refreshModelRegistry).mockReset().mockResolvedValue(undefined);
  vi.mocked(probeProvider).mockClear();
  probeState.result = { ok: true, status: 200, modelCount: 7, sample: ["a"] };
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  clearProviderHealth();
});

function writeFixture(providers: Record<string, any>): void {
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  writeFileSync(PROVIDERS_PATH, `${JSON.stringify({ providers }, null, 2)}\n`);
}

async function buildApp() {
  const app = Fastify({ logger: false });
  const piGateway = { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any;
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard: async () => {}, piGateway, port: 8000 });
  await app.ready();
  return { app, piGateway };
}

const proxy = { baseUrl: "https://proxy.example.com/v1", apiKey: "sk-SECRET123", api: "openai-completions" };
const refresh = (app: any, name: string) =>
  app.inject({ method: "POST", url: `/api/providers/${encodeURIComponent(name)}/refresh` });

describe("POST /api/providers/:name/refresh", () => {
  it("re-probes and returns + caches the fresh health (E1)", async () => {
    writeFixture({ proxy });
    const { app } = await buildApp();
    const res = await refresh(app, "proxy");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.health).toMatchObject({ ok: true, modelCount: 7 });
    expect(getAllProviderHealth().proxy).toMatchObject({ ok: true, modelCount: 7 });
    expect(probeProvider).toHaveBeenCalledTimes(1);
  });

  it("404s an unknown provider without broadcasting or probing (E2)", async () => {
    writeFixture({ proxy });
    const { app, piGateway } = await buildApp();
    const res = await refresh(app, "missing");
    expect(res.statusCode).toBe(404);
    expect(piGateway.broadcast).not.toHaveBeenCalled();
    expect(probeProvider).not.toHaveBeenCalled();
  });

  it("refuses a corrupt providers.json with 409 like the write routes (E3)", async () => {
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, "{not json");
    const { app, piGateway } = await buildApp();
    const res = await refresh(app, "proxy");
    expect(res.statusCode).toBe(409);
    expect(res.json().success).toBe(false);
    expect(piGateway.broadcast).not.toHaveBeenCalled();
  });

  it("does not write providers.json (E4)", async () => {
    writeFixture({ proxy });
    const before = readFileSync(PROVIDERS_PATH, "utf-8");
    const mtime = statSync(PROVIDERS_PATH).mtimeMs;
    const { app } = await buildApp();
    await refresh(app, "proxy");
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    expect(statSync(PROVIDERS_PATH).mtimeMs).toBe(mtime);
  });

  it("broadcasts credentials_updated scoped to the provider (E5)", async () => {
    writeFixture({ proxy });
    const { app, piGateway } = await buildApp();
    await refresh(app, "proxy");
    expect(piGateway.broadcast).toHaveBeenCalledTimes(1);
    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated", refreshProviders: ["proxy"] });
    expect(refreshModelRegistry).toHaveBeenCalledTimes(1);
  });

  it("addresses a name containing '/' (E6)", async () => {
    writeFixture({ "a/b": proxy });
    const { app, piGateway } = await buildApp();
    const res = await refresh(app, "a/b");
    expect(res.statusCode).toBe(200);
    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated", refreshProviders: ["a/b"] });
  });

  it("an unreachable endpoint still answers 200 with failed health and notifies sessions (X1)", async () => {
    probeState.result = { ok: false, error: "ECONNREFUSED" };
    writeFixture({ proxy });
    const { app, piGateway } = await buildApp();
    const res = await refresh(app, "proxy");
    expect(res.statusCode).toBe(200);
    expect(res.json().health).toMatchObject({ ok: false, error: "ECONNREFUSED" });
    expect(piGateway.broadcast).toHaveBeenCalledTimes(1);
  });

  it("never returns the API key, even when the upstream error echoes it (X2)", async () => {
    probeState.result = { ok: false, status: 401, error: "invalid key sk-SECRET123 for org" };
    writeFixture({ proxy });
    const { app } = await buildApp();
    const res = await refresh(app, "proxy");
    expect(res.body).not.toContain("sk-SECRET123");
    expect(JSON.stringify(getAllProviderHealth())).not.toContain("sk-SECRET123");
  });

  it("does not wait for the server registry refresh (X5)", async () => {
    vi.mocked(refreshModelRegistry).mockImplementation(() => new Promise(() => {}));
    writeFixture({ proxy });
    const { app } = await buildApp();
    const res = await refresh(app, "proxy");
    expect(res.statusCode).toBe(200);
  });
});
