/**
 * Pi-session spawn env/argv from the ladder-resolved runtime.
 *
 * Covers change unify-pi-runtime-identity tasks 3.1 (buildSpawnEnv
 * `spawnRuntime` opt) + 3.2 (explicit-argv re-point) and folded tasks
 * 9.13/9.23 — test-plan E13 (env + argv halves) and X5 (vanished runtime).
 * Spec managed-node-runtime scenarios: "Pi session inherits the resolved
 * runtime", "Explicit-argv spawns use the resolved binary", "Process
 * environment is not globally mutated", "pi-core-updater inherits managed
 * Node" (legacy branch preserved), "Spawn-time re-validation".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedRuntime } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvedSharedTreeFamilyArgv } from "../package/package-manager-wrapper.js";
import { setCurrentSpawnRuntime } from "../runtime-resolution.js";
import {
  applySpawnRuntimeToPiArgv,
  buildSpawnEnv,
  spawnRuntimeForSession,
} from "../spawn-process/process-manager.js";

const isWin = process.platform === "win32";

let tmpHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-spawn-runtime-"));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  // os.homedir() reads USERPROFILE on Win, HOME on POSIX.
  if (isWin) process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Managed Node bin dir under the tmp HOME (`<home>/.pi-dashboard/node[\/bin]`). */
function installFakeManagedNode(): string {
  const binDir = isWin
    ? path.join(tmpHome, ".pi-dashboard", "node")
    : path.join(tmpHome, ".pi-dashboard", "node", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, isWin ? "node.exe" : "node"), "fake");
  return binDir;
}

/** Minimal ResolvedRuntime fixture for a bin dir under tmp. */
function fakeRuntimeAt(binDir: string): ResolvedRuntime {
  return {
    nodeBinary: path.join(binDir, isWin ? "node.exe" : "node"),
    nodeBinDir: binDir,
    version: "v25.0.0",
    abi: 141,
    source: "system",
    rung: "user",
    arm: "npm",
    piFloor: "22.19.0",
    piFloorSource: "fallback",
    identity: null,
    trail: [],
    resolvedAt: new Date().toISOString(),
  };
}

describe("buildSpawnEnv with spawnRuntime (test-plan E13 env half, task 3.1)", () => {
  it("resolved bin dir is the FIRST PATH entry; managed dir NOT ahead of it", () => {
    const managedDir = installFakeManagedNode();
    const rt = fakeRuntimeAt(path.join(tmpHome, "nvm", "v25.8.1", "bin"));

    // Managed dir starts mid-PATH — the resolved prepend must not move it ahead.
    const env = buildSpawnEnv(
      { PATH: `/usr/bin${path.delimiter}${managedDir}${path.delimiter}/bin` },
      { spawnRuntime: rt },
    );

    const parts = (env.PATH ?? "").split(path.delimiter);
    expect(parts[0]).toBe(rt.nodeBinDir);
    // "the managed Node directory SHALL NOT appear ahead of it".
    const managedIdx = parts.indexOf(managedDir);
    if (managedIdx !== -1) {
      expect(managedIdx).toBeGreaterThan(parts.indexOf(rt.nodeBinDir));
    }
    // No duplicate of the resolved dir either.
    expect(parts.filter((p) => p === rt.nodeBinDir)).toHaveLength(1);
  });

  it("managed Node present on disk is NOT prepended when spawnRuntime is passed", () => {
    const managedDir = installFakeManagedNode();
    const rt = fakeRuntimeAt(path.join(tmpHome, "other", "bin"));

    const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" }, { spawnRuntime: rt });

    const parts = (env.PATH ?? "").split(path.delimiter);
    expect(parts[0]).toBe(rt.nodeBinDir);
    expect(parts).not.toContain(managedDir);
  });

  it("process.env is not mutated (deep-compare before/after)", () => {
    const rt = fakeRuntimeAt(path.join(tmpHome, "user", "bin"));
    const snapshot = { ...process.env };

    buildSpawnEnv(process.env, { spawnRuntime: rt });

    expect({ ...process.env }).toEqual(snapshot);
  });

  it("WITHOUT spawnRuntime: legacy managed prepend preserved (pi-core-updater path)", () => {
    const managedDir = installFakeManagedNode();

    const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" });

    expect((env.PATH ?? "").split(path.delimiter)[0]).toBe(managedDir);
  });

  it("launcher-stamped Electron markers do not leak to spawned children (CodeRabbit round 2)", () => {
    const rt = fakeRuntimeAt(path.join(tmpHome, "user", "bin"));
    const prevE = process.env.PI_DASHBOARD_ELECTRON;
    const prevR = process.env.PI_DASHBOARD_RESOURCES_PATH;
    process.env.PI_DASHBOARD_ELECTRON = "1";
    process.env.PI_DASHBOARD_RESOURCES_PATH = "/stale/App.app/Contents/Resources";
    try {
      const env = buildSpawnEnv(process.env, { spawnRuntime: rt });
      expect(env.PI_DASHBOARD_ELECTRON).toBeUndefined();
      expect(env.PI_DASHBOARD_RESOURCES_PATH).toBeUndefined();
    } finally {
      if (prevE === undefined) delete process.env.PI_DASHBOARD_ELECTRON;
      else process.env.PI_DASHBOARD_ELECTRON = prevE;
      if (prevR === undefined) delete process.env.PI_DASHBOARD_RESOURCES_PATH;
      else process.env.PI_DASHBOARD_RESOURCES_PATH = prevR;
    }
  });
});

