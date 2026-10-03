/**
 * Tests for the cross-platform restart orchestrator.
 * See change: fix-windows-server-parity.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { buildOrchestratorScript, buildRestartEnv, spawnRestart } from "../spawn-process/restart-helper.js";

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

  it("appends extra args (e.g. --dev) after the structural 'start' + '--port <n>' sequence", () => {
    // Since fix-restart-port-loss, '--port' + String(port) sits between
    // 'start' and extraArgs. See change: fix-restart-port-loss.
    const script = buildOrchestratorScript({ ...baseParams, port: 8000, extraArgs: ["--dev"] });
    expect(script).toMatch(/"start","--port","8000","--dev"/);
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

  // See change: fix-mode-aware-server-ready-deadlines.
  describe("mode-aware health-poll deadline", () => {
    it("embeds a 15000ms deadline (30 iterations) when dev is false / omitted", () => {
      const script = buildOrchestratorScript(baseParams);
      expect(script).toContain("const HEALTH_DEADLINE_MS = 15000");
      expect(script).toContain("const HEALTH_ITERATIONS = 30");
    });

    it("embeds a 60000ms deadline (120 iterations) when dev: true", () => {
      const script = buildOrchestratorScript({ ...baseParams, dev: true });
      expect(script).toContain("const HEALTH_DEADLINE_MS = 60000");
      expect(script).toContain("const HEALTH_ITERATIONS = 120");
    });

    it("failure-log message interpolates the deadline (no hard-coded '10s')", () => {
      const script = buildOrchestratorScript(baseParams);
      // The orchestrator computes the seconds value at runtime; the static
      // text must not contain a stale literal.
      expect(script).not.toContain("within 10s");
      expect(script).toContain("(HEALTH_DEADLINE_MS / 1000)");
    });

    it("poll loop bound is HEALTH_ITERATIONS, not a literal 20", () => {
      const script = buildOrchestratorScript(baseParams);
      expect(script).toMatch(/for \(let i = 0; i < HEALTH_ITERATIONS;/);
      expect(script).not.toMatch(/for \(let i = 0; i < 20;/);
    });
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

  /**
   * Pin the argv shape that preserves the bound port across restart.
   * See change: fix-restart-port-loss, spec server-restart — "Restart
   * orchestrator preserves the bound port".
   */
  describe("--port preservation (fix-restart-port-loss)", () => {
    /** Parses the `ARGS` array literal embedded in the orchestrator script. */
    function extractArgsArray(script: string): string[] {
      const m = script.match(/const ARGS = (\[[^\]]+\]);/);
      expect(m).not.toBeNull();
      // Safe: the array contains only JSON-serialized string literals.
      return JSON.parse(m![1]);
    }

    it("loader branch: --port appears after 'start' and before extraArgs", () => {
      const script = buildOrchestratorScript({ ...baseParams, port: 8001, extraArgs: ["--dev"] });
      const args = extractArgsArray(script);
      const startIdx = args.indexOf("start");
      const portFlagIdx = args.indexOf("--port");
      const portValIdx = portFlagIdx + 1;
      const devIdx = args.indexOf("--dev");
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(portFlagIdx).toBe(startIdx + 1);
      expect(args[portValIdx]).toBe("8001");
      expect(devIdx).toBe(portValIdx + 1);
    });

    it("bare-entry branch (loader=''): --port appears after 'start' and before extraArgs", () => {
      const script = buildOrchestratorScript({ ...baseParams, loader: "", port: 8001, extraArgs: ["--dev"] });
      const args = extractArgsArray(script);
      const startIdx = args.indexOf("start");
      const portFlagIdx = startIdx + 1;
      expect(args[portFlagIdx]).toBe("--port");
      expect(args[portFlagIdx + 1]).toBe("8001");
      expect(args[portFlagIdx + 2]).toBe("--dev");
    });

    it("caller-supplied --port in extraArgs appears AFTER the structural --port (caller wins via parseArgs left-to-right)", () => {
      const script = buildOrchestratorScript({ ...baseParams, loader: "", port: 8001, extraArgs: ["--port", "9000"] });
      const args = extractArgsArray(script);
      // First --port is structural (params.port=8001).
      const firstPortIdx = args.indexOf("--port");
      expect(args[firstPortIdx + 1]).toBe("8001");
      // Second --port is the caller-supplied override (9000).
      const secondPortIdx = args.indexOf("--port", firstPortIdx + 1);
      expect(secondPortIdx).toBeGreaterThan(firstPortIdx);
      expect(args[secondPortIdx + 1]).toBe("9000");
    });

    it("PORT constant stays equal to params.port (health-polling port matches bind port)", () => {
      const script = buildOrchestratorScript({ ...baseParams, port: 8001 });
      expect(script).toMatch(/const PORT = 8001/);
      const args = extractArgsArray(script);
      expect(args[args.indexOf("--port") + 1]).toBe("8001");
    });
  });
});

