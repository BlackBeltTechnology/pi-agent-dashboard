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
    expect(script).toMatch(/"\/tmp\/cli\.ts"/);
    expect(script).toMatch(/"start"/);
  });

  it("omits --import when loader is empty", () => {
    const script = buildOrchestratorScript({ ...baseParams, loader: "" });
    expect(script).not.toMatch(/"--import"/);
    expect(script).toMatch(/"\/tmp\/cli\.ts"/);
    expect(script).toMatch(/"start"/);
  });

  it("appends extra args (e.g. --dev) after 'start'", () => {
    const script = buildOrchestratorScript({ ...baseParams, extraArgs: ["--dev"] });
    // ARGS array should have "start" immediately followed by "--dev"
    expect(script).toMatch(/"start","--dev"/);
  });

  it("safely embeds Windows paths with backslashes and drive letters", () => {
    const winParams = {
      ...baseParams,
      cliPath: "B:\\Dev\\BB\\pi-agent-dashboard\\packages\\server\\src\\cli.ts",
      loader: "file:///B:/Dev/Nodejs/global/node_modules/@mariozechner/jiti/lib/jiti-register.mjs",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
    };
    const script = buildOrchestratorScript(winParams);
    // Must be embedded via JSON.stringify (backslashes escaped, quotes preserved)
    expect(script).toContain(JSON.stringify(winParams.execPath));
    expect(script).toContain(JSON.stringify(winParams.cliPath));
    expect(script).toContain(JSON.stringify(winParams.loader));
    // Should not contain raw unescaped backslashes that would break the JS
    // (we embed via JSON.stringify which escapes them to \\)
    expect(script).toMatch(/B:\\\\Dev\\\\BB/);
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
});
