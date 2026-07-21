/**
 * Env-builder parity: `process-manager.buildSpawnEnv` (server) must agree
 * with `runner.buildSpawnEnvForArgv` (shared) for a node-wrapped
 * `argv[0] = <Electron binary>` in the triply-degraded `execpath-fallback`
 * topology — both SHALL set `ELECTRON_RUN_AS_NODE=1`.
 *
 * Pre-fix: the shared runner re-adds the flag (argv-aware) while the server
 * builder strips it and has no argv to re-derive it from → builders diverge
 * → this test fails. Post-fix: both set the flag.
 *
 * See change: fix-nodescript-argv-electron-execpath-fallback.
 */

import { buildSpawnEnvForArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

const ELECTRON = "/Apps/Pi.app/Contents/MacOS/Pi";
const REAL_NODE = "/opt/node/bin/node";
const ELECTRON_DEPS = { execPath: ELECTRON, electronVersion: "30.0.0" };

describe("spawn-env electron-as-node parity", () => {
  it("both builders set ELECTRON_RUN_AS_NODE=1 for an Electron-binary argv[0]", () => {
    // Node-wrapped argv[0] = the Electron GUI binary (execpath-fallback).
    const runnerEnv = buildSpawnEnvForArgv(ELECTRON, undefined, ELECTRON_DEPS);
    const pmEnv = buildSpawnEnv(process.env, { argv0: ELECTRON, electronDeps: ELECTRON_DEPS });

    expect(runnerEnv?.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(pmEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("healthy path: real node argv[0] ⇒ neither builder adds the flag", () => {
    const runnerEnv = buildSpawnEnvForArgv(REAL_NODE, undefined, ELECTRON_DEPS);
    const pmEnv = buildSpawnEnv(process.env, { argv0: REAL_NODE, electronDeps: ELECTRON_DEPS });

    // runner inherits process.env (undefined) when not electron-as-node.
    expect(runnerEnv?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(pmEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("absent argv0 ⇒ buildSpawnEnv byte-identical to today (no flag added)", () => {
    const withArgv = buildSpawnEnv(process.env, { argv0: undefined });
    const without = buildSpawnEnv(process.env);
    expect(withArgv.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(without.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