/**
 * The gateway port must survive a restart for exactly the same reason the
 * dashboard port must (`fix-restart-port-loss`): the spawned child re-resolves
 * config from CLI > env > file, and the file config normally carries no
 * `piPort`, so an un-propagated `--pi-port` silently falls back to the 9999
 * default. The bridge of every ALREADY-RUNNING pi session is still pointed at
 * the old gateway port, so it can never reconnect — sessions vanish from the
 * dashboard after a restart and never come back.
 *
 * Observed in the docker harness (gateway pinned to 19388 via PI_GATEWAY_PORT):
 *   Pi gateway listening on port 9999
 *   [crash-safety] uncaughtException (suppressed): listen EADDRINUSE 0.0.0.0:9999
 *
 * See change: restore-ask-user-tool-state-on-reconnect.
 */
describe("buildOrchestratorScript — gateway port preservation", () => {
  const baseParams = {
    cliPath: "/tmp/cli.ts",
    loader: "",
    port: 8000,
    extraArgs: [] as string[],
    execPath: "/usr/bin/node",
  };

  it("propagates a non-default --pi-port so running bridges can reconnect", () => {
    const script = buildOrchestratorScript({ ...baseParams, piPort: 19388 });
    expect(script).toMatch(/"start","--port","8000","--pi-port","19388"/);
  });

  it("keeps --pi-port before extraArgs so an explicit caller override still wins", () => {
    // cli.ts:parseArgs is left-to-right, last-occurrence-wins.
    const script = buildOrchestratorScript({
      ...baseParams,
      piPort: 19388,
      extraArgs: ["--dev"],
    });
    expect(script).toMatch(/"start","--port","8000","--pi-port","19388","--dev"/);
  });

  it("omits --pi-port when it is the 9999 default (nothing to preserve)", () => {
    const script = buildOrchestratorScript({ ...baseParams, piPort: 9999 });
    expect(script).not.toMatch(/"--pi-port"/);
    expect(script).toMatch(/"start","--port","8000"/);
  });

  it("omits --pi-port when unspecified, leaving pre-existing callers unchanged", () => {
    const script = buildOrchestratorScript(baseParams);
    expect(script).not.toMatch(/"--pi-port"/);
  });
});

// ── Ceiling re-stamp (design D5) ────────────────────────────────────────────
// The respawn re-reads the configured ceiling, so `/api/restart` both keeps
// it and applies an edit made since boot — without shadowing an operator pin.
// See change: guard-server-heap-and-store-coupling (test-plan #E11 #E12 #X9).

