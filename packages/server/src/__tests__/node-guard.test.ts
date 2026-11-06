import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sharedNodeVersion from "@blackbelt-technology/pi-dashboard-shared/node-version.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeGuard from "../auth/node-guard.js";
import {
  assertNodeVersionSupported,
  buildEnginesRangeMessage,
  foreignTsLoaderWarning,
  isOutOfEnginesRange,
  warnTsLoaderState,
} from "../auth/node-guard.js";

// Pass-through spies so the #E4 "no Node spawned" assertion can observe any
// child-process call made while building the message.
const childProcessSpies = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"] as const) {
    const fn = vi.fn((...args: unknown[]) => (actual[name] as (...a: unknown[]) => unknown)(...args));
    childProcessSpies[name] = fn;
    wrapped[name] = fn;
  }
  return { ...wrapped, default: wrapped };
});

describe("node-guard re-exports the shared canonical predicate", () => {
  it("isOutOfEnginesRange is the same reference as the shared source", () => {
    expect(isOutOfEnginesRange).toBe(sharedNodeVersion.isOutOfEnginesRange);
  });

  it("no longer exports the #58515 startup helpers", () => {
    expect("buildNodeUpgradeMessage" in nodeGuard).toBe(false);
    expect("isAffectedNode" in nodeGuard).toBe(false);
  });
});

describe("isOutOfEnginesRange (>=26.0.0 <27)", () => {
  it("refuses 22.x, 24.x, 25.x and 27+", () => {
    for (const v of ["v20.15.0", "v22.18.0", "v22.19.0", "v22.22.2", "v24.15.0", "v25.9.0", "v27.0.0", "v28.1.0"]) {
      expect(isOutOfEnginesRange(v), v).toBe(true);
    }
  });

  it("accepts 26.x", () => {
    for (const v of ["v26.0.0", "v26.8.1", "26.13.0"]) {
      expect(isOutOfEnginesRange(v), v).toBe(false);
    }
  });

  it("returns false for malformed input rather than throwing", () => {
    expect(isOutOfEnginesRange("")).toBe(false);
    expect(isOutOfEnginesRange("not-a-version")).toBe(false);
  });
});

// test-plan #E3
describe("assertNodeVersionSupported", () => {
  const realVersion = process.version;
  afterEach(() => {
    Object.defineProperty(process, "version", { value: realVersion, configurable: true });
    vi.restoreAllMocks();
  });

  function runUnder(version: string): { exitCode: number | undefined; stderr: string } {
    Object.defineProperty(process, "version", { value: version, configurable: true });
    let stderr = "";
    vi.spyOn(console, "error").mockImplementation((m: unknown) => {
      stderr += String(m);
    });
    let exitCode: number | undefined;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error("__exit__");
    }) as never);
    try {
      assertNodeVersionSupported();
    } catch (e) {
      if ((e as Error).message !== "__exit__") throw e;
    }
    return { exitCode, stderr };
  }

  it("exits 1 on Node 24.15.0 with the engines-range message and no #58515 text", () => {
    const { exitCode, stderr } = runUnder("v24.15.0");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Required: >=26.0.0 <27");
    expect(stderr).not.toContain("58515");
  });

  it("exits 1 on Node 22.18.0 (formerly the #58515 path) with the engines-range message only", () => {
    const { exitCode, stderr } = runUnder("v22.18.0");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Required: >=26.0.0 <27");
    expect(stderr).not.toContain("58515");
  });

  it("returns normally on Node 26.0.0", () => {
    const { exitCode, stderr } = runUnder("v26.0.0");
    expect(exitCode).toBeUndefined();
    expect(stderr).toBe("");
  });
});

