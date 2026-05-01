import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildServerSpawnOptions } from "../lib/server-lifecycle.js";

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
