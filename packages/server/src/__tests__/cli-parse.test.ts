/**
 * Tests for CLI argument parsing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs, buildConfig, guardTempHomePort, PRODUCTION_DEFAULT_PORT } from "../cli.js";

describe("parseArgs", () => {
  it("returns null subcommand with no args", () => {
    const result = parseArgs([]);
    expect(result.subcommand).toBeNull();
    expect(result.flags).toEqual({});
  });

  it("parses start subcommand", () => {
    const result = parseArgs(["start"]);
    expect(result.subcommand).toBe("start");
  });

  it("parses stop subcommand", () => {
    const result = parseArgs(["stop"]);
    expect(result.subcommand).toBe("stop");
  });

  it("parses restart subcommand", () => {
    const result = parseArgs(["restart"]);
    expect(result.subcommand).toBe("restart");
  });

  it("parses status subcommand", () => {
    const result = parseArgs(["status"]);
    expect(result.subcommand).toBe("status");
  });

  // NOTE: `upgrade-pi` subcommand tests removed.
  // The `upgrade-pi` subcommand was deliberately removed in change
  // `eliminate-electron-runtime-install` (tasks 3.0.a + 3.5b, 2026-05-23)
  // when bootstrap-install was deleted. `SUBCOMMANDS` is now
  // `["start", "stop", "restart", "status"]`. The pi-core upgrade path
  // survives via the `POST /api/pi-core/update` REST endpoint instead.
  // These two tests were documented as deferred to a "Phase 3.9 sweep"
  // in eliminate-electron-runtime-install/tasks.md task 5.9; this is
  // that sweep.

  it("parses subcommand with flags", () => {
    const result = parseArgs(["start", "--port", "3000", "--pi-port", "4000"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.port).toBe(3000);
    expect(result.flags.piPort).toBe(4000);
  });

  it("parses flags without subcommand (foreground mode)", () => {
    const result = parseArgs(["--port", "3000", "--dev"]);
    expect(result.subcommand).toBeNull();
    expect(result.flags.port).toBe(3000);
    expect(result.flags.dev).toBe(true);
  });

  it("parses --host flag", () => {
    const result = parseArgs(["start", "--host", "0.0.0.0"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.host).toBe("0.0.0.0");
  });

  it("parses --no-tunnel flag", () => {
    const result = parseArgs(["start", "--no-tunnel"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.tunnel).toBe(false);
  });

  // fix-autostart-discovery-precedence (5.1, D5): ephemeral is a FLAG-only
  // opt-in — no env var, no inference — so it parses like --dev.
  it("parses --ephemeral flag", () => {
    const result = parseArgs(["start", "--ephemeral"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.ephemeral).toBe(true);
  });

  it("defaults ephemeral to unset when the flag is absent", () => {
    const result = parseArgs(["start"]);
    expect(result.flags.ephemeral).toBeUndefined();
  });

  it("ignores unknown args", () => {
    const result = parseArgs(["start", "--unknown", "value"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags).toEqual({});
  });

  it("does not treat flag values as subcommands", () => {
    const result = parseArgs(["--port", "3000"]);
    expect(result.subcommand).toBeNull();
    expect(result.flags.port).toBe(3000);
  });
});

describe("guardTempHomePort", () => {
  const tmp = "/tmp";
  const noop = () => {};

  it("remaps the production port to an ephemeral 0 under a temp/faux HOME", () => {
    expect(guardTempHomePort(PRODUCTION_DEFAULT_PORT, "/tmp/faux-home-abc", tmp, noop)).toBe(0);
  });

  it("leaves the production port alone under a real HOME", () => {
    expect(guardTempHomePort(PRODUCTION_DEFAULT_PORT, "/Users/robson", tmp, noop)).toBe(
      PRODUCTION_DEFAULT_PORT,
    );
  });

  it("leaves a non-production port alone even under a temp HOME (test servers use random ports)", () => {
    expect(guardTempHomePort(8300, "/tmp/faux", tmp, noop)).toBe(8300);
  });

  it("does not treat a sibling dir (/tmpfoo) as living under /tmp", () => {
    expect(guardTempHomePort(PRODUCTION_DEFAULT_PORT, "/tmpfoo/home", tmp, noop)).toBe(
      PRODUCTION_DEFAULT_PORT,
    );
  });

  it("passes a null (already-ephemeral) port through unchanged", () => {
    expect(guardTempHomePort(null, "/tmp/faux", tmp, noop)).toBeNull();
  });

  it("warns when it remaps", () => {
    let msg = "";
    guardTempHomePort(PRODUCTION_DEFAULT_PORT, "/tmp/faux", tmp, (m) => {
      msg = m;
    });
    expect(msg).toContain("ephemeral");
    expect(msg).toContain(String(PRODUCTION_DEFAULT_PORT));
  });
});

describe("buildConfig host resolution", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;
  let origEnvHost: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-bindhost-"));
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    origEnvHost = process.env.PI_DASHBOARD_HOST;
    process.env.HOME = testDir;
    delete process.env.PI_DASHBOARD_HOST;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origEnvHost === undefined) delete process.env.PI_DASHBOARD_HOST;
    else process.env.PI_DASHBOARD_HOST = origEnvHost;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to 127.0.0.1 when nothing configured", () => {
    expect(buildConfig({}).host).toBe("127.0.0.1");
  });

  it("config.bindHost overrides default", () => {
    fs.writeFileSync(configFile, JSON.stringify({ bindHost: "10.0.0.5" }));
    expect(buildConfig({}).host).toBe("10.0.0.5");
  });

  it("PI_DASHBOARD_HOST env overrides config", () => {
    fs.writeFileSync(configFile, JSON.stringify({ bindHost: "10.0.0.5" }));
    process.env.PI_DASHBOARD_HOST = "0.0.0.0";
    expect(buildConfig({}).host).toBe("0.0.0.0");
  });

  it("--host flag overrides env and config", () => {
    fs.writeFileSync(configFile, JSON.stringify({ bindHost: "10.0.0.5" }));
    process.env.PI_DASHBOARD_HOST = "0.0.0.0";
    expect(buildConfig({ host: "127.0.0.1" }).host).toBe("127.0.0.1");
  });

  // Integration: HOME here (testDir) is under os.tmpdir(), so the temp-home port
  // guard is wired through buildConfig — an explicit --port 8000 must be remapped
  // to an ephemeral port so a test/isolated server can never shadow a real
  // dashboard on localhost:8000. See change: guard-temp-home-production-port.
  it("remaps an explicit production port 8000 to ephemeral under a temp HOME", () => {
    expect(buildConfig({ port: PRODUCTION_DEFAULT_PORT }).port).toBe(0);
  });

  it("passes a non-production port through untouched under a temp HOME", () => {
    expect(buildConfig({ port: 8300 }).port).toBe(8300);
  });
});

describe("daemon spawn jiti resolution", () => {
  it("ToolResolver.resolveJiti either returns a file:// URL or null", async () => {
    // After change `unify-server-launch-ts-loader`, jiti resolution
    // is owned by `ToolResolver.resolveJiti()` which walks managed pi
    // → system pi → anchor → argv. Vitest's transitive `jiti` dep
    // makes resolution likely succeed under the test runner; either
    // outcome is valid — we just assert the contract: success returns
    // a `file://` URL, miss returns null (no throw).
    const { ToolResolver } = await import(
      "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js"
    );
    const url = new ToolResolver().resolveJiti();
    if (url !== null) {
      expect(url.startsWith("file://")).toBe(true);
    } else {
      expect(url).toBeNull();
    }
  });
});
