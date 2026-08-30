/**
 * Tests for the spawn-runtime resolution ladder (change
 * unify-pi-runtime-identity). Scenario ids reference the change's
 * test-plan.md.
 *
 * Exemplar: bundled-node-meets-pi-floor.test.ts (version-gate invariant
 * style), binary-lookup.test.ts (injectable-probe style).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { whichViaLoginShell } from "../platform/binary-lookup.js";
import {
  buildPublishedRuntimeBlock,
  classifyNodeSource,
  defaultVersionProbe,
  electronResourcesPath,
  ensureFreshRuntime,
  evaluateVersionGate,
  isShimShapedPath,
  parseEnginesFloor,
  piEntryFromArgv,
  type ResolveSpawnRuntimeOpts,
  readPiEnginesFloor,
  readRuntimeOverride,
  readToolOverrideNode,
  resolveSpawnRuntime,
  type VersionProbeResult,
  validateResolvedRuntime,
} from "../platform/spawn-runtime.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "spawn-runtime-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Touch a file (and parents) so `existsSync` sees a candidate. */
function touch(p: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "");
  return p;
}

/** Build a pi-copy fixture: package.json + dist/cli.js at `<root>/<pkg>/`. */
function piCopy(root: string, pkgName: string, enginesNode?: string): string {
  const pkgDir = path.join(root, ...pkgName.split("/"));
  mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  const entry = path.join(pkgDir, "dist", "cli.js");
  writeFileSync(entry, "");
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: pkgName,
      ...(enginesNode !== undefined ? { engines: { node: enginesNode } } : {}),
    }),
  );
  return entry;
}

interface ProbeSpec {
  [binary: string]: { version: string; abi?: number } | "fail";
}

function makeOpts(spec: {
  probe?: ProbeSpec;
  pathNode?: string | null;
  loginShellNode?: string | null;
  managedNode?: string | null;
  bundledNode?: string | null;
  home?: string;
  arm?: "electron" | "npm" | "docker";
  platform?: NodeJS.Platform;
  overrideBinary?: string | null;
  toolOverrideNode?: string | null;
  piEntry?: string | null;
  resourcesPath?: string;
  exists?: (p: string) => boolean;
}): ResolveSpawnRuntimeOpts {
  const probe = spec.probe ?? {};
  const order: string[] = [];
  const pathNode = spec.pathNode;
  const loginShellNode = spec.loginShellNode;
  return {
    arm: spec.arm ?? "npm",
    platform: spec.platform ?? "darwin",
    homedir: spec.home ?? path.join(tmp, "home"),
    managedDir: path.join(tmp, "managed"),
    resourcesPath: spec.resourcesPath ?? path.join(tmp, "resources"),
    piEntry: spec.piEntry ?? null,
    overrideBinary: spec.overrideBinary ?? null,
    toolOverrideNode: spec.toolOverrideNode ?? null,
    ...(pathNode === undefined ? {} : {}),
    env: { PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv,
    pathWhich: (name) => (name === "node" ? (pathNode ?? null) : null),
    loginShellWhich: (name) => (name === "node" ? (loginShellNode ?? null) : null),
    versionProbe: (binary) => {
      order.push(binary);
      const hit = probe[binary];
      if (!hit || hit === "fail") return null;
      return { version: hit.version, abi: hit.abi ?? 137 };
    },
    exists: spec.exists ?? (() => true),
    // Keep fs-only nvm probe pointed at the fixture home.
    ...{},
  };
}

// ── E1: version gate BVA sweep ──────────────────────────────────────────────

describe("evaluateVersionGate (test-plan E1)", () => {
  const FLOOR = "22.19.0";
  // BVA sweep from the test plan: reject/accept pattern per the accept-set,
  // with the cap note on 27.
  const cases: Array<[string, boolean, boolean?]> = [
    ["v22.18.9", false], // one below pi floor
    ["v22.19.0", true], // floor exactly
    ["v23.5.0", true],
    ["v24.0.1", true], // below the affected window
    ["v24.1.0", false], // nodejs/node#58515 lower bound
    ["v24.2.9", false], // affected upper bound
    ["v24.3.0", true], // first fixed 24.x
    ["v26.9.9", true],
    ["v27.0.0", true, true], // accepted WITH cap note
  ];

  for (const [version, ok, capExceeded] of cases) {
    it(`${version} -> ${ok ? "accept" : "reject"}${capExceeded ? " + cap note" : ""}`, () => {
      const result = evaluateVersionGate(version, FLOOR);
      expect(result.ok).toBe(ok);
      if (!ok) expect(result.reason).toBeTruthy();
      expect(result.capExceeded ?? false).toBe(capExceeded ?? false);
    });
  }

  it("rejects unparseable versions with a recorded reason", () => {
    const result = evaluateVersionGate("garbage", FLOOR);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/below pi floor/);
  });

  it("affected-range rejection names nodejs/node#58515", () => {
    expect(evaluateVersionGate("v24.1.0", FLOOR).reason).toMatch(/58515/);
  });
});