describe("applySpawnRuntimeToPiArgv (test-plan E13 argv half, task 3.2)", () => {
  const rt = {
    ...fakeRuntimeAt("/resolved/bin"),
    nodeBinary: "/resolved/bin/node",
  };

  it("explicit [node.exe, cli.js] pair re-points at the resolved binary", () => {
    expect(applySpawnRuntimeToPiArgv(["C:\\Tools\\node.exe", "C:\\pi\\agent\\cli.js"], rt)).toEqual([
      "/resolved/bin/node",
      "C:\\pi\\agent\\cli.js",
    ]);
  });

  it("bare pi argv passes through unchanged", () => {
    expect(applySpawnRuntimeToPiArgv(["pi"], rt)).toEqual(["pi"]);
  });

  it("null runtime and already-resolved argv are no-ops", () => {
    expect(applySpawnRuntimeToPiArgv(["C:\\n.exe", "C:\\cli.js"], null)).toEqual([
      "C:\\n.exe",
      "C:\\cli.js",
    ]);
    expect(
      applySpawnRuntimeToPiArgv(["/resolved/bin/node", "/pi/cli.js"], rt),
    ).toEqual(["/resolved/bin/node", "/pi/cli.js"]);
  });
});

describe("resolvedSharedTreeFamilyArgv — install/load coherence (test-plan E13 npmEntry half, task 3.3)", () => {
  it("npm install command runs with the resolved family's entries", () => {
    // User nvm runtime with the lib/ npm layout — the shared-tree install
    // SHALL run with the user's Node family (spec "Extension install uses
    // the resolved family").
    const binDir = path.join(tmpHome, ".nvm", "versions", "node", "v25.8.1", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const npmCli = path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    fs.mkdirSync(path.dirname(npmCli), { recursive: true });
    fs.writeFileSync(npmCli, "");
    const rt = fakeRuntimeAt(binDir);

    expect(resolvedSharedTreeFamilyArgv("npm", ["install", "-g", "x"], rt)).toEqual([
      rt.nodeBinary,
      npmCli,
      "install",
      "-g",
      "x",
    ]);
  });

  it("shim fallback spawns directly; non-family commands fall through", () => {
    const binDir = path.join(tmpHome, "bare", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const rt = fakeRuntimeAt(binDir);

    expect(resolvedSharedTreeFamilyArgv("npm", ["root", "-g"], rt)).toEqual([
      path.join(binDir, "npm"),
      "root",
      "-g",
    ]);
    expect(resolvedSharedTreeFamilyArgv("git", ["clone"], rt)).toBeNull();
  });
});

describe("spawnRuntimeForSession re-validation (test-plan X5, task 9.23)", () => {
  it("vanished resolved binary → ladder re-resolves; fresh binary reaches env/argv", () => {
    // Fault X5: the startup-resolved user Node directory was deleted.
    const vanished = fakeRuntimeAt(path.join(tmpHome, "deleted", "bin"));
    setCurrentSpawnRuntime(vanished);

    const fresh = spawnRuntimeForSession();

    // The stale resolution was rejected (binary no longer exists) and the
    // ladder re-resolved live — a real, existing, different binary.
    expect(fresh).not.toBeNull();
    expect(fresh?.nodeBinary).not.toBe(vanished.nodeBinary);
    expect(fs.existsSync(fresh?.nodeBinary ?? "")).toBe(true);

    // The re-resolved binary is what the spawn surfaces consume.
    const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" }, { spawnRuntime: fresh });
    expect((env.PATH ?? "").split(path.delimiter)[0]).toBe(fresh?.nodeBinDir);
    expect(applySpawnRuntimeToPiArgv(["C:\\old\\node.exe", "C:\\cli.js"], fresh)[0]).toBe(
      fresh?.nodeBinary,
    );

    // Restore a benign holder value for any later test in this file.
    setCurrentSpawnRuntime(fresh!);
  });
});
