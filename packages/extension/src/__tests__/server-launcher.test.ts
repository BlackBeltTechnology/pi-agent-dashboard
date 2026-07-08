import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpawnArgs, buildSpawnEnv, resolveServerCliPath } from "../server-launcher.js";

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

  describe("buildSpawnEnv", () => {
    it("always includes DASHBOARD_STARTER=Bridge", () => {
      const env = buildSpawnEnv({});
      expect(env["DASHBOARD_STARTER"]).toBe("Bridge");
    });

    it("overrides any existing DASHBOARD_STARTER in baseEnv", () => {
      const env = buildSpawnEnv({ DASHBOARD_STARTER: "Standalone" });
      expect(env["DASHBOARD_STARTER"]).toBe("Bridge");
    });

    it("preserves other env vars from baseEnv", () => {
      const env = buildSpawnEnv({ MY_VAR: "hello" });
      expect(env["MY_VAR"]).toBe("hello");
      expect(env["DASHBOARD_STARTER"]).toBe("Bridge");
    });

    it("filters out undefined values from baseEnv", () => {
      const env = buildSpawnEnv({ DEFINED: "yes", UNDEF: undefined });
      expect(Object.keys(env)).not.toContain("UNDEF");
    });

    it("adds --max-old-space-size to NODE_OPTIONS by default", () => {
      const env = buildSpawnEnv({});
      expect(env["NODE_OPTIONS"]).toContain("--max-old-space-size=8192");
    });

    it("appends the flag to an existing NODE_OPTIONS without a heap limit", () => {
      const env = buildSpawnEnv({ NODE_OPTIONS: "--enable-source-maps" });
      expect(env["NODE_OPTIONS"]).toBe(
        "--enable-source-maps --max-old-space-size=8192",
      );
    });

    it("never overrides a user-supplied --max-old-space-size", () => {
      const env = buildSpawnEnv({ NODE_OPTIONS: "--max-old-space-size=2048" });
      expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=2048");
    });
  });
});
