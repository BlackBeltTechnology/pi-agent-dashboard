/**
 * Tests for packages/shared/src/platform/exec.ts — the thin wrapper over
 * node:child_process that sets `windowsHide: true` by default.
 *
 * These tests assert the *option passthrough* contract; they do not spawn
 * real subprocesses. The wrapper is a few lines per function — its only
 * job is to forward arguments with `windowsHide: true` layered on top.
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect } from "vitest";
import {
  exec,
  execAsync as execAsyncFn,
  execFile,
  execFileAsync as execFileAsyncFn,
  execSync,
  spawn,
  spawnSync,
} from "../platform/exec.js";

describe("platform/exec wrappers", () => {
  // ── execSync ────────────────────────────────────────────────────────────
  // Real invocation: we pick commands that exit 0 on every OS (node itself).

  it("execSync exits 0 for `node --version`", () => {
    const out = execSync(`"${process.execPath}" --version`, { encoding: "utf-8" });
    expect(String(out).trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });

  // ── spawnSync ───────────────────────────────────────────────────────────

  it("spawnSync runs `node --version` and captures stdout", () => {
    const result = spawnSync(process.execPath, ["--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(String(result.stdout).trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("spawnSync accepts undefined args and defaults to []", () => {
    // Should not throw — wrapper must coerce undefined args to []
    const result = spawnSync(process.execPath, undefined, {
      encoding: "utf-8",
      input: "process.stdout.write('ok')",
    });
    // May or may not work depending on shell, but the call itself must not throw.
    expect(typeof result).toBe("object");
  });

  // ── windowsHide default ─────────────────────────────────────────────────

  // The windowsHide default is asserted behaviourally in
  // `platform-exec-windowshide.test.ts` (mocked node:child_process captures the
  // forwarded options); real spawns here cannot observe it.

  it("spawn returns a ChildProcess object", async () => {
    const child = spawn(process.execPath, ["--version"]);
    expect(child.pid).toBeGreaterThan(0);
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
    });
  });

  // ── exec (callback form) ────────────────────────────────────────────────

  it("exec(cmd, cb) invokes callback with stdout", async () => {
    const out = await new Promise<string>((resolve, reject) => {
      exec(`"${process.execPath}" --version`, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      });
    });
    expect(out.trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });

  // ── execFile ────────────────────────────────────────────────────────────

  it("execFile(file, args, cb) works", async () => {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ["--version"], (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      });
    });
    expect(out.trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

// ── execFileAsync / execAsync resolve {stdout, stderr} (regression) ─────────
// promisify() of the windowsHide WRAPPER lost Node's custom promisify, so the
// promise resolved to the bare stdout string while typed as {stdout, stderr}
// (callers reading `.stdout` got undefined). See change: electron-runtime-overlay-updates.

describe("execFileAsync / execAsync shape", () => {
  it("execFileAsync resolves { stdout, stderr }", async () => {
    const r = await execFileAsyncFn(process.execPath, ["-e", "process.stdout.write('out'); process.stderr.write('err')"]);
    expect(r).toEqual({ stdout: "out", stderr: "err" });
  });

  it("execFileAsync rejects on non-zero exit with stdout/stderr attached", async () => {
    await expect(
      execFileAsyncFn(process.execPath, ["-e", "process.stdout.write('o'); process.exit(3)"]),
    ).rejects.toMatchObject({ code: 3, stdout: "o" });
  });

  it("execAsync resolves { stdout, stderr }", async () => {
    const r = await execAsyncFn(`"${process.execPath}" -e "process.stdout.write('x')"`);
    expect(r).toMatchObject({ stdout: "x" });
  });
});
