/**
 * Tests for CLI argument parsing.
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "../cli.js";

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