// ── parseEnginesFloor shapes ────────────────────────────────────────────────

describe("parseEnginesFloor", () => {
  it("parses >=X.Y.Z with and without a cap term", () => {
    expect(parseEnginesFloor(">=22.19.0")).toBe("22.19.0");
    expect(parseEnginesFloor(">=22.19.0 <27")).toBe("22.19.0");
  });

  it("parses ^X and ~X.Y", () => {
    expect(parseEnginesFloor("^22")).toBe("22.0.0");
    expect(parseEnginesFloor("~22.19")).toBe("22.19.0");
  });

  it("treats everything else as unreadable", () => {
    expect(parseEnginesFloor("weird||range")).toBeNull();
    expect(parseEnginesFloor("*")).toBeNull();
    expect(parseEnginesFloor("")).toBeNull();
    expect(parseEnginesFloor(">=22.19")).toBeNull();
  });
});

// ── E2: readPiEnginesFloor ──────────────────────────────────────────────────

describe("readPiEnginesFloor (test-plan E2)", () => {
  it("parses valid engines shapes from the spawned pi copy", () => {
    for (const [range, expected] of [
      [">=22.19.0", "22.19.0"],
      [">=22.19.0 <27", "22.19.0"],
      ["^22", "22.0.0"],
      ["~22.19", "22.19.0"],
    ] as const) {
      const entry = piCopy(path.join(tmp, `pi-${expected}`), "@earendil-works/pi-coding-agent", range);
      expect(readPiEnginesFloor(entry)).toEqual({ floor: expected, source: "engines" });
    }
  });

  it("falls back to MIN_SUPPORTED_NODE on garbage engines, missing engines, and a missing file", () => {
    const garbage = piCopy(path.join(tmp, "pi-g"), "@earendil-works/pi-coding-agent", "weird||range");
    expect(readPiEnginesFloor(garbage).source).toBe("fallback");

    const noEngines = piCopy(path.join(tmp, "pi-n"), "@earendil-works/pi-coding-agent");
    expect(readPiEnginesFloor(noEngines)).toEqual({
      floor: "22.19.0",
      source: "fallback",
    });

    expect(readPiEnginesFloor(path.join(tmp, "does-not-exist.js")).source).toBe("fallback");
    expect(readPiEnginesFloor(null).source).toBe("fallback");
  });

  it("never consults a global pi elsewhere on the machine", () => {
    // The "global" copy carries a DIFFERENT floor; the spawned copy's chain
    // is the only thing walked.
    piCopy(path.join(tmp, "usr-local-lib"), "@mariozechner/pi-coding-agent", ">=20.0.0");
    const spawned = piCopy(
      path.join(tmp, "bundled"),
      "@earendil-works/pi-coding-agent",
      ">=25.0.0",
    );
    expect(readPiEnginesFloor(spawned)).toEqual({ floor: "25.0.0", source: "engines" });
  });

  it("climbs past non-pi package.json files (bin-shim realpaths)", () => {
    // Entry deeper than the package root with an unrelated package.json
    // between: the walk must keep climbing to the pi package.
    const pkgDir = path.join(tmp, "nest", "node_modules", "@earendil-works", "pi-coding-agent");
    mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@earendil-works/pi-coding-agent", engines: { node: ">=24.0.0" } }),
    );
    writeFileSync(path.join(pkgDir, "dist", "cli.js"), "");
    writeFileSync(path.join(tmp, "nest", "package.json"), JSON.stringify({ name: "wrapper" }));
    expect(readPiEnginesFloor(path.join(pkgDir, "dist", "cli.js"))).toEqual({
      floor: "24.0.0",
      source: "engines",
    });
  });
});

// ── classifyNodeSource (design D4, vendored) ────────────────────────────────

