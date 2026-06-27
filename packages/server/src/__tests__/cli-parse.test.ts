/**
 * Tests for CLI argument parsing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs, buildConfig } from "../cli.js";

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
