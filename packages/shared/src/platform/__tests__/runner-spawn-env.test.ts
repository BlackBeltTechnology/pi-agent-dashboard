/**
 * `buildSpawnEnvForArgv` — Electron `execpath-fallback` safety net.
 *
 * When a Node-script executor node-wraps to `process.execPath` and the
 * server runs under Electron, that interpreter is the Electron binary and
 * only behaves as `node` with `ELECTRON_RUN_AS_NODE=1`. This is the one
 * branch not covered by the argv-matrix / spawn-proof suites (which
 * resolve a real node). See change: fix-openspec-config-read-bundled-node.
 */
import { describe, expect, it } from "vitest";
import { buildSpawnEnvForArgv } from "../runner.js";

const ELECTRON = "/Apps/Pi.app/Contents/MacOS/Pi";
const REAL_NODE = "/opt/node/bin/node";

describe("buildSpawnEnvForArgv", () => {
  it("returns undefined (inherit process.env) when no ctxEnv and not electron-as-node", () => {
    const env = buildSpawnEnvForArgv(REAL_NODE, undefined, {
      execPath: ELECTRON,
      electronVersion: "30.0.0",
    });
    expect(env).toBeUndefined();
  });

  it("sets ELECTRON_RUN_AS_NODE=1 when wrapped to the Electron execPath under Electron", () => {
    const env = buildSpawnEnvForArgv(ELECTRON, undefined, {
      execPath: ELECTRON,
      electronVersion: "30.0.0",
    });
    expect(env?.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("does NOT set the flag when a real node was resolved (execCmd !== execPath)", () => {
    const env = buildSpawnEnvForArgv(REAL_NODE, { FOO: "bar" }, {
      execPath: ELECTRON,
      electronVersion: "30.0.0",
    });
    expect(env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env?.FOO).toBe("bar");
  });

  it("does NOT set the flag when not running under Electron even if execCmd === execPath", () => {
    const env = buildSpawnEnvForArgv(REAL_NODE, undefined, {
      execPath: REAL_NODE,
      electronVersion: undefined,
    });
    // Plain node server: no ctxEnv, not electron → inherit (undefined).
    expect(env).toBeUndefined();
  });

  it("merges ctxEnv over process.env and still forces the flag under Electron", () => {
    const env = buildSpawnEnvForArgv(ELECTRON, { CUSTOM: "x" }, {
      execPath: ELECTRON,
      electronVersion: "30.0.0",
    });
    expect(env?.CUSTOM).toBe("x");
    expect(env?.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

describe("buildSpawnEnvForArgv PATH key casing (#720)", () => {
  const pathKeys = (env: NodeJS.ProcessEnv | undefined) =>
    Object.keys(env ?? {}).filter((k) => k.toUpperCase() === "PATH");

  it("E15: a caller Path in any casing replaces the inherited PATH on win32", () => {
    const env = buildSpawnEnvForArgv("node", { Path: "C:\\caller" }, { platform: "win32" });
    expect(pathKeys(env)).toEqual(["PATH"]);
    expect(env?.PATH).toBe("C:\\caller");
  });

  it("E16: an empty caller Path clears PATH on win32", () => {
    const env = buildSpawnEnvForArgv("node", { Path: "" }, { platform: "win32" });
    expect(pathKeys(env)).toEqual(["PATH"]);
    expect(env?.PATH).toBe("");
  });

  it("E17: no ctxEnv and non-Electron exec still returns undefined", () => {
    expect(buildSpawnEnvForArgv("node", undefined, {})).toBeUndefined();
  });
});