describe("classifyNodeSource", () => {
  it("classifies a path under <managedDir>/node as managed", () => {
    const managedDir = path.join(tmp, "dash-home");
    const node = touch(path.join(managedDir, "node", "bin", "node"));
    expect(classifyNodeSource(node, { managedDir })).toBe("managed");
  });

  it("classifies a path under resourcesPath/node as bundled-electron", () => {
    const resources = path.join(tmp, "app", "resources");
    const node = touch(path.join(resources, "node", "bin", "node"));
    expect(classifyNodeSource(node, { managedDir: path.join(tmp, "none"), resourcesPath: resources })).toBe(
      "bundled-electron",
    );
  });

  it("classifies everything else as system", () => {
    const node = touch(path.join(tmp, "nvm", "versions", "node", "v25.1.0", "bin", "node"));
    expect(
      classifyNodeSource(node, { managedDir: path.join(tmp, "none"), resourcesPath: path.join(tmp, "res") }),
    ).toBe("system");
  });

  it("treats unresolvable paths as system (safe-don't-touch default)", () => {
    expect(classifyNodeSource(path.join(tmp, "missing", "node"))).toBe("system");
  });
});

// ── task 2.1: whichViaLoginShell export ─────────────────────────────────────

describe("whichViaLoginShell export", () => {
  it("is exported and returns null when the shell cannot run", () => {
    expect(typeof whichViaLoginShell).toBe("function");
    const prev = process.env.SHELL;
    process.env.SHELL = "/nonexistent-shell-for-test";
    try {
      expect(whichViaLoginShell("node")).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.SHELL;
      else process.env.SHELL = prev;
    }
  });
});

// ── Review round 1 regression: Electron identity across the process boundary ─

describe("Electron server child (env markers) — review finding regressions", () => {
  function restoreEnv(prev: { e?: string; r?: string }): void {
    if (prev.e === undefined) delete process.env.PI_DASHBOARD_ELECTRON;
    else process.env.PI_DASHBOARD_ELECTRON = prev.e;
    if (prev.r === undefined) delete process.env.PI_DASHBOARD_RESOURCES_PATH;
    else process.env.PI_DASHBOARD_RESOURCES_PATH = prev.r;
  }

  it("detectSpawnArm honours the launcher-stamped PI_DASHBOARD_ELECTRON marker", async () => {
    const { detectSpawnArm } = await import("../platform/spawn-runtime.js");
    const prev = { e: process.env.PI_DASHBOARD_ELECTRON, r: process.env.PI_DASHBOARD_RESOURCES_PATH };
    process.env.PI_DASHBOARD_ELECTRON = "1";
    process.env.PI_DASHBOARD_RESOURCES_PATH = path.join(tmp, "app", "resources");
    try {
      // In a plain node test process neither electron marker exists — only
      // the launcher-stamped env makes this "electron".
      expect(detectSpawnArm()).toBe("electron");
    } finally {
      restoreEnv(prev);
    }
  });

  it("bundled rung is reachable on the Electron child and publishes path-free", async () => {
    const { electronResourcesPath } = await import("../platform/spawn-runtime.js");
    const resources = path.join(tmp, "app2", "resources");
    const bundled = touch(path.join(resources, "node", "bin", "node"));
    const prev = { e: process.env.PI_DASHBOARD_ELECTRON, r: process.env.PI_DASHBOARD_RESOURCES_PATH };
    process.env.PI_DASHBOARD_ELECTRON = "1";
    process.env.PI_DASHBOARD_RESOURCES_PATH = resources;
    try {
      expect(electronResourcesPath()).toBe(resources);
      const rt = resolveSpawnRuntime(
        makeOpts({
          probe: { [bundled]: { version: "v24.15.0", abi: 137 } },
          pathNode: null,
          loginShellNode: null,
          arm: "electron",
          resourcesPath: resources,
          exists: (p) => p === bundled || p === process.execPath,
        }),
      );
      expect(rt.rung).toBe("bundled");
      expect(rt.source).toBe("bundled-electron");
      const block = buildPublishedRuntimeBlock(rt);
      expect(JSON.stringify(block)).not.toContain(resources);
      expect(block).toMatchObject({ source: "bundled-electron", abi: 137 });
    } finally {
      restoreEnv(prev);
    }
  });
});

describe("piEntryFromArgv (design D2 — floor of the spawned copy)", () => {
  it("prefers the cli.js element of a node-wrapped argv", () => {
    expect(piEntryFromArgv(["node.exe", "/app/pi/dist/cli.js"])).toBe("/app/pi/dist/cli.js");
  });

  it("falls back to the bin shim (realpath walk-up handles symlinks)", () => {
    expect(piEntryFromArgv(["/home/u/.nvm/versions/node/v25/bin/pi"])).toBe(
      "/home/u/.nvm/versions/node/v25/bin/pi",
    );
    expect(piEntryFromArgv([])).toBeNull();
  });
});

