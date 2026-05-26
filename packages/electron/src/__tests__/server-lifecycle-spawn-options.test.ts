import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildServerSpawnOptions,
  buildServerStartupError,
  SERVER_READY_DEADLINE_MS,
  SERVER_READY_DEADLINE_DEV_MS,
  getServerReadyDeadlineMs,
} from "../lib/server-lifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("buildServerSpawnOptions", () => {
  it("passes detach: false so the server stays inside Electron's Job Object on Windows", () => {
    const opts = buildServerSpawnOptions({
      cmd: "C:\\bin\\tsx.cmd",
      args: ["cli.ts", "--port", "8000"],
      env: { PATH: "/usr/bin" },
      cwd: "C:\\app",
      logFd: 7,
    });
    expect(opts.detach).toBe(false);
  });

  it("preserves cmd, args, env, cwd, logFd unchanged", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", NODE_PATH: "/lib" };
    const opts = buildServerSpawnOptions({
      cmd: "tsx",
      args: ["cli.ts", "--port", "8000", "--pi-port", "9999"],
      env,
      cwd: "/app",
      logFd: 42,
    });
    expect(opts.cmd).toBe("tsx");
    expect(opts.args).toEqual(["cli.ts", "--port", "8000", "--pi-port", "9999"]);
    expect(opts.env).toBe(env);
    expect(opts.cwd).toBe("/app");
    expect(opts.logFd).toBe(42);
  });

  it("handles undefined logFd (log-open failed path)", () => {
    const opts = buildServerSpawnOptions({
      cmd: "tsx",
      args: [],
      env: {},
      cwd: "/app",
      logFd: undefined,
    });
    expect(opts.logFd).toBeUndefined();
    expect(opts.detach).toBe(false);
  });
});

describe("server-lifecycle.ts invariant", () => {
  it("contains no direct spawnDetached call that bypasses buildServerSpawnOptions (would drop detach:false)", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/server-lifecycle.ts"), "utf-8");
    // Collect every spawnDetached call site.
    const callRe = /spawnDetached\s*\(([^)]*)\)/g;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) matches.push(m[1].trim());
    // Every call MUST be routed through buildServerSpawnOptions (or be a
    // different variant — but today there's only the server launch).
    for (const arg of matches) {
      expect(arg).toMatch(/buildServerSpawnOptions/);
    }
  });

  it("buildServerSpawnOptions source explicitly sets detach: false", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/server-lifecycle.ts"), "utf-8");
    expect(src).toMatch(/detach:\s*false/);
  });
});

describe("launchViaCli error decoration", () => {
  // See change: fix-electron-appimage-cli-self-detection (Task 4 / D5).
  it("includes a `readlink -f` diagnostic hint in the timeout error message", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/server-lifecycle.ts"), "utf-8");
    // The launchViaCli timeout branch must mention the readlink hint so
    // a slipped-through self-recursion case is recognizable from the
    // error dialog alone.
    expect(src).toContain("readlink -f");
  });

  it("includes the resolved candidate path in the timeout error message", () => {
    const src = readFileSync(path.resolve(__dirname, "../lib/server-lifecycle.ts"), "utf-8");
    expect(src).toMatch(/Resolved CLI path:/);
  });
});

describe("ensureServer fall-through invariant", () => {
  // See change: fix-electron-appimage-cli-self-detection (Task 5).
  // ensureServer's power-user branch MUST stay shaped as:
  //   const cli = detectPiDashboardCli();
  //   if (cli.found && cli.path) { await launchViaCli(...); return ...; }
  //   // fall through
  //   await launchServer(config.port, config.piPort);
  // so an AppImage rejection in detectPiDashboardCli (returning
  // { found: false }) reliably falls through to the standalone tsx +
  // cli.ts path. Source-level test — a runtime test would have to boot
  // a real HTTP server.
  const src = readFileSync(path.resolve(__dirname, "../lib/server-lifecycle.ts"), "utf-8");

  it("gates the CLI launch on cli.found && cli.path", () => {
    expect(src).toMatch(/if\s*\(\s*cli\.found\s*&&\s*cli\.path\s*\)/);
  });

  it("calls launchServer after the gated CLI branch", () => {
    expect(src).toContain("launchServer(config.port, config.piPort)");
  });
});

// ── Defect 4 / D4 ──────────────────────────────────────────────────────────
// Server-startup deadline + cause-aware error wording. See change:
// fix-electron-windows-installer-and-server-bootstrap.

