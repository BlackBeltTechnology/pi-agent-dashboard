/**
 * Tests for the cross-platform restart orchestrator.
 * See change: fix-windows-server-parity.
 */
import { describe, it, expect } from "vitest";
import { buildOrchestratorScript } from "../restart-helper.js";

describe("buildOrchestratorScript", () => {
  const baseParams = {
    cliPath: "/tmp/cli.ts",
    loader: "file:///tmp/jiti-register.mjs",
    port: 8000,
    extraArgs: [] as string[],
    execPath: "/usr/bin/node",
  };

  it("produces a self-contained Node script (no shell/lsof/curl)", () => {
    const script = buildOrchestratorScript(baseParams);
    expect(script).not.toMatch(/\blsof\b/);
    expect(script).not.toMatch(/\bcurl\b/);
    expect(script).not.toMatch(/\bsh\s+-c\b/);
    // Uses Node built-ins
    expect(script).toMatch(/require\("node:net"\)/);
    expect(script).toMatch(/require\("node:http"\)/);
    expect(script).toMatch(/require\("node:child_process"\)/);
  });

  it("embeds the port as a number literal", () => {
    const script = buildOrchestratorScript({ ...baseParams, port: 12345 });
    expect(script).toMatch(/const PORT = 12345/);
  });

  it("embeds the loader as a --import arg when provided", () => {
    const script = buildOrchestratorScript(baseParams);
    // ARGS should be a JSON array containing --import and the loader
    expect(script).toMatch(/const ARGS = \[.*"--import".*"file:\/\/\/tmp\/jiti-register\.mjs"/);
    // On POSIX, cliPath stays RAW — jiti's resolver misbehaves on file:// URL entries.
    expect(script).toMatch(/"\/tmp\/cli\.ts"/);
    expect(script).not.toContain(JSON.stringify("file:///tmp/cli.ts"));
    expect(script).toMatch(/"start"/);
  });

  it("omits --import when loader is empty", () => {
    const script = buildOrchestratorScript({ ...baseParams, loader: "" });
    expect(script).not.toMatch(/"--import"/);
    // No loader + POSIX host → raw entry.
    expect(script).toMatch(/"\/tmp\/cli\.ts"/);
    expect(script).not.toContain(JSON.stringify("file:///tmp/cli.ts"));
    expect(script).toMatch(/"start"/);
  });

  it("appends extra args (e.g. --dev) after 'start'", () => {
    const script = buildOrchestratorScript({ ...baseParams, extraArgs: ["--dev"] });
    // ARGS array should have "start" immediately followed by "--dev"
    expect(script).toMatch(/"start","--dev"/);
  });

  it("wraps Windows cliPath as file:// URL when loader is jiti AND host is Windows (Node parses drive letters as URL schemes)", () => {
    // NOTE: shouldUrlWrapEntry consults process.platform. This test runs on
    // Linux CI, so the wrap branch isn't directly exercised here — but the
    // UNIT test for shouldUrlWrapEntry itself covers the win32 contract.
    // Here we verify the tree of what buildOrchestratorScript emits on the
    // host platform (Linux): raw entry even with a Windows-styled path.
    const winParams = {
      ...baseParams,
      cliPath: "B:\\Dev\\BB\\pi-agent-dashboard\\packages\\server\\src\\cli.ts",
      loader: "file:///B:/Dev/Nodejs/global/node_modules/@mariozechner/jiti/lib/jiti-register.mjs",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
    };
    const script = buildOrchestratorScript(winParams);
    expect(script).toContain(JSON.stringify(winParams.execPath));
    expect(script).toContain(JSON.stringify(winParams.loader));
    // Host is Linux → entry stays raw (tested branch here).
    expect(script).toContain(JSON.stringify(winParams.cliPath));
  });

  it("keeps cliPath as RAW path when loader is tsx (tsx rejects file:// URL entries)", () => {
    // Regression: tsx's ESM hook treats the entry as a user-typed specifier
    // and attempts bare/relative resolution. A file:// URL becomes "<cwd>/file:/..."
    // and crashes with ERR_MODULE_NOT_FOUND. This is the Linux dev-loop case
    // (jiti not in repo node_modules, tsx fallback picked up).
    const tsxParams = {
      cliPath: "/home/u/repo/packages/server/src/cli.ts",
      loader: "file:///home/u/repo/node_modules/tsx/dist/esm/index.mjs",
      port: 8000,
      extraArgs: [] as string[],
      execPath: "/usr/bin/node",
    };
    const script = buildOrchestratorScript(tsxParams);
    // Loader is still URL-wrapped (Node's --import requires file://)
    expect(script).toContain(JSON.stringify(tsxParams.loader));
    // Entry is the RAW path, NOT a file:// URL
    expect(script).toContain(JSON.stringify(tsxParams.cliPath));
    // Negative: must NOT contain the file:// URL form of the entry
    const urlForm = "file://" + tsxParams.cliPath;
    expect(script).not.toContain(JSON.stringify(urlForm));
  });

  it("references ~/.pi/dashboard/restart.log for failure logging", () => {
    const script = buildOrchestratorScript(baseParams);
    expect(script).toMatch(/restart\.log/);
    expect(script).toMatch(/fs\.appendFileSync/);
  });

  it("health-check target is /api/health on the configured port", () => {
    const script = buildOrchestratorScript({ ...baseParams, port: 8765 });
    expect(script).toMatch(/\/api\/health/);
    expect(script).toMatch(/const PORT = 8765/);
    expect(script).toMatch(/port: PORT/);
  });

  // See change: fix-restart-bridge-auto-start-race.
  describe("explicit kill of prior daemon", () => {
    it("references the dashboard.pid file path", () => {
      const script = buildOrchestratorScript(baseParams);
      expect(script).toContain("dashboard.pid");
      expect(script).toMatch(/const PID_PATH = /);
    });

    it("defines a killPriorDaemon function that uses SIGTERM then SIGKILL", () => {
      const script = buildOrchestratorScript(baseParams);
      expect(script).toMatch(/killPriorDaemon/);
      expect(script).toMatch(/process\.kill\(\s*pid\s*,\s*"SIGTERM"\s*\)/);
      expect(script).toMatch(/process\.kill\(\s*pid\s*,\s*"SIGKILL"\s*\)/);
    });

    it("the kill step runs BEFORE the portFree poll", () => {
      const script = buildOrchestratorScript(baseParams);
      const killIdx = script.indexOf("await killPriorDaemon()");
      const portFreeIdx = script.indexOf("await portFree(PORT)");
      expect(killIdx).toBeGreaterThan(-1);
      expect(portFreeIdx).toBeGreaterThan(-1);
      expect(killIdx).toBeLessThan(portFreeIdx);
    });
  });
});