// ── E3: ladder decision table ───────────────────────────────────────────────

describe("resolveSpawnRuntime — completeness matrix (test-plan E3)", () => {
  // Lazy: `tmp` only exists after beforeEach.
  const P = () => ({
    USER_NODE: path.join(tmp, "user-bin", "node"),
    OVERRIDE: path.join(tmp, "override", "node"),
    SELECTION: path.join(tmp, "selection", "node"),
    MANAGED: path.join(tmp, "managed", "node", "bin", "node"),
    BUNDLED: path.join(tmp, "resources", "node", "bin", "node"),
  });

  const probeFor = (
    paths: Record<string, string>,
    version: string,
    abi = 137,
  ): ProbeSpec => {
    const spec: ProbeSpec = {};
    for (const p of Object.values(paths)) spec[p] = { version, abi };
    return spec;
  };

  it("valid override wins over a user Node", () => {
    const { USER_NODE, OVERRIDE } = P();
    const opts = makeOpts({
      probe: probeFor({ USER_NODE, OVERRIDE }, "v25.1.0"),
      overrideBinary: OVERRIDE,
      pathNode: USER_NODE,
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("override");
    expect(rt.nodeBinary).toBe(OVERRIDE);
  });

  it("override naming a missing binary falls through with a recorded reason", () => {
    const { USER_NODE, OVERRIDE } = P();
    const opts = makeOpts({
      probe: probeFor({ USER_NODE, OVERRIDE }, "v25.1.0"),
      overrideBinary: OVERRIDE,
      pathNode: USER_NODE,
      exists: (p) => p !== OVERRIDE, // override binary is gone
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("user");
    const overrideStep = rt.trail.find((s) => s.rung === "override");
    expect(overrideStep?.outcome).toBe("not-found");
    expect(overrideStep?.reason).toBeTruthy();
  });

  it("gate-failing override (24.1) falls through like an absent one", () => {
    const { USER_NODE, OVERRIDE } = P();
    const opts = makeOpts({
      probe: { [OVERRIDE]: { version: "v24.1.0" }, [USER_NODE]: { version: "v25.1.0" } },
      overrideBinary: OVERRIDE,
      pathNode: USER_NODE,
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("user");
    const overrideStep = rt.trail.find((s) => s.rung === "override");
    expect(overrideStep?.outcome).toBe("skipped");
    expect(overrideStep?.reason).toMatch(/58515/);
  });

  it("user Node outranks managed Node (both gate-passing)", () => {
    const { USER_NODE, MANAGED } = P();
    const opts = makeOpts({
      probe: probeFor({ USER_NODE, MANAGED }, "v25.1.0"),
      pathNode: USER_NODE,
      managedNode: MANAGED,
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("user");
    expect(rt.nodeBinary).toBe(USER_NODE);
  });

  it("affected-range user Node is treated as absent; managed wins", () => {
    const { USER_NODE, MANAGED } = P();
    const opts = makeOpts({
      probe: { [USER_NODE]: { version: "v24.1.0" }, [MANAGED]: { version: "v24.3.0" } },
      pathNode: USER_NODE,
      managedNode: MANAGED,
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("managed");
    const userStep = rt.trail.find((s) => s.rung === "user");
    expect(userStep?.outcome).toBe("skipped");
  });

  it("stale managed Node is skipped to the dashboard's own runtime (bundled)", () => {
    const { MANAGED, BUNDLED } = P();
    const opts = makeOpts({
      probe: { [MANAGED]: { version: "v22.18.0" }, [BUNDLED]: { version: "v24.15.0" } },
      managedNode: MANAGED,
      bundledNode: BUNDLED,
      arm: "electron",
    });
    const rt = resolveSpawnRuntime(opts);
    expect(rt.rung).toBe("bundled");
    const managedStep = rt.trail.find((s) => s.rung === "managed");
    expect(managedStep?.outcome).toBe("skipped");
    expect(managedStep?.reason).toMatch(/floor|22\.18/);
  });

  it("terminal rung is bundled on the Electron arm", () => {
    const { BUNDLED } = P();
    const rt = resolveSpawnRuntime(
      makeOpts({ probe: { [BUNDLED]: { version: "v24.15.0" } }, arm: "electron" }),
    );
    expect(rt.rung).toBe("bundled");
    expect(rt.source).toBe("bundled-electron");
  });

  it("terminal rung is execPath on non-Electron arms (no probe)", () => {
    const probed: string[] = [];
    const base = makeOpts({ probe: {}, arm: "npm" });
    const rt = resolveSpawnRuntime({
      ...base,
      versionProbe: (binary) => {
        probed.push(binary);
        return null;
      },
    });
    expect(rt.rung).toBe("execPath");
    expect(rt.nodeBinary).toBe(process.execPath);
    expect(rt.version).toBe(process.version);
    expect(Number(rt.abi)).toBe(Number(process.versions.modules));
    expect(probed).not.toContain(process.execPath);
  });

  it("family-selection node entry resolves as the selection rung when no override", () => {
    const { SELECTION } = P();
    const rt = resolveSpawnRuntime(
      makeOpts({ probe: { [SELECTION]: { version: "v25.1.0" } }, toolOverrideNode: SELECTION }),
    );
    expect(rt.rung).toBe("selection");
    expect(rt.nodeBinary).toBe(SELECTION);
  });

  it("runtime.override wins and the shadowed selection is named in the trail", () => {
    const { OVERRIDE, SELECTION } = P();
    const rt = resolveSpawnRuntime(
      makeOpts({
        probe: probeFor({ OVERRIDE, SELECTION }, "v25.1.0"),
        overrideBinary: OVERRIDE,
        toolOverrideNode: SELECTION,
      }),
    );
    expect(rt.rung).toBe("override");
    const selectionStep = rt.trail.find((s) => s.rung === "selection");
    expect(selectionStep?.reason).toMatch(/shadowed/);
  });

  it("gate-failing selection falls through to the user Node", () => {
    const { SELECTION, USER_NODE } = P();
    const rt = resolveSpawnRuntime(
      makeOpts({
        probe: { [SELECTION]: { version: "v24.1.0" }, [USER_NODE]: { version: "v25.1.0" } },
        toolOverrideNode: SELECTION,
        pathNode: USER_NODE,
      }),
    );
    expect(rt.rung).toBe("user");
    const selectionStep = rt.trail.find((s) => s.rung === "selection");
    expect(selectionStep?.outcome).toBe("skipped");
  });

  it("records the pi floor provenance on the result", () => {
    const { USER_NODE } = P();
    const entry = piCopy(path.join(tmp, "pi-floor"), "@earendil-works/pi-coding-agent", ">=23.0.0");
    const rt = resolveSpawnRuntime(
      makeOpts({ probe: { [USER_NODE]: { version: "v25.1.0" } }, pathNode: USER_NODE, piEntry: entry }),
    );
    expect(rt.piFloor).toBe("23.0.0");
    expect(rt.piFloorSource).toBe("engines");
  });
});

// ── E4: arm-dependent step-2 order ──────────────────────────────────────────

describe("resolveSpawnRuntime — arm-dependent order (test-plan E4)", () => {
  // Lazy: `tmp` only exists after beforeEach.
  const Q = () => ({
    SERVICE_PATH_NODE: path.join(tmp, "service", "node"),
    NVM_LOGIN_NODE: path.join(tmp, "nvm-login", "node"),
    TERMINAL_PATH_NODE: path.join(tmp, "terminal", "node"),
    PROFILE_DEFAULT_NODE: path.join(tmp, "profile", "node"),
  });

  it("GUI arm resolves the login-shell Node over the service-PATH Node", () => {
    const { SERVICE_PATH_NODE, NVM_LOGIN_NODE } = Q();
    const rt = resolveSpawnRuntime(
      makeOpts({
        probe: {
          [SERVICE_PATH_NODE]: { version: "v24.9.0" },
          [NVM_LOGIN_NODE]: { version: "v25.1.0" },
        },
        pathNode: SERVICE_PATH_NODE,
        loginShellNode: NVM_LOGIN_NODE,
        arm: "electron",
      }),
    );
    expect(rt.rung).toBe("user");
    expect(rt.via).toBe("login-shell");
    expect(rt.nodeBinary).toBe(NVM_LOGIN_NODE);
  });

  it("terminal arm resolves the PATH Node (`nvm use`) over the profile default", () => {
    const { TERMINAL_PATH_NODE, PROFILE_DEFAULT_NODE } = Q();
    const rt = resolveSpawnRuntime(
      makeOpts({
        probe: {
          [TERMINAL_PATH_NODE]: { version: "v25.1.0" },
          [PROFILE_DEFAULT_NODE]: { version: "v24.9.0" },
        },
        pathNode: TERMINAL_PATH_NODE,
        loginShellNode: PROFILE_DEFAULT_NODE,
        arm: "npm",
      }),
    );
    expect(rt.rung).toBe("user");
    expect(rt.via).toBe("path");
    expect(rt.nodeBinary).toBe(TERMINAL_PATH_NODE);
  });

  it("login-shell-first defaults ON for Electron and OFF for terminal arms", () => {
    const { SERVICE_PATH_NODE, NVM_LOGIN_NODE } = Q();
    // Behavioural proof via ordering: with both candidates gate-FAILING at
    // the same failing version the trail order tells which was evaluated first.
    const probe = (v: string): ProbeSpec => ({
      [NVM_LOGIN_NODE]: { version: v },
      [SERVICE_PATH_NODE]: { version: v },
    });

    const gui = resolveSpawnRuntime(
      makeOpts({ probe: probe("v22.18.0"), pathNode: SERVICE_PATH_NODE, loginShellNode: NVM_LOGIN_NODE, arm: "electron" }),
    );
    const guiOrder = gui.trail.filter((s) => s.rung === "user").map((s) => s.via);
    expect(guiOrder[0]).toBe("login-shell");

    const term = resolveSpawnRuntime(
      makeOpts({ probe: probe("v22.18.0"), pathNode: SERVICE_PATH_NODE, loginShellNode: NVM_LOGIN_NODE, arm: "npm" }),
    );
    const termOrder = term.trail.filter((s) => s.rung === "user").map((s) => s.via);
    expect(termOrder[0]).toBe("path");
  });
});

// ── E5: version-manager default probe (fs only) ─────────────────────────────

describe("resolveSpawnRuntime — version-manager default (test-plan E5)", () => {
  function nvmHome(version: string | null): string {
    const home = path.join(tmp, `nvm-home-${version ?? "none"}`);
    if (version) {
      mkdirSync(path.join(home, ".nvm", "alias"), { recursive: true });
      writeFileSync(path.join(home, ".nvm", "alias", "default"), version);
      touch(path.join(home, ".nvm", "versions", "node", `v${version}`, "bin", "node"));
    }
    return home;
  }

  it("resolves the nvm default with no shell invocation", () => {
    const home = nvmHome("25.1.0");
    const defaultNode = path.join(home, ".nvm", "versions", "node", "v25.1.0", "bin", "node");
    const rt = resolveSpawnRuntime(
      makeOpts({
        probe: { [defaultNode]: { version: "v25.1.0" } },
        pathNode: null,
        loginShellNode: null,
        home,
      }),
    );
    expect(rt.rung).toBe("user");
    expect(rt.via).toBe("version-manager-default");
    expect(rt.nodeBinary).toBe(defaultNode);
  });

  it("falls through when no default alias exists", () => {
    const home = nvmHome(null);
    const rt = resolveSpawnRuntime(
      makeOpts({ probe: {}, pathNode: null, loginShellNode: null, home, arm: "npm" }),
    );
    expect(rt.rung).toBe("execPath");
  });

  it("marks volta/asdf/mise shim paths as shim-shaped", () => {
    expect(isShimShapedPath("/home/u/.volta/bin/node")).toBe(true);
    expect(isShimShapedPath("/home/u/.asdf/shims/node")).toBe(true);
    expect(isShimShapedPath("/home/u/.local/share/mise/shims/node")).toBe(true);
    expect(isShimShapedPath("/home/u/.nvm/versions/node/v25.1.0/bin/node")).toBe(false);
  });
});

// ── X2: candidate probe failure containment ─────────────────────────────────

describe("candidate probe failure (test-plan X2)", () => {
  it("rejects the candidate with a recorded reason and the ladder continues", () => {
    const failing = path.join(tmp, "failing", "node");
    const passing = path.join(tmp, "passing", "node");
    const probe: ProbeSpec = {
      [failing]: "fail",
      [passing]: { version: "v25.1.0", abi: 141 },
    };

    // Terminal arm: PATH first (failing) → login-shell (passing).
    const term = resolveSpawnRuntime(
      makeOpts({ probe, pathNode: failing, loginShellNode: passing, arm: "npm" }),
    );
    expect(term.nodeBinary).toBe(passing);
    const pathStep = term.trail.find((s) => s.rung === "user" && s.via === "path");
    expect(pathStep?.outcome).toBe("skipped");
    expect(pathStep?.reason).toMatch(/probe/);

    // GUI arm: login-shell first (failing) → PATH (passing).
    const gui = resolveSpawnRuntime(
      makeOpts({ probe, pathNode: passing, loginShellNode: failing, arm: "electron" }),
    );
    expect(gui.nodeBinary).toBe(passing);
    const shellStep = gui.trail.find((s) => s.rung === "user" && s.via === "login-shell");
    expect(shellStep?.outcome).toBe("skipped");
    expect(shellStep?.reason).toMatch(/probe/);
  });

  it("defaultVersionProbe parses the fixed-argv output shape from a real node", () => {
    const result = defaultVersionProbe(process.execPath);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(process.version);
    expect(result?.abi).toBe(Number(process.versions.modules));
  });

  it("defaultVersionProbe returns null for a non-binary", () => {
    expect(defaultVersionProbe(path.join(tmp, "not-a-binary"))).toBeNull();
  });
});

// ── E14: spawn-time identity re-validation ──────────────────────────────────

describe("re-validation (test-plan E14)", () => {
  const PROBE_VERSION = { version: "v25.1.0", abi: 141 };

  it("retargeted symlink (different version) forces re-resolution", () => {
    const dir = path.join(tmp, "symlink-case");
    mkdirSync(path.join(dir, "v25.1.0", "bin"), { recursive: true });
    mkdirSync(path.join(dir, "v25.2.0", "bin"), { recursive: true });
    writeFileSync(path.join(dir, "v25.1.0", "bin", "node"), "a");
    writeFileSync(path.join(dir, "v25.2.0", "bin", "node"), "b");
    const link = path.join(dir, "link-node");
    symlinkSync(path.join(dir, "v25.1.0", "bin", "node"), link);

    // Capture identity at resolution time.
    const cap = resolveSpawnRuntime(makeOpts({ probe: { [link]: PROBE_VERSION }, pathNode: link }));
    expect(cap.identity).not.toBeNull();

    // Retarget to a different version.
    rmSync(link);
    symlinkSync(path.join(dir, "v25.2.0", "bin", "node"), link);
    const probes: string[] = [];
    const verdict = validateResolvedRuntime(cap, {
      versionProbe: (b) => {
        probes.push(b);
        return { version: "v25.2.0", abi: 141 };
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/drift|changed/);
  });

  it("retarget to the SAME version+ABI is benign (probe-on-drift passes)", () => {
    const dir = path.join(tmp, "symlink-same");
    mkdirSync(path.join(dir, "a", "bin"), { recursive: true });
    mkdirSync(path.join(dir, "b", "bin"), { recursive: true });
    writeFileSync(path.join(dir, "a", "bin", "node"), "a");
    writeFileSync(path.join(dir, "b", "bin", "node"), "b");
    const link = path.join(dir, "link-node");
    symlinkSync(path.join(dir, "a", "bin", "node"), link);
    const cap = resolveSpawnRuntime(makeOpts({ probe: { [link]: PROBE_VERSION }, pathNode: link }));
    rmSync(link);
    symlinkSync(path.join(dir, "b", "bin", "node"), link);
    const verdict = validateResolvedRuntime(cap, {
      versionProbe: () => PROBE_VERSION,
    });
    expect(verdict.ok).toBe(true);
  });

  it("shim path probes per spawn despite identical stat", () => {
    const shim = path.join(tmp, "volta-home", ".volta", "bin", "node");
    touch(shim);
    const cap = resolveSpawnRuntime(makeOpts({ probe: { [shim]: PROBE_VERSION }, pathNode: shim }));
    let probeCount = 0;
    const verdict = validateResolvedRuntime(cap, {
      versionProbe: () => {
        probeCount++;
        return PROBE_VERSION;
      },
      lstat: () => ({ size: 100, mtimeMs: 1000, isSymbolicLink: () => false }),
    });
    expect(verdict.ok).toBe(true);
    expect(probeCount).toBe(1); // per-spawn probe FIRED despite unchanged stat
  });

  it("vanished binary invalidates", () => {
    const gone = path.join(tmp, "gone", "node");
    const cap = resolveSpawnRuntime(makeOpts({ probe: { [gone]: PROBE_VERSION }, pathNode: gone }));
    const verdict = validateResolvedRuntime(cap, { exists: () => false });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/no longer exists/);
  });

  it("ensureFreshRuntime re-resolves through the ladder on invalidation (X5)", () => {
    const vanished = path.join(tmp, "vanished-user", "node");
    const managed = path.join(tmp, "managed", "node", "bin", "node");
    const cap = resolveSpawnRuntime(makeOpts({ probe: { [vanished]: PROBE_VERSION }, pathNode: vanished }));
    expect(cap.rung).toBe("user");

    const fresh = ensureFreshRuntime(cap, {
      ...makeOpts({
        probe: { [managed]: { version: "v24.3.0", abi: 137 } },
        pathNode: vanished, // still on PATH but now nonexistent
        managedNode: managed,
      }),
      exists: (p) => p === managed || p === process.execPath,
    });
    expect(fresh.rung).toBe("managed");
    expect(fresh.nodeBinary).toBe(managed);
  });
});

// ── E6: publication shapes ──────────────────────────────────────────────────

describe("buildPublishedRuntimeBlock (test-plan E6)", () => {
  const base = {
    version: "v25.1.0",
    identity: null,
    trail: [],
    piFloor: "22.19.0",
    piFloorSource: "fallback" as const,
    arm: "npm" as const,
  };

  it("outside-bundle runtime carries binary + binDir + ABI + source", () => {
    const block = buildPublishedRuntimeBlock({
      ...base,
      nodeBinary: "/home/u/.nvm/versions/node/v25.1.0/bin/node",
      nodeBinDir: "/home/u/.nvm/versions/node/v25.1.0/bin",
      abi: 141,
      source: "system",
      rung: "user",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(block).toEqual({
      nodeBinDir: "/home/u/.nvm/versions/node/v25.1.0/bin",
      nodeBinary: "/home/u/.nvm/versions/node/v25.1.0/bin/node",
      abi: 141,
      source: "system",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
  });

  it("bundled runtime is path-free on stable installs", () => {
    const block = buildPublishedRuntimeBlock({
      ...base,
      nodeBinary: "/Applications/App.app/Contents/Resources/node/bin/node",
      nodeBinDir: "/Applications/App.app/Contents/Resources/node/bin",
      abi: 137,
      source: "bundled-electron",
      rung: "bundled",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(JSON.stringify(block)).not.toMatch(/App\.app/);
    expect(block).toEqual({ source: "bundled-electron", abi: 137, resolvedAt: "2026-08-30T00:00:00.000Z" });
  });

  it("AppImage mount marks ephemeral and stays path-free", () => {
    const block = buildPublishedRuntimeBlock({
      ...base,
      nodeBinary: "/tmp/.mount_abc123/app/resources/node/bin/node",
      nodeBinDir: "/tmp/.mount_abc123/app/resources/node/bin",
      abi: 137,
      source: "bundled-electron",
      rung: "bundled",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(block).toEqual({
      source: "bundled-electron",
      abi: 137,
      resolvedAt: "2026-08-30T00:00:00.000Z",
      ephemeral: true,
    });
  });

  it("macOS App Translocation marks ephemeral", () => {
    const block = buildPublishedRuntimeBlock({
      ...base,
      nodeBinary: "/private/var/folders/x/AppTranslocation/App.app/Contents/Resources/node/bin/node",
      nodeBinDir: "/private/var/folders/x/AppTranslocation/App.app/Contents/Resources/node/bin",
      abi: 137,
      source: "bundled-electron",
      rung: "bundled",
      resolvedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(JSON.stringify(block)).not.toMatch(/AppTranslocation/);
    expect(block.ephemeral).toBe(true);
  });
});

// ── read-only override helpers ──────────────────────────────────────────────

describe("readRuntimeOverride / readToolOverrideNode", () => {
  it("reads runtime.override from config.json", () => {
    const cfg = path.join(tmp, "config.json");
    writeFileSync(cfg, JSON.stringify({ port: 1, runtime: { override: "/opt/node/bin/node" } }));
    expect(readRuntimeOverride(cfg)).toBe("/opt/node/bin/node");
  });

  it("absent/malformed files read as null", () => {
    expect(readRuntimeOverride(path.join(tmp, "absent.json"))).toBeNull();
    const bad = path.join(tmp, "bad.json");
    writeFileSync(bad, "{not json");
    expect(readRuntimeOverride(bad)).toBeNull();
  });

  it("reads the family-selection node entry from tool-overrides.json", () => {
    const store = path.join(tmp, "tool-overrides.json");
    writeFileSync(
      store,
      JSON.stringify({ version: 1, overrides: { node: { path: "/volta/bin/node" }, npm: { path: "/x" } } }),
    );
    expect(readToolOverrideNode(store)).toBe("/volta/bin/node");
  });
});
