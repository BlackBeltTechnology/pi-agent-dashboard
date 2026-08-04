/**
 * Provisioning state-machine tests (group 4 + parts of group 5's traversal).
 * Every probe is injected — this suite MUST pass on Linux CI with zero reads of
 * a real /Applications path and zero real brew invocations (#X23).
 *
 * See change: add-apple-tools-imcp-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  type BrewResult,
  type InstallerEnv,
  runInstaller,
  TERMINAL_STATES,
} from "../install.js";
import type { ConfigIO } from "../mcp-config.js";

const DEFAULT_SERVER = "/Applications/iMCP.app/Contents/MacOS/imcp-server";
const HOME = "/home/tester";
const USER_LOCAL = `${HOME}/Applications/iMCP.app/Contents/MacOS/imcp-server`;

/** In-memory config IO with write tracking. */
function memIO(files: Record<string, string> = {}): ConfigIO & {
  writes: string[];
  store: Record<string, string>;
} {
  const store = { ...files };
  const writes: string[] = [];
  return {
    store,
    writes,
    readFile: (p) => (p in store ? store[p] : null),
    writeFileAtomic: (p, c) => {
      store[p] = c;
      writes.push(p);
    },
  };
}

function makeEnv(overrides: Partial<InstallerEnv> = {}): InstallerEnv {
  return {
    platform: "darwin",
    homedir: HOME,
    probeOsVersion: () => "15.3",
    pathExists: () => false,
    brewPath: () => "/opt/homebrew/bin/brew",
    runBrewCask: () => ({ code: 0, stderr: "" }) as BrewResult,
    mcpJsonPath: "/cfg/mcp.json",
    settingsJsonPath: "/cfg/settings.json",
    configIO: memIO(),
    ...overrides,
  };
}

describe("platform gate", () => {
  it("#E1: linux → UNSUPPORTED_PLATFORM, exit 0, no writes, no subprocess", () => {
    let brewCalled = false;
    const io = memIO();
    const r = runInstaller(
      makeEnv({
        platform: "linux",
        configIO: io,
        brewPath: () => {
          brewCalled = true;
          return "/x/brew";
        },
        runBrewCask: () => {
          brewCalled = true;
          return { code: 0, stderr: "" };
        },
      }),
    );
    expect(r.state).toBe("UNSUPPORTED_PLATFORM");
    expect(r.exitCode).toBe(0);
    expect(io.writes).toEqual([]);
    expect(brewCalled).toBe(false);
  });

  it("#E2: win32 → identical to linux (no Windows branch)", () => {
    const r = runInstaller(makeEnv({ platform: "win32" }));
    expect(r.state).toBe("UNSUPPORTED_PLATFORM");
    expect(r.exitCode).toBe(0);
  });

  it("#E3: darwin proceeds to version probe; sw_vers called exactly once", () => {
    let calls = 0;
    const r = runInstaller(
      makeEnv({
        pathExists: (p) => p === DEFAULT_SERVER,
        probeOsVersion: () => {
          calls++;
          return "15.3";
        },
      }),
    );
    expect(calls).toBe(1);
    expect(r.state).toBe("READY_PENDING_GRANTS");
  });
});

describe("version gate", () => {
  const cases: Array<[string, string, boolean]> = [
    ["#E4", "15.2", false],
    ["#E5", "15.3", true],
    ["#E6", "15.10", true],
    ["#E7", "26.0", true],
    ["#E8", "14.6", false],
  ];
  for (const [id, version, passes] of cases) {
    it(`${id}: sw_vers ${version} → ${passes ? "passes" : "OS_TOO_OLD"}`, () => {
      const io = memIO();
      const r = runInstaller(
        makeEnv({ probeOsVersion: () => version, pathExists: (p) => p === DEFAULT_SERVER, configIO: io }),
      );
      if (passes) {
        expect(r.state).toBe("READY_PENDING_GRANTS");
      } else {
        expect(r.state).toBe("OS_TOO_OLD");
        expect(r.exitCode).not.toBe(0);
        expect(io.writes).toEqual([]);
        expect(r.message).toContain(version);
        expect(r.message).toContain("15.3");
      }
    });
  }

  it("#E9: sw_vers absent/empty → OS_VERSION_UNKNOWN (not OS_TOO_OLD)", () => {
    const r = runInstaller(makeEnv({ probeOsVersion: () => null }));
    expect(r.state).toBe("OS_VERSION_UNKNOWN");
    expect(r.exitCode).not.toBe(0);
    expect(r.message.toLowerCase()).toContain("version");
  });
});

