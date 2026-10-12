/**
 * `/api/restart` always hands the restart orchestrator the native TypeScript
 * loader, whatever `--import` this process booted under (jiti inherited across
 * an upgrade, tsx, an unknown loader, or none). Port, piPort and extraArgs are
 * unchanged.
 *
 * See change: strip-only-native-ts-loader (design D5; test-plan #E17).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnRestart = vi.hoisted(() => vi.fn());
vi.mock("../spawn-process/restart-helper.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../spawn-process/restart-helper.js")>()),
  spawnRestart,
}));

import { registerSystemRoutes } from "../routes/system-routes.js";

const NATIVE_RE = /^file:\/\/.*\/platform\/native-ts-register\.mjs$/;

describe("POST /api/restart normalizes the loader to native (#E17)", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalExecArgv = process.execArgv;
  const originalArgv1 = process.argv[1];

  beforeEach(() => {
    spawnRestart.mockReset();
    fastify = Fastify();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined as never) as never);
    registerSystemRoutes(fastify, {
      sessionManager: {} as never,
      preferencesStore: { flush: () => {} } as never,
      metaPersistence: { flushAll: () => {} } as never,
      config: { port: 8123, piPort: 9876, dev: false } as never,
      networkGuard: (async () => {}) as never,
      piGateway: { broadcast() {}, close() {} } as never,
    });
    process.argv[1] = "/srv/pi-dashboard/src/cli.ts";
  });

  afterEach(async () => {
    Object.defineProperty(process, "execArgv", { value: originalExecArgv, configurable: true });
    process.argv[1] = originalArgv1 as string;
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
  });

  it.each([
    ["a jiti --import", ["--import", "file:///x/node_modules/jiti/lib/jiti-register.mjs"]],
    ["the native --import", ["--import", "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs"]],
    ["an unknown loader", ["--import", "file:///x/some/other-loader.mjs"]],
    ["no --import", []],
  ])("restarts with the native loader when booted with %s", async (_label, execArgv) => {
    Object.defineProperty(process, "execArgv", { value: execArgv, configurable: true });
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(spawnRestart).toHaveBeenCalledTimes(1);
    const params = spawnRestart.mock.calls[0]![0] as { loader: string; port: number; piPort: number; extraArgs: string[]; cliPath: string };
    expect(params.loader).toMatch(NATIVE_RE);
    expect(params.port).toBe(8123);
    expect(params.piPort).toBe(9876);
    expect(params.extraArgs).toEqual([]);
    expect(params.cliPath).toBe("/srv/pi-dashboard/src/cli.ts");
  });
});