describe("buildEnginesRangeMessage", () => {
  it("interpolates the running version", () => {
    expect(buildEnginesRangeMessage("v27.0.0")).toContain("v27.0.0");
  });

  it("names the engines range", () => {
    expect(buildEnginesRangeMessage("v24.15.0")).toContain("Required: >=26.0.0 <27");
  });

  it("explains the EBADENGINE / engines-range link", () => {
    const msg = buildEnginesRangeMessage("v24.15.0");
    expect(msg).toMatch(/EBADENGINE/);
    expect(msg).toMatch(/floor/);
  });

  it("names Node 26 for nvm and never an out-of-range brew line", () => {
    const msg = buildEnginesRangeMessage("v24.15.0", { managedNodeExists: false });
    expect(msg).toContain("nvm install 26");
    expect(msg).toContain("brew install node");
    expect(msg).not.toMatch(/node@2[0-5]/);
    expect(msg).not.toContain("nvm install 24");
  });

  it("names the version, the range, and every remediation route when a managed Node qualifies", () => {
    const msg = buildEnginesRangeMessage("v27.0.0", { managedNodeExists: true });
    expect(msg).toContain("cannot start on Node v27.");
    expect(msg).toContain("Required: >=26.0.0 <27");
    expect(msg).toContain("nvm install");
    expect(msg).toContain('PATH="$HOME/.pi-dashboard/node/bin');
    expect(msg).toContain("brew install node");
  });

  // Managed PATH hint is emitted ONLY when `<managedDir>/node/` holds a
  // runtime whose `.version` marker meets the engines range (test-plan #E4).
  describe("managed-Node hint marker probe (test-plan #E4)", () => {
    let managedDir: string;

    beforeEach(() => {
      managedDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-guard-managed-"));
    });

    afterEach(() => {
      fs.rmSync(managedDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    const writeMarker = (content: string | null): void => {
      fs.mkdirSync(path.join(managedDir, "node"), { recursive: true });
      if (content !== null) fs.writeFileSync(path.join(managedDir, "node", ".version"), content);
    };

    it("omits the hint when no managed runtime exists", () => {
      const msg = buildEnginesRangeMessage("v24.15.0", { managedDir });
      expect(msg).not.toContain(".pi-dashboard");
      expect(msg).toContain("nvm install 26");
      expect(msg).toContain("brew install node");
    });

    it("omits the hint when the marker is absent", () => {
      writeMarker(null);
      expect(buildEnginesRangeMessage("v24.15.0", { managedDir })).not.toContain(".pi-dashboard");
    });

    it("omits the hint for a below-floor managed Node (v24.15.0)", () => {
      writeMarker("v24.15.0\n");
      const msg = buildEnginesRangeMessage("v24.15.0", { managedDir });
      expect(msg).not.toContain(".pi-dashboard");
      expect(msg).toContain("nvm install 26");
    });

    it("omits the hint when the marker is unreadable", () => {
      fs.mkdirSync(path.join(managedDir, "node", ".version"), { recursive: true }); // a dir → EISDIR
      expect(buildEnginesRangeMessage("v24.15.0", { managedDir })).not.toContain(".pi-dashboard");
    });

    it("emits the hint for a qualifying managed Node (v26.1.0)", () => {
      writeMarker("v26.1.0\n");
      const msg = buildEnginesRangeMessage("v24.15.0", { managedDir });
      expect(msg).toContain('PATH="$HOME/.pi-dashboard/node/bin');
      expect(msg).toContain("nvm install 26");
      expect(msg).toContain("brew install node");
    });
  });

  it("reads the marker without spawning Node", async () => {
    const cp = await import("node:child_process");
    for (const fn of Object.values(childProcessSpies)) fn.mockClear();
    buildEnginesRangeMessage("v24.15.0");
    buildEnginesRangeMessage("v24.15.0", { managedDir: os.tmpdir() });
    for (const [name, fn] of Object.entries(childProcessSpies)) {
      expect(fn, name).not.toHaveBeenCalled();
    }
    expect(cp.spawnSync).toBe(childProcessSpies.spawnSync);
  });
});

// See change: strip-only-native-ts-loader (test-plan #E14, #E18).
describe("foreignTsLoaderWarning (#E18)", () => {
  const NATIVE = "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs";
  const JITI = "file:///x/node_modules/jiti/lib/jiti-register.mjs";
  const TSX = "file:///x/node_modules/tsx/dist/loader.mjs";

  it("warns once naming jiti and the stop/start recovery", () => {
    const msg = foreignTsLoaderWarning(["--import", JITI]);
    expect(msg).toContain("jiti");
    expect(msg).toContain("pi-dashboard stop && pi-dashboard start");
  });

  it("recognises the combined --import=<url> spelling", () => {
    expect(foreignTsLoaderWarning([`--import=${JITI}`])).toContain("jiti");
  });

  it("warns for tsx, naming it", () => {
    expect(foreignTsLoaderWarning(["--import", TSX])).toContain("tsx");
  });

  it.each([[["--import", NATIVE]], [[]], [["--max-old-space-size=512"]]])("is silent for %j", (argv) => {
    expect(foreignTsLoaderWarning(argv)).toBeNull();
  });
});

describe("warnTsLoaderState (#E14, #E18)", () => {
  const NATIVE = "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs";

  it.each([[undefined], [""], ["native"]])("PI_DASHBOARD_TS_LOADER=%s → 0 warnings", (value) => {
    const warn = vi.fn();
    warnTsLoaderState(value === undefined ? {} : { PI_DASHBOARD_TS_LOADER: value }, ["--import", NATIVE], warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([["jiti"], ["tsx"], ["garbage"]])("PI_DASHBOARD_TS_LOADER=%s → exactly 1 warning naming the variable", (value) => {
    const warn = vi.fn();
    warnTsLoaderState({ PI_DASHBOARD_TS_LOADER: value }, ["--import", NATIVE], warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("PI_DASHBOARD_TS_LOADER");
  });

  it("foreign loader and legacy env var are reported separately", () => {
    const warn = vi.fn();
    warnTsLoaderState({ PI_DASHBOARD_TS_LOADER: "jiti" }, ["--import", "file:///x/node_modules/jiti/lib/jiti-register.mjs"], warn);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
