/**
 * Regression: `runNpmOnce` (internal to `bootstrap-install.ts`) MUST
 * spawn `.cmd` / `.bat` shims with `{ shell: true, windowsHide: true }`.
 *
 * Since CVE-2024-27980 (Node ≥ 18.20 / 20.12.1 / 22.0) raw `spawn`
 * of a Windows batch shim with `shell: false` fails with EFTYPE.
 * Verified live on Windows 11 + Node 22.18.0 bootstrapping pi via
 * `npm.cmd` — server bootstrap surfaced `spawn EFTYPE` and the install
 * never completed. Native `.exe` invocations must remain on the
 * direct-spawn path (no implicit `shell: true`) so existing behaviour
 * for PATH-resolved `npm` (Unix) and explicit `[<node>, <npm-cli.js>]`
 * argvs is unchanged.
 *
 * See change: fix-windows-standalone-spawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Captured spawn invocations. Reset before each test.
const spawnCalls: Array<{
  cmd: string;
  args: readonly string[];
  options: Record<string, unknown>;
}> = [];

function makeFakeChild() {
  // Minimal ChildProcess stand-in: emits "close 0" on next tick so the
  // runNpmOnce promise resolves quickly.
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => child.emit("close", 0));
  return child;
}

vi.mock("../platform/exec.js", async () => {
  const actual = await vi.importActual<typeof import("../platform/exec.js")>(
    "../platform/exec.js",
  );
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnCalls.push({ cmd, args, options });
      return makeFakeChild() as unknown as ReturnType<typeof actual.spawn>;
    },
  };
});

describe("runNpmOnce — batch-shim spawn options (CVE-2024-27980)", () => {
  let tmpDir: string;

  beforeEach(() => {
    spawnCalls.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bootstrap-shim-"));
  });

  afterEach(() => {
    spawnCalls.length = 0;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets shell:true + windowsHide:true when cmd ends with .cmd", async () => {
    const { bootstrapInstall } = await import("../bootstrap-install.js");
    await bootstrapInstall({
      packages: ["some-pkg"],
      managedDir: tmpDir,
      npmArgv: ["C:\\Program Files\\nodejs\\npm.cmd"],
    });
    expect(spawnCalls).toHaveLength(1);
    const call = spawnCalls[0]!;
    expect(call.cmd).toBe("C:\\Program Files\\nodejs\\npm.cmd");
    expect(call.options.shell).toBe(true);
    expect(call.options.windowsHide).toBe(true);
  });

  it("sets shell:true + windowsHide:true when cmd ends with .BAT (case-insensitive)", async () => {
    const { bootstrapInstall } = await import("../bootstrap-install.js");
    await bootstrapInstall({
      packages: ["some-pkg"],
      managedDir: tmpDir,
      npmArgv: ["C:\\foo\\npm.BAT"],
    });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.options.shell).toBe(true);
    expect(spawnCalls[0]!.options.windowsHide).toBe(true);
  });

  it("does NOT set shell:true for a plain PATH-resolved npm (Unix)", async () => {
    const { bootstrapInstall } = await import("../bootstrap-install.js");
    await bootstrapInstall({
      packages: ["some-pkg"],
      managedDir: tmpDir,
      npmArgv: ["npm"],
    });
    expect(spawnCalls).toHaveLength(1);
    // shell should be absent (undefined) for non-batch-shim spawns so
    // we don't regress the direct-spawn path used by every Unix caller
    // and Electron's bundled-node case.
    expect(spawnCalls[0]!.options.shell).toBeUndefined();
  });

  it("does NOT set shell:true for an explicit node + npm-cli.js argv", async () => {
    const { bootstrapInstall } = await import("../bootstrap-install.js");
    await bootstrapInstall({
      packages: ["some-pkg"],
      managedDir: tmpDir,
      npmArgv: [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      ],
    });
    expect(spawnCalls).toHaveLength(1);
    // argv[0] is a .exe → direct spawn, no shell wrap.
    expect(spawnCalls[0]!.options.shell).toBeUndefined();
  });
});
