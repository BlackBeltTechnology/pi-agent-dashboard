import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEAP_FLAG_MARKER_ENV } from "@blackbelt-technology/pi-dashboard-shared/heap-flags.js";
import {
  buildSpawnArgs,
  buildBridgeEnvOverrides,
  DEFAULT_SERVER_MAX_OLD_SPACE_MB,
  resolveServerCliPath,
} from "../server-launcher.js";

describe("server-launcher", () => {
  describe("resolveServerCliPath", () => {
    it("should return an absolute path", () => {
      expect(path.isAbsolute(resolveServerCliPath())).toBe(true);
    });

    it("should point to packages/server/src/cli.ts", () => {
      const cliPath = resolveServerCliPath();
      expect(cliPath).toContain(path.join("packages", "server", "src", "cli.ts"));
    });

    it("should point to a file that actually exists on disk", () => {
      expect(existsSync(resolveServerCliPath())).toBe(true);
    });

    it("uses require.resolve so it adapts to installed layout", () => {
      // Regression: the monorepo-relative path math
      // (`<extension>/../../server/src/cli.ts`) produced
      // `<scope>/server/src/cli.ts` instead of
      // `<scope>/pi-dashboard-server/src/cli.ts` when the extension
      // was installed into `node_modules/@blackbelt-technology/`. The
      // resolver must locate the server via package name, not sibling
      // path arithmetic.
      const cliPath = resolveServerCliPath();
      // Either layout is fine; we just must NOT produce the broken
      // `@blackbelt-technology/server/src/cli.ts` shape.
      expect(cliPath).not.toMatch(/@blackbelt-technology[\\/]+server[\\/]+src[\\/]+cli\.ts$/);
      // And must land on pi-dashboard-server (installed) or packages/server (dev).
      expect(cliPath).toMatch(/(pi-dashboard-server|packages[\\/]+server)[\\/]+src[\\/]+cli\.ts$/);
    });
  });

  describe("buildSpawnArgs", () => {
    it("should include port and pi-port flags", () => {
      const args = buildSpawnArgs({
        port: 3000,
        piPort: 4000,
        autoStart: true,
        autoShutdown: true,
        shutdownIdleSeconds: 300,
        spawnStrategy: "tmux",
        tunnel: { enabled: true },
        devBuildOnReload: false,
        memoryLimits: { maxEventsPerSession: 5000, maxStringFieldSize: 0, maxWsBufferBytes: 4194304 },
        editor: { idleTimeoutMinutes: 10, maxInstances: 3 },
        defaultModel: "",
        trustedNetworks: [],
        resolvedTrustedNetworks: [],
        cors: { allowedOrigins: [] },
        electronMode: false,
      } as any);

      expect(args).toEqual(["--port", "3000", "--pi-port", "4000"]);
    });
  });

  // Narrow overrides only — the shared launcher's buildSpawnEnv owns the
  // base env (PATH prepends, win32 key normalization). A full process.env
  // copy here overlaid the raw PATH and dropped those prepends.
  // See change: fix-windows-path-env-key-casing.
  describe("buildBridgeEnvOverrides", () => {
    it("always includes DASHBOARD_STARTER=Bridge", () => {
      const env = buildBridgeEnvOverrides({});
      expect(env["DASHBOARD_STARTER"]).toBe("Bridge");
    });

    it("overrides any existing DASHBOARD_STARTER in baseEnv", () => {
      const env = buildBridgeEnvOverrides({ DASHBOARD_STARTER: "Standalone" });
      expect(env["DASHBOARD_STARTER"]).toBe("Bridge");
    });

    it("E19: returns only narrow overrides, never PATH/HOME", () => {
      const env = buildBridgeEnvOverrides(
        { PATH: "/usr/bin", HOME: "/h", NODE_OPTIONS: "--enable-source-maps", PI_DASHBOARD_ELECTRON: "1" },
        2048,
      );
      // Exact key set: undefined-valued markers are PRESENT so the shared
      // launcher's overlay deletes them; PATH/HOME are absent.
      expect(Object.keys(env).sort()).toEqual(
        ["DASHBOARD_STARTER", "NODE_OPTIONS", HEAP_FLAG_MARKER_ENV, "PI_DASHBOARD_ELECTRON", "PI_DASHBOARD_RESOURCES_PATH"].sort(),
      );
      expect(env).toEqual({
        DASHBOARD_STARTER: "Bridge",
        NODE_OPTIONS: "--enable-source-maps --max-old-space-size=2048",
        [HEAP_FLAG_MARKER_ENV]: "--max-old-space-size=2048",
        PI_DASHBOARD_ELECTRON: undefined,
        PI_DASHBOARD_RESOURCES_PATH: undefined,
      });
      expect("PATH" in env).toBe(false);
      expect("HOME" in env).toBe(false);
    });

    it("E20: respects an operator pin and deletes the marker", () => {
      const env = buildBridgeEnvOverrides({ NODE_OPTIONS: "--max-old-space-size=4096" }, 2048);
      expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=4096");
      expect(env["NODE_OPTIONS"]).not.toContain("2048");
      expect(Object.keys(env)).toContain(HEAP_FLAG_MARKER_ENV);
      expect(env[HEAP_FLAG_MARKER_ENV]).toBe(undefined);
    });

    // The three heap assertions below asserted the literal 8192. The ceiling is
    // now config-derived with a 1536 default, so they move with the constant
    // rather than pinning a number that no longer describes the behavior.
    // See change: bound-session-heap-and-gc-telemetry (task 4.5).
    it("stamps the default --max-old-space-size into NODE_OPTIONS", () => {
      const env = buildBridgeEnvOverrides({});
      expect(DEFAULT_SERVER_MAX_OLD_SPACE_MB).toBe(1536);
      expect(env["NODE_OPTIONS"]).toContain(
        `--max-old-space-size=${DEFAULT_SERVER_MAX_OLD_SPACE_MB}`,
      );
    });

    it("stamps the CONFIGURED ceiling when one is passed", () => {
      const env = buildBridgeEnvOverrides({}, 4096);
      expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=4096");
    });

    it("appends the flag to an existing NODE_OPTIONS without a heap limit", () => {
      const env = buildBridgeEnvOverrides({ NODE_OPTIONS: "--enable-source-maps" });
      expect(env["NODE_OPTIONS"]).toBe(
        `--enable-source-maps --max-old-space-size=${DEFAULT_SERVER_MAX_OLD_SPACE_MB}`,
      );
    });

    it("never overrides a user-supplied --max-old-space-size", () => {
      const env = buildBridgeEnvOverrides({ NODE_OPTIONS: "--max-old-space-size=2048" });
      expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=2048");
      // No provenance marker is left behind: the token is theirs, and a marker
      // naming it would let the spawn-side strip eat their pin.
      expect(env[HEAP_FLAG_MARKER_ENV]).toBeUndefined();
    });

    it("records the exact token it stamped in the provenance marker", () => {
      const env = buildBridgeEnvOverrides({}, 2048);
      expect(env[HEAP_FLAG_MARKER_ENV]).toBe("--max-old-space-size=2048");
    });

    it("re-stamps its OWN previous token rather than freezing it as a pin", () => {
      // The restart path inherits `env: process.env`, so the previous launch's
      // flag AND marker are both present. Without the marker comparison the
      // dashboard's own stamp would read as operator intent and the ceiling
      // could never change.
      const env = buildBridgeEnvOverrides(
        {
          NODE_OPTIONS: "--enable-source-maps --max-old-space-size=1536",
          [HEAP_FLAG_MARKER_ENV]: "--max-old-space-size=1536",
        },
        4096,
      );
      expect(env["NODE_OPTIONS"]).toBe("--enable-source-maps --max-old-space-size=4096");
      expect(env[HEAP_FLAG_MARKER_ENV]).toBe("--max-old-space-size=4096");
    });
  });
});