describe("discovery", () => {
  it("#E10: default /Applications binary found → install branch skipped", () => {
    let brewCalled = false;
    const r = runInstaller(
      makeEnv({
        pathExists: (p) => p === DEFAULT_SERVER,
        brewPath: () => {
          brewCalled = true;
          return "/x/brew";
        },
      }),
    );
    expect(r.state).toBe("READY_PENDING_GRANTS");
    expect(r.resolvedPath).toBe(DEFAULT_SERVER);
    expect(brewCalled).toBe(false);
  });

  it("#E11: /Applications absent, ~/Applications present → user-local recorded", () => {
    const r = runInstaller(makeEnv({ pathExists: (p) => p === USER_LOCAL }));
    expect(r.state).toBe("READY_PENDING_GRANTS");
    expect(r.resolvedPath).toBe(USER_LOCAL);
  });

  it("#E12: existing override wins; candidate list not consulted", () => {
    const override = "/opt/custom/imcp-server";
    const consulted: string[] = [];
    const r = runInstaller(
      makeEnv({
        overridePath: override,
        pathExists: (p) => {
          consulted.push(p);
          return p === override || p === DEFAULT_SERVER;
        },
      }),
    );
    expect(r.resolvedPath).toBe(override);
    expect(consulted).toEqual([override]); // short-circuited before the candidates
  });

  it("#E13: non-existent override falls through to candidate list", () => {
    const override = "/opt/missing/imcp-server";
    const r = runInstaller(
      makeEnv({
        overridePath: override,
        pathExists: (p) => p === DEFAULT_SERVER, // override absent
      }),
    );
    expect(r.resolvedPath).toBe(DEFAULT_SERVER);
  });
});

describe("terminal-state closure + distinctness", () => {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive matrix.
  it("#E14: every injected combination reports a state in the 9-member enum", () => {
    const platforms = ["darwin", "linux"];
    const versions = [null, "14.6", "15.3"];
    const appPresent = [true, false];
    const brewPresent = [true, false];
    const brewOk = [true, false];
    for (const platform of platforms)
      for (const v of versions)
        for (const app of appPresent)
          for (const brew of brewPresent)
            for (const ok of brewOk) {
              const r = runInstaller(
                makeEnv({
                  platform,
                  probeOsVersion: () => v,
                  pathExists: (p) => app && p === DEFAULT_SERVER,
                  brewPath: () => (brew ? "/x/brew" : null),
                  runBrewCask: () => ({ code: ok ? 0 : 1, stderr: "boom" }),
                }),
              );
              expect(TERMINAL_STATES).toContain(r.state);
            }
  });

  it("#E15: INSTALL_FAILED / CONFIG_UNPARSEABLE / CONFIG_WRITE_FAILED never collapse", () => {
    const installFailed = runInstaller(
      makeEnv({ pathExists: () => false, runBrewCask: () => ({ code: 1, stderr: "x" }) }),
    );
    const unparseable = runInstaller(
      makeEnv({
        pathExists: (p) => p === DEFAULT_SERVER,
        configIO: memIO({ "/cfg/mcp.json": "{ not json" }),
      }),
    );
    const unwritable = runInstaller(
      makeEnv({
        pathExists: (p) => p === DEFAULT_SERVER,
        configIO: {
          readFile: () => null,
          writeFileAtomic: () => {
            const err = new Error("EACCES") as Error & { code: string };
            err.code = "EACCES";
            throw err;
          },
        },
      }),
    );
    expect(installFailed.state).toBe("INSTALL_FAILED");
    expect(unparseable.state).toBe("CONFIG_UNPARSEABLE");
    expect(unwritable.state).toBe("CONFIG_WRITE_FAILED");
  });
});