const { execSpawn } = vi.hoisted(() => ({
  execSpawn: vi.fn(() => ({ unref: () => {} })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/exec.js")>()),
  spawn: execSpawn,
}));

const MARKER = "PI_DASHBOARD_HEAP_FLAG";

describe("buildRestartEnv — ceiling survives /api/restart", () => {
  it("E11: carries the configured ceiling on an unchanged config", () => {
    const env = buildRestartEnv(
      { NODE_OPTIONS: "--max-old-space-size=1536", [MARKER]: "--max-old-space-size=1536" },
      1536,
    );
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=1536");
    expect(env[MARKER]).toBe("--max-old-space-size=1536");
  });

  it("E11: stamps a server that booted without one (e.g. no wrapper)", () => {
    const env = buildRestartEnv({ PATH: "/usr/bin" }, 1536);
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=1536");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("E12: adopts a ceiling edited since boot, with no duplicate token", () => {
    const env = buildRestartEnv(
      { NODE_OPTIONS: "--enable-source-maps --max-old-space-size=1536", [MARKER]: "--max-old-space-size=1536" },
      2048,
    );
    expect(env.NODE_OPTIONS).toBe("--enable-source-maps --max-old-space-size=2048");
    expect(env[MARKER]).toBe("--max-old-space-size=2048");
  });

  it("X9: leaves an operator pin untouched and adds nothing", () => {
    const env = buildRestartEnv({ NODE_OPTIONS: "--max_old_space_size=4096" }, 2048);
    expect(env.NODE_OPTIONS).toBe("--max_old_space_size=4096");
    expect(env).not.toHaveProperty(MARKER);
  });

  it("does not mutate the caller's env", () => {
    const base = { NODE_OPTIONS: "--enable-source-maps" };
    buildRestartEnv(base, 1536);
    expect(base).toEqual({ NODE_OPTIONS: "--enable-source-maps" });
  });
});

describe("spawnRestart re-reads config.json at restart time", () => {
  it("E12: the orchestrator env carries the ceiling from the CURRENT config file", () => {
    const dir = path.join(os.homedir(), ".pi", "dashboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ serverHeap: { maxOldSpaceMb: 3072 } }));
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=1536");
    vi.stubEnv(MARKER, "--max-old-space-size=1536");
    try {
      spawnRestart({ cliPath: "/tmp/cli.ts", loader: "", port: 8000, extraArgs: [], execPath: "/usr/bin/node" });
    } finally {
      vi.unstubAllEnvs();
    }
    const opts = (execSpawn.mock.calls.at(-1) as unknown[])[2] as { env: Record<string, string> };
    expect(opts.env.NODE_OPTIONS).toBe("--max-old-space-size=3072");
    expect(opts.env[MARKER]).toBe("--max-old-space-size=3072");
  });

  // Orchestrator env = buildRestartEnv(process.env, ceiling): the ceiling replaces
  // a stale NODE_OPTIONS pin of ours and other keys are copied (test-plan #E17).
  // See change: cleanup-stale-fork-specs.
  it("E17: the spawn env equals buildRestartEnv(process.env, configured ceiling)", () => {
    const dir = path.join(os.homedir(), ".pi", "dashboard");
    const configFile = path.join(dir, "config.json");
    const prior = existsSync(configFile) ? readFileSync(configFile, "utf-8") : null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile, JSON.stringify({ serverHeap: { maxOldSpaceMb: 4096 } }));
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=1024");
    vi.stubEnv(MARKER, "--max-old-space-size=1024");
    let expected: Record<string, string | undefined>;
    try {
      expected = buildRestartEnv(process.env, 4096);
      spawnRestart({ cliPath: "/tmp/cli.ts", loader: "", port: 8000, extraArgs: [], execPath: "/usr/bin/node" });
    } finally {
      vi.unstubAllEnvs();
      if (prior === null) rmSync(configFile, { force: true });
      else writeFileSync(configFile, prior);
    }
    const opts = (execSpawn.mock.calls.at(-1) as unknown[])[2] as { env: Record<string, string> };
    expect(opts.env).toEqual(expected);
    expect(opts.env.NODE_OPTIONS).toContain("--max-old-space-size=4096");
    expect(opts.env.NODE_OPTIONS).not.toContain("1024");
  });
});