describe("SERVER_READY_DEADLINE_MS", () => {
  it("is 15000 (15 seconds) — see change tighten-electron-server-startup-deadline", () => {
    expect(SERVER_READY_DEADLINE_MS).toBe(15_000);
  });

  // See change: fix-mode-aware-server-ready-deadlines.
  it("SERVER_READY_DEADLINE_DEV_MS is 60000 (60 seconds) for the dev-monorepo path", () => {
    expect(SERVER_READY_DEADLINE_DEV_MS).toBe(60_000);
  });

  it("getServerReadyDeadlineMs returns the dev deadline for devMonorepo and the prod deadline otherwise", () => {
    expect(getServerReadyDeadlineMs("devMonorepo")).toBe(SERVER_READY_DEADLINE_DEV_MS);
    expect(getServerReadyDeadlineMs("bundled")).toBe(SERVER_READY_DEADLINE_MS);
    expect(getServerReadyDeadlineMs("attach")).toBe(SERVER_READY_DEADLINE_MS);
    // Unknown / future kinds fall through to the safer (shorter) prod deadline.
    expect(getServerReadyDeadlineMs("")).toBe(SERVER_READY_DEADLINE_MS);
  });

  it("launch-source.ts passes a mode-aware healthTimeoutMs to launchDashboardServer (no raw 15_000 / 60_000 literals at the call site)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../lib/launch-source.ts"),
      "utf-8",
    );
    // The healthTimeoutMs arg MUST go through the helper so the deadline
    // tracks the launch-source kind. A raw `healthTimeoutMs: 15_000` (the
    // pre-fix shape) would silently regress the dev path.
    expect(src).toMatch(/healthTimeoutMs:\s*getServerReadyDeadlineMs\(/);
    expect(src).not.toMatch(/healthTimeoutMs:\s*15_000/);
    expect(src).not.toMatch(/healthTimeoutMs:\s*60_000/);
  });

  it("is referenced by every waitForReady call in server-lifecycle.ts", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../lib/server-lifecycle.ts"),
      "utf-8",
    );
    // Every waitForReady call MUST pass deadlineMs: SERVER_READY_DEADLINE_MS —
    // forbid raw literals so the constant is the single source of truth.
    expect(src).not.toContain("deadlineMs: 60_000");
    expect(src).not.toContain("deadlineMs: 15_000");
    // After change `unify-server-launch-ts-loader`, `launchServer`
    // delegates readiness polling to `launchDashboardServer` and no
    // longer references `deadlineMs:` directly — it passes
    // `healthTimeoutMs: SERVER_READY_DEADLINE_MS` instead. The remaining
    // direct callsite is `launchViaCli`. Pin both timeout-source uses.
    const deadlineMatches = src.match(/deadlineMs:\s*SERVER_READY_DEADLINE_MS/g);
    const healthTimeoutMatches = src.match(/healthTimeoutMs:\s*SERVER_READY_DEADLINE_MS/g);
    const total = (deadlineMatches?.length ?? 0) + (healthTimeoutMatches?.length ?? 0);
    expect(total).toBeGreaterThanOrEqual(2);
  });
});

describe("buildServerStartupError", () => {
  it("emits child-exit wording when readyError mentions an exit", () => {
    const err = buildServerStartupError({
      spawnBin: "node",
      spawnArgs: ["--import", "jiti", "cli.ts"],
      cwd: "/tmp/server",
      logTail: "some log",
      readyError: "child exited with code 1",
    });
    expect(err.message).toMatch(/^Server child process exited prematurely/);
    expect(err.message).toContain("missing dependency or wrong TypeScript loader");
    expect(err.message).toContain("child exited with code 1");
    expect(err.message).toContain("CWD: /tmp/server");
    expect(err.message).toContain("some log");
  });

  it("emits deadline wording when readyError mentions deadline", () => {
    const err = buildServerStartupError({
      spawnBin: "node",
      spawnArgs: ["--import", "jiti", "cli.ts"],
      cwd: "/tmp/server",
      logTail: "",
      readyError: "deadline 15000ms reached",
    });
    expect(err.message).toMatch(/^Server did not respond within 15 seconds/);
    expect(err.message).toContain("server is likely still starting");
    expect(err.message).toContain("loading page will keep polling");
    expect(err.message).toContain("Doctor button");
    expect(err.message).toContain("No server log available");
  });

  it("renders cliPath form when cliPath is provided", () => {
    const err = buildServerStartupError({
      cliPath: "/usr/local/bin/pi-dashboard",
      cwd: "/tmp",
      logTail: "",
      readyError: "child exited with code 127",
      port: 8000,
      piPort: 9999,
    });
    expect(err.message).toContain(
      "Command: /usr/local/bin/pi-dashboard start --port 8000 --pi-port 9999",
    );
  });

  it("renders spawnBin form when cliPath is omitted", () => {
    const err = buildServerStartupError({
      spawnBin: "/path/to/node",
      spawnArgs: ["--import", "jiti.mjs", "cli.ts", "--port", "8000"],
      cwd: "/tmp",
      logTail: "",
      readyError: "deadline reached",
    });
    expect(err.message).toContain(
      "Command: /path/to/node --import jiti.mjs cli.ts --port 8000",
    );
  });

  it("includes server log tail when provided", () => {
    const tail = "line 1\nline 2\nline 3";
    const err = buildServerStartupError({
      spawnBin: "node",
      spawnArgs: ["cli.ts"],
      cwd: "/tmp",
      logTail: tail,
      readyError: "child exited with code 1",
    });
    expect(err.message).toContain("Server log:\nline 1\nline 2\nline 3");
  });
});
