/**
 * Doctor probe tests (#X16 package-absent isolation, #X17 read-only,
 * #X18 doctor/CLI parity, #X19 non-macOS not a fault).
 * See change: add-apple-tools-imcp-plugin.
 */
import { describe, expect, it } from "vitest";
import { doctorProbe } from "../doctor.js";
import { type InstallerEnv, runInstaller } from "../install.js";
import type { ConfigIO } from "../mcp-config.js";

const SERVER = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

function memIO(files: Record<string, string> = {}): ConfigIO & { writes: string[] } {
  const store = { ...files };
  const writes: string[] = [];
  return {
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
    homedir: "/home/tester",
    probeOsVersion: () => "15.3",
    pathExists: (p) => p === SERVER,
    brewPath: () => "/x/brew",
    runBrewCask: () => ({ code: 0, stderr: "" }),
    mcpJsonPath: "/cfg/mcp.json",
    settingsJsonPath: "/cfg/settings.json",
    configIO: memIO(),
    ...overrides,
  };
}

describe("doctorProbe", () => {
  it("#X16: reports package absent without disturbing the verdict", () => {
    const r = doctorProbe(makeEnv(), false);
    expect(r.packagePresent).toBe(false);
    expect(r.state).toBe("READY_PENDING_GRANTS");
  });

  it("#X17: read-only — 0 config writes, 0 install attempts", () => {
    const io = memIO();
    let brewCalled = false;
    doctorProbe(
      makeEnv({
        configIO: io,
        pathExists: () => false,
        runBrewCask: () => {
          brewCalled = true;
          return { code: 0, stderr: "" };
        },
      }),
      true,
    );
    expect(io.writes).toEqual([]);
    expect(brewCalled).toBe(false);
  });

  it("#X18: doctor verdict == CLI --check terminal state for the same host", () => {
    const env = makeEnv({ pathExists: () => false, probeOsVersion: () => "14.6" });
    expect(doctorProbe(env, true).state).toBe(runInstaller(env, { check: true }).state);
  });

  it("a macOS host with brew but NO iMCP requires remediation (real-host QA regression)", () => {
    // The predicted state is healthy (brew could install it), but the operator
    // still has to act — a doctor that reports "nothing to fix" here is useless.
    const r = doctorProbe(makeEnv({ pathExists: () => false }), true);
    expect(r.state).toBe("READY_PENDING_GRANTS");
    expect(r.appPresent).toBe(false);
    expect(r.requiresRemediation).toBe(true);
  });

  it("a genuinely provisioned macOS host requires NO remediation", () => {
    const r = doctorProbe(makeEnv(), true);
    expect(r.appPresent).toBe(true);
    expect(r.requiresRemediation).toBe(false);
  });

  it("#X19: non-macOS → unsupported, NOT flagged for remediation", () => {
    const r = doctorProbe(makeEnv({ platform: "linux" }), true);
    expect(r.supported).toBe(false);
    expect(r.state).toBe("UNSUPPORTED_PLATFORM");
    expect(r.requiresRemediation).toBe(false);
  });
});
