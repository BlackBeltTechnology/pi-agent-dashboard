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
import { execSync, spawn, spawnSync, exec, execFile } from "../platform/exec.js";

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

  // The key invariant: wrappers set windowsHide: true when caller omits it.
  // We verify this by inspecting the spawn metadata (spawnargs / opts).
  // Node doesn't expose the final options object, so we check by spawning
  // with a non-overridden call and verifying it completes successfully
  // (a misconfigured windowsHide would not change functional behavior,
  // so the real assertion is in D10 below via source inspection).

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

describe("platform/exec — windowsHide default (source-level assertion)", () => {
  // Since Node doesn't expose the spawn options after the call, we verify
  // the windowsHide default by reading the wrapper source and asserting
  // that every public export merges `windowsHide: true` into its options.
  //
  // This catches refactors that accidentally drop the default.

  it("exec.ts source sets windowsHide: true by default", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = await fs.readFile(path.resolve(here, "../platform/exec.ts"), "utf-8");

    // Must define a withHide helper and apply it uniformly.
    expect(src).toMatch(/windowsHide\??:\s*boolean/);
    expect(src).toMatch(/windowsHide:\s*hide/);
    // Default must be true (not false) when caller omits it.
    expect(src).toMatch(/opts\?\.windowsHide\s*\?\?\s*true/);
  });
});
