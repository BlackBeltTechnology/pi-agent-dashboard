/**
 * Tests for keeper-env.buildPiEnv — single-use spawn-token scrubbing on respawn.
 * See change: fix-spawn-token-env-leak.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildPiEnv } = require("../keeper-env.cjs") as {
  buildPiEnv: (base: NodeJS.ProcessEnv, isFirstLaunch: boolean) => NodeJS.ProcessEnv;
};

const BASE = {
  PATH: "/usr/bin",
  PI_DASHBOARD_SPAWN_TOKEN: "tok_abc",
  PI_KEEPER_PI_ARGS: '["--foo"]',
  PI_KEEPER_PI_CMD: '["/abs/pi"]',
};

describe("buildPiEnv", () => {
  it("first launch carries the token and PI_DASHBOARD_SPAWNED=1", () => {
    const env = buildPiEnv(BASE, true);
    expect(env.PI_DASHBOARD_SPAWN_TOKEN).toBe("tok_abc");
    expect(env.PI_DASHBOARD_SPAWNED).toBe("1");
  });

  it("respawn omits the token but keeps PI_DASHBOARD_SPAWNED=1", () => {
    const env = buildPiEnv(BASE, false);
    expect(env.PI_DASHBOARD_SPAWN_TOKEN).toBeUndefined();
    expect(env.PI_DASHBOARD_SPAWNED).toBe("1");
  });

  it("always strips keeper-internal PI_KEEPER_PI_ARGS / PI_KEEPER_PI_CMD", () => {
    for (const first of [true, false]) {
      const env = buildPiEnv(BASE, first);
      expect(env.PI_KEEPER_PI_ARGS).toBeUndefined();
      expect(env.PI_KEEPER_PI_CMD).toBeUndefined();
    }
  });

  it("does not mutate the source env object", () => {
    const base = { ...BASE };
    buildPiEnv(base, false);
    expect(base.PI_DASHBOARD_SPAWN_TOKEN).toBe("tok_abc");
    expect(base.PI_KEEPER_PI_ARGS).toBe('["--foo"]');
  });
});