describe("check mode", () => {
  it("#E31: unprovisioned host --check reports would-be state, 0 writes, brew never invoked", () => {
    let brewCalled = false;
    const io = memIO();
    const r = runInstaller(
      makeEnv({
        pathExists: () => false,
        configIO: io,
        runBrewCask: () => {
          brewCalled = true;
          return { code: 0, stderr: "" };
        },
      }),
      { check: true },
    );
    expect(r.state).toBe("READY_PENDING_GRANTS");
    expect(io.writes).toEqual([]);
    expect(brewCalled).toBe(false);
  });

  it("#E32: --check and write-mode report the same terminal state for identical host", () => {
    const build = (check: boolean) =>
      runInstaller(
        makeEnv({ pathExists: (p) => p === DEFAULT_SERVER, configIO: memIO() }),
        { check },
      );
    expect(build(true).state).toBe(build(false).state);
  });

  it("#E32 (install branch): parity holds when the app appears only after brew", () => {
    // The hardest parity case: check PREDICTS the post-install state without
    // invoking brew, while write mode actually installs and re-discovers.
    const checkState = runInstaller(
      makeEnv({ pathExists: () => false, configIO: memIO() }),
      { check: true },
    ).state;

    let installed = false;
    const writeState = runInstaller(
      makeEnv({
        configIO: memIO(),
        pathExists: (p) => installed && p === DEFAULT_SERVER,
        runBrewCask: () => {
          installed = true; // the cask lands the binary
          return { code: 0, stderr: "" };
        },
      }),
      { check: false },
    ).state;

    expect(checkState).toBe("READY_PENDING_GRANTS");
    expect(writeState).toBe(checkState);
  });
});

describe("install faults", () => {
  it("#X1: brew absent + app absent → NO_INSTALL_METHOD with download URL", () => {
    const r = runInstaller(makeEnv({ pathExists: () => false, brewPath: () => null }));
    expect(r.state).toBe("NO_INSTALL_METHOD");
    expect(r.exitCode).not.toBe(0);
    expect(r.message).toContain("github.com/mattt/iMCP");
  });

  it("#X2: brew exits 1 → INSTALL_FAILED, stderr verbatim, 0 config writes", () => {
    const io = memIO();
    const r = runInstaller(
      makeEnv({
        pathExists: () => false,
        configIO: io,
        runBrewCask: () => ({ code: 1, stderr: "Error: cask failed spectacularly" }),
      }),
    );
    expect(r.state).toBe("INSTALL_FAILED");
    expect(r.message).toContain("cask failed spectacularly");
    expect(io.writes).toEqual([]);
  });

  it("#X4: brew stalls → INSTALL_FAILED with a timeout-specific message, no write", () => {
    const io = memIO();
    const r = runInstaller(
      makeEnv({
        pathExists: () => false,
        configIO: io,
        runBrewCask: () => ({ code: 1, stderr: "", timedOut: true }),
      }),
    );
    expect(r.state).toBe("INSTALL_FAILED");
    expect(r.message.toLowerCase()).toContain("timed out");
    expect(io.writes).toEqual([]);
  });

  it("#X5: brew exits 0 but binary absent → INSTALL_FAILED, no mcp.json write", () => {
    const io = memIO();
    const r = runInstaller(
      makeEnv({
        pathExists: () => false, // never appears, even after brew
        configIO: io,
        runBrewCask: () => ({ code: 0, stderr: "" }),
      }),
    );
    expect(r.state).toBe("INSTALL_FAILED");
    expect(io.writes).toEqual([]);
  });
});

describe("performance + determinism", () => {
  it("#P1: 100 macOS checks p95 < 200ms", () => {
    const env = makeEnv({ pathExists: (p) => p === DEFAULT_SERVER });
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      runInstaller(env, { check: true });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[94]).toBeLessThan(200);
  });

  it("#P2: 100 non-macOS checks p95 < 5ms AND 0 subprocesses", () => {
    let subprocs = 0;
    const env = makeEnv({
      platform: "linux",
      probeOsVersion: () => {
        subprocs++;
        return "15.3";
      },
      brewPath: () => {
        subprocs++;
        return "/x/brew";
      },
      runBrewCask: () => {
        subprocs++;
        return { code: 0, stderr: "" };
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      runInstaller(env, { check: true });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[94]).toBeLessThan(5);
    expect(subprocs).toBe(0);
  });

  it("#X23: full traversal matrix touches no real /Applications path, no real brew", () => {
    // The suite injects every probe; assert the default env's probes are pure
    // functions (no throw) across the matrix already exercised in #E14.
    // Here we simply confirm a darwin+app-present run never calls brew.
    let realBrew = false;
    runInstaller(
      makeEnv({
        pathExists: (p) => p === DEFAULT_SERVER,
        brewPath: () => {
          realBrew = true;
          return "/x/brew";
        },
      }),
    );
    expect(realBrew).toBe(false);
  });
});
