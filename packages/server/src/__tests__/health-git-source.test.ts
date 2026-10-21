/**
 * `/api/health.gitSource` — Windows git/bash readout shape and the spawn env it
 * is computed over; absent/null on macOS/Linux.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E17, #E18).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const readoutSpy = vi.fn();
let stubbed: unknown = null;

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git-source.js")>();
  return {
    ...actual,
    getGitSourceReadout: (...args: unknown[]) => {
      readoutSpy(...args);
      return stubbed === "real" ? (actual.getGitSourceReadout as (...a: unknown[]) => unknown)(...args) : stubbed;
    },
  };
});

const { registerSystemRoutes } = await import("../routes/system-routes.js");

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  readoutSpy.mockClear();
});

async function health(): Promise<Record<string, unknown>> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => {} },
    metaPersistence: { flushAll: () => {} },
    config: { port: 8000, piPort: 9999, dev: false },
    networkGuard: async () => {},
    version: "test",
    clientDir: null,
  } as never);
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("/api/health gitSource", () => {
  it("E17: win32 readout → exactly the seven documented keys, computed over a spawn env", async () => {
    stubbed = {
      setting: "auto",
      source: "bundled",
      gitPath: "C:\\res\\git\\cmd\\git.exe",
      gitVersion: "git version 2.53.0.windows.4",
      shellPath: "C:\\res\\git\\usr\\bin\\bash.exe",
      bashSetting: "bundled",
      shellIsWslLauncher: false,
    };
    const body = await health();
    expect(Object.keys(body.gitSource as object).sort()).toEqual(
      ["bashSetting", "gitPath", "gitVersion", "setting", "shellIsWslLauncher", "shellPath", "source"],
    );
    const opts = readoutSpy.mock.calls[0]![1] as { spawnEnv: () => NodeJS.ProcessEnv };
    const env = opts.spawnEnv();
    expect(typeof env.PATH).toBe("string");
  });

  it("E18: non-win32 → gitSource absent or null", async () => {
    if (process.platform === "win32") return;
    stubbed = "real";
    const body = await health();
    expect(body.gitSource ?? null).toBeNull();
  });
});
