/**
 * Spawn-env contributor host hook + context-mode bridge-internal scrub.
 * Folds test-plan E10–E16, E13, X6 of add-context-mode-settings-plugin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpawnEnv, buildTmuxCommand } from "../spawn-process/process-manager.js";
import {
  _resetSpawnEnvContributorsForTests,
  registerSpawnEnvContributor,
  registerSpawnEnvContributorForPlugin,
  setSpawnEnvPluginEnabledCheck,
} from "../spawn-process/spawn-env-contributors.js";

const RUNTIME_NAMES = ["CTX_FETCH_STRICT", "CONTEXT_MODE_TZ", "CONTEXT_MODE_SEARCH_WINDOW_MS"] as const;

beforeEach(() => {
  _resetSpawnEnvContributorsForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  _resetSpawnEnvContributorsForTests();
  vi.restoreAllMocks();
});

describe("bridge-internal scrub (E15)", () => {
  it("removes DEPTH/IDLE_MS but keeps other context-mode vars", () => {
    const env = buildSpawnEnv(
      { CONTEXT_MODE_BRIDGE_DEPTH: "1", CONTEXT_MODE_BRIDGE_IDLE_MS: "0", CONTEXT_MODE_TZ: "UTC", PATH: "/usr/bin" },
      { mechanism: "headless" },
    );
    expect(env.CONTEXT_MODE_BRIDGE_DEPTH).toBeUndefined();
    expect("CONTEXT_MODE_BRIDGE_IDLE_MS" in env).toBe(false);
    expect(env.CONTEXT_MODE_TZ).toBe("UTC");
  });
});

describe("buildTmuxCommand (E16)", () => {
  for (const exists of [true, false]) {
    it(`pane command true-unsets bridge vars and passes contributions via -e (exists=${exists})`, () => {
      const cmd = buildTmuxCommand("/p", exists, undefined, ["pi"], "", undefined, { CTX_FETCH_STRICT: "1" });
      const pane = cmd[cmd.length - 1];
      expect(pane.startsWith("env -u CONTEXT_MODE_BRIDGE_DEPTH -u CONTEXT_MODE_BRIDGE_IDLE_MS pi")).toBe(true);
      expect(cmd.join(" ")).not.toMatch(/-e CONTEXT_MODE_BRIDGE_/);
      const i = cmd.indexOf("CTX_FETCH_STRICT=1");
      expect(i).toBeGreaterThan(0);
      expect(cmd[i - 1]).toBe("-e");
    });
  }
});

describe("contributors", () => {
  it("E10: rejects reserved/invalid names, applies the valid one, never touches base", () => {
    const baseEnv = { NODE_OPTIONS: "--max-old-space-size=1", PATH: "/usr/bin", PI_DASHBOARD_URL: "ws://base" };
    const expectedPath = buildSpawnEnv(baseEnv, { mechanism: "headless" }).PATH;
    registerSpawnEnvContributor("p", () => ({
      NODE_OPTIONS: "--inspect",
      CONTEXT_MODE_BRIDGE_DEPTH: "1",
      LD_PRELOAD: "x",
      DYLD_INSERT_LIBRARIES: "x",
      PATH: "/x",
      PI_DASHBOARD_URL: "x",
      "bad-name": "1",
      OK_VAR: "a\u0000b",
      CTX_FETCH_STRICT: "1",
    }));
    const env = buildSpawnEnv(baseEnv, { mechanism: "headless" });
    expect(env.CTX_FETCH_STRICT).toBe("1");
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=1");
    expect(env.PI_DASHBOARD_URL).toBe("ws://base");
    expect(env.PATH).toBe(expectedPath); // contributor PATH ignored
    expect(env.CONTEXT_MODE_BRIDGE_DEPTH).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.OK_VAR).toBeUndefined();
    expect(env["bad-name"]).toBeUndefined();
  });

  it("E11: does not override an inherited variable", () => {
    registerSpawnEnvContributor("p", () => ({ CONTEXT_MODE_TZ: "Europe/Budapest" }));
    const env = buildSpawnEnv({ CONTEXT_MODE_TZ: "UTC" }, { mechanism: "tmux" });
    expect(env.CONTEXT_MODE_TZ).toBe("UTC");
  });

  it("E12: supersede removes only listed+allowed names and the marker", () => {
    registerSpawnEnvContributor("p", () => ({}), {
      supersede: { marker: "PI_CONTEXT_MODE_SETTINGS_PROJECTED", names: RUNTIME_NAMES },
    });
    const env = buildSpawnEnv(
      { CTX_FETCH_STRICT: "1", PI_CONTEXT_MODE_SETTINGS_PROJECTED: "CTX_FETCH_STRICT,PATH", PATH: "/usr/bin" },
      { mechanism: "headless" },
    );
    expect(env.CTX_FETCH_STRICT).toBeUndefined();
    expect(env.PATH).toContain("/usr/bin");
    expect(env.PI_CONTEXT_MODE_SETTINGS_PROJECTED).toBeUndefined();
  });

  it("E13: only enabled plugins with priority <= 100 contribute (server gate + enabled filter)", () => {
    // Drives the exact function server.ts wires into the plugin context.
    const matrix: Array<[number | undefined, boolean, boolean]> = [
      [50, true, true],
      [100, true, true],
      [101, true, false],
      [undefined, true, false],
      [50, false, false],
      [100, false, false],
    ];
    for (const [priority, enabled, expected] of matrix) {
      _resetSpawnEnvContributorsForTests();
      setSpawnEnvPluginEnabledCheck(() => enabled);
      registerSpawnEnvContributorForPlugin({ id: "p", priority }, () => ({ X_FLAG: "1" }));
      const env = buildSpawnEnv({}, { mechanism: "headless" });
      expect(env.X_FLAG === "1").toBe(expected);
    }
  });

  it("untrusted plugin: the returned unregister is a callable no-op and nothing is registered", () => {
    const off = registerSpawnEnvContributorForPlugin({ id: "u", priority: 101 }, () => ({ X_FLAG: "1" }));
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
    expect(buildSpawnEnv({}, { mechanism: "headless" }).X_FLAG).toBeUndefined();
  });

  it("a disabled plugin's inherited projection is still removed (no stale leak), operator exports kept", () => {
    setSpawnEnvPluginEnabledCheck(() => false);
    registerSpawnEnvContributor("p", () => ({ CTX_FETCH_STRICT: "1" }), {
      supersede: { marker: "PI_CONTEXT_MODE_SETTINGS_PROJECTED", names: RUNTIME_NAMES },
    });
    const env = buildSpawnEnv(
      { CTX_FETCH_STRICT: "1", CONTEXT_MODE_TZ: "UTC", PI_CONTEXT_MODE_SETTINGS_PROJECTED: "CTX_FETCH_STRICT" },
      { mechanism: "headless" },
    );
    expect(env.CTX_FETCH_STRICT).toBeUndefined();
    expect(env.PI_CONTEXT_MODE_SETTINGS_PROJECTED).toBeUndefined();
    expect(env.CONTEXT_MODE_TZ).toBe("UTC");
  });

  it("applies per mechanism + reports applied entries via contributedOut", () => {
    registerSpawnEnvContributor("p", ({ mechanism }): Record<string, string> => (mechanism === "wsl-tmux" ? {} : { CTX_FETCH_STRICT: "1" }));
    for (const m of ["headless", "tmux", "wt"] as const) {
      const out: Record<string, string> = {};
      expect(buildSpawnEnv({}, { mechanism: m, contributedOut: out }).CTX_FETCH_STRICT).toBe("1");
      expect(out).toEqual({ CTX_FETCH_STRICT: "1" });
    }
    expect(buildSpawnEnv({}, { mechanism: "wsl-tmux" }).CTX_FETCH_STRICT).toBeUndefined();
  });

  it("legacy callers without a mechanism get no contributions", () => {
    registerSpawnEnvContributor("p", () => ({ X_FLAG: "1" }));
    expect(buildSpawnEnv({}).X_FLAG).toBeUndefined();
  });

  it("X6: throwing / null / non-string contributors are skipped with one warning each", () => {
    registerSpawnEnvContributor("t", () => {
      throw new Error("boom");
    });
    registerSpawnEnvContributor("n", () => null as never);
    registerSpawnEnvContributor("v", () => ({ A: 1 }) as never);
    const env = buildSpawnEnv({ KEEP: "1" }, { mechanism: "headless" });
    expect(env.KEEP).toBe("1");
    expect(env.A).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it("unregister removes the contributor", () => {
    const off = registerSpawnEnvContributor("p", () => ({ X_FLAG: "1" }));
    off();
    expect(buildSpawnEnv({}, { mechanism: "headless" }).X_FLAG).toBeUndefined();
  });
});
