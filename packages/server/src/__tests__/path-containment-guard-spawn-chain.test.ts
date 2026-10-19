/**
 * The guard's spawn-scope helper through the REAL spawn chain: helper →
 * `pluginSpawnToSessionOptions` → `sessionFlagsToArgv` + `buildSpawnEnv`.
 * Pins that `-e <guard entry>` reaches argv and both guard env vars reach the
 * spawned env as JSON, even when the host env carries stale guard variables.
 * See change: add-path-containment-guard-extension (test-plan #E22, D5/D7).
 */
import { pluginSpawnToSessionOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { sessionFlagsToArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import { withPathContainmentGuard } from "@blackbelt-technology/pi-path-containment-guard";
import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

describe("withPathContainmentGuard → spawn chain (E22)", () => {
  it("argv carries `-e <guard entry>`; env carries both guard vars as JSON", () => {
    const scope = withPathContainmentGuard({ allowedRoots: ["/w/repo"], deniedTools: ["bash"] });
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w/repo", scope });
    const argv = sessionFlagsToArgv(mapped);
    const entry = scope.extensions[0];
    const at = argv.indexOf("-e");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(argv[at + 1]).toBe(entry);
    expect(entry).toMatch(/path-containment-guard[\\/]src[\\/]extension\.ts$/);

    const env = buildSpawnEnv(
      {
        PATH: "/usr/bin",
        PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS: '["/"]',
        PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS: '["stale"]',
      },
      { extensionConfig: mapped.extensionConfig, mechanism: "headless" },
    );
    expect(JSON.parse(env.PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS as string)).toEqual(["/w/repo"]);
    expect(JSON.parse(env.PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS as string)).toEqual(["bash"]);
  });

  it("omitting deniedTools leaves no inherited DENIED_TOOLS behind", () => {
    const scope = withPathContainmentGuard({ allowedRoots: ["/w/repo"] });
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w/repo", scope });
    const env = buildSpawnEnv(
      { PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS: '["stale"]' },
      { extensionConfig: mapped.extensionConfig, mechanism: "headless" },
    );
    expect(env.PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS).toBeUndefined();
    expect(env.PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS).toBeDefined();
  });
});
