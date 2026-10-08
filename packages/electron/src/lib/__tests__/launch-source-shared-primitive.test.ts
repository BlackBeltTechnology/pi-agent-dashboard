/**
 * Electron launches the server through the shared `launchDashboardServer`
 * primitive with the resolved LaunchSource's `cliPath` — it never resolves or
 * spawns a tsx binary itself (test-plan #E14).
 *
 * See change: cleanup-stale-fork-specs.
 */
import { describe, expect, it, vi } from "vitest";

const { launchDashboardServer } = vi.hoisted(() => ({
  launchDashboardServer: vi.fn(async () => ({ childPid: 4242 })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>()),
  launchDashboardServer,
}));

import { spawnFromSource } from "../launch-source.js";

describe("spawnFromSource → shared launch primitive (E14)", () => {
  it("calls launchDashboardServer with source.cliPath and no tsx binary", async () => {
    const source = { kind: "bundled" as const, cliPath: "/r/server/src/cli.ts", cwd: "/r/server" };
    const result = await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: "/tmp/e14-server.log" });

    expect(result).toEqual({ pid: 4242 });
    expect(launchDashboardServer).toHaveBeenCalledTimes(1);
    const arg = (launchDashboardServer.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg.cliPath).toBe(source.cliPath);
    expect(arg.starter).toBe("Electron");
    // The launch spec carries no tsx binary / tsx-shaped command anywhere.
    const nonEnv = { ...arg, env: undefined };
    expect(JSON.stringify(nonEnv)).not.toMatch(/\btsx\b/);
    expect(arg).not.toHaveProperty("cmd");
  });
});

/**
 * E21 — the Electron spawn carries the SELECTED loader: the real shared
 * launcher (seams injected through the mocked entry point) builds the argv.
 * argv = [nodeBin, "--import", <loader>, <entry>, ...]; argv[2] is the native
 * register by default and the jiti URL under PI_DASHBOARD_TS_LOADER=jiti.
 * See change: fix-appimage-cold-boot-latency (design D4).
 */
describe("spawnFromSource carries the selected TS loader (E21)", () => {
  const JITI = "file:///j/node_modules/jiti/lib/jiti-register.mjs";

  async function captureArgv(): Promise<{ argv: string[]; launchNodeBin: unknown }> {
    const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>(
      "@blackbelt-technology/pi-dashboard-shared/server-launcher.js",
    );
    const { buildNodeImportArgvParts } = await import("@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js");
    const { EventEmitter } = await import("node:events");
    let argv: string[] = [];
    let launchNodeBin: unknown;
    launchDashboardServer.mockImplementationOnce((async (opts: Parameters<typeof actual.launchDashboardServer>[0]) => {
      launchNodeBin = opts.nodeBin;
      return actual.launchDashboardServer({
        ...opts,
        _resolveJiti: () => JITI,
        _spawnNodeScript: ((o: { nodeBin: string; loader: string; entry: string; args?: string[] }) => {
          argv = [o.nodeBin, ...buildNodeImportArgvParts({ loader: o.loader, entry: o.entry, args: o.args })];
          return Object.assign(new EventEmitter(), { pid: 77, exitCode: null, signalCode: null, unref: () => {} });
        }) as never,
        _isDashboardRunning: (async () => ({ running: true, pid: 77 })) as never,
        _fs: { mkdirSync: () => undefined, openSync: () => 9, writeSync: () => 0, closeSync: () => undefined } as never,
        _sleep: () => Promise.resolve(),
      });
    }) as never);
    const source = { kind: "bundled" as const, cliPath: "/r/server/src/cli.ts", cwd: "/r/server" };
    await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: "/tmp/e21-server.log" });
    return { argv, launchNodeBin };
  }

  it("env unset → argv[2] is the native register; nodeBin is the picked node", async () => {
    vi.stubEnv("PI_DASHBOARD_TS_LOADER", undefined as unknown as string);
    try {
      const { argv, launchNodeBin } = await captureArgv();
      expect(argv[1]).toBe("--import");
      expect(argv[2]).toMatch(/^file:\/\/.*\/platform\/native-ts-register\.mjs$/);
      expect(argv[0]).toBe(launchNodeBin);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("PI_DASHBOARD_TS_LOADER=jiti → argv[2] is the jiti URL; nodeBin unchanged", async () => {
    vi.stubEnv("PI_DASHBOARD_TS_LOADER", "jiti");
    try {
      const { argv, launchNodeBin } = await captureArgv();
      expect(argv[2]).toBe(JITI);
      expect(argv[0]).toBe(launchNodeBin);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
