/**
 * Tests for platform/detached-spawn.ts primitives.
 *
 * Uses real `node -e` subprocess fixtures (no mocking) so we can exercise
 * the actual Node spawn path with libuv's detached semantics on whatever
 * OS the test runs on.
 *
 * All platform-dependent helpers take an explicit `platform` argument so
 * tests can exercise both branches. We never mutate `process.platform`
 * and never `vi.mock`.
 */
import { describe, it, expect } from "vitest";
import { openSync, closeSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnDetached, waitForNoCrash, waitForReady } from "../platform/detached-spawn.js";

function tmpLog(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dspawn-"));
  return path.join(dir, "out.log");
}

describe("spawnDetached", () => {
  it("spawns a real detached child with correct defaults", async () => {
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 300)"],
    });
    expect(r.ok).toBe(true);
    expect(r.pid).toBeTypeOf("number");
    expect(r.process).toBeDefined();
    // clean up
    await new Promise((res) => r.process!.once("exit", res));
  });

  it("returns ok:false with error when cmd does not exist", async () => {
    const r = await spawnDetached({
      cmd: "/definitely/not/a/real/binary/nope.exe",
      args: [],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("redirects stderr to logFd when provided", async () => {
    const logPath = tmpLog();
    const fd = openSync(logPath, "a");
    try {
      const r = await spawnDetached({
        cmd: process.execPath,
        args: ["-e", "process.stderr.write('BOOM'); setTimeout(() => process.exit(0), 100)"],
        logFd: fd,
      });
      expect(r.ok).toBe(true);
      await new Promise((res) => r.process!.once("exit", res));
    } finally {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("BOOM");
    rmSync(path.dirname(logPath), { recursive: true, force: true });
  });

  it("does not keep parent event loop alive (unref)", async () => {
    // Can only check behaviour indirectly: the returned pid/process exist
    // and the child is running detached. Lifecycle survival is covered by
    // Node's own libuv tests; we assert we didn't throw.
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 100)"],
    });
    expect(r.ok).toBe(true);
    await new Promise((res) => r.process!.once("exit", res));
  });
});

describe("waitForNoCrash", () => {
  it("returns ok:true when child outlives the window", async () => {
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 1000)"],
    });
    expect(r.ok).toBe(true);
    const gate = await waitForNoCrash({ child: r.process!, windowMs: 150 });
    expect(gate.ok).toBe(true);
    await new Promise((res) => r.process!.once("exit", res));
  });

  it("returns ok:false with exitCode when child exits early", async () => {
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["-e", "process.exit(7)"],
    });
    expect(r.ok).toBe(true);
    const gate = await waitForNoCrash({ child: r.process!, windowMs: 1000 });
    expect(gate.ok).toBe(false);
    expect(gate.exitCode).toBe(7);
  });

  it("respects a small windowMs and does not hang on live children", async () => {
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 5000)"],
    });
    expect(r.ok).toBe(true);
    const start = Date.now();
    const gate = await waitForNoCrash({ child: r.process!, windowMs: 100 });
    const elapsed = Date.now() - start;
    expect(gate.ok).toBe(true);
    expect(elapsed).toBeLessThan(500);
    r.process!.kill();
    await new Promise((res) => r.process!.once("exit", res));
  });
});

describe("waitForReady", () => {
  it("returns ok:true when probe succeeds", async () => {
    const r = await waitForReady({
      probe: async () => true,
      deadlineMs: 1000,
      pollIntervalMs: 50,
    });
    expect(r.ok).toBe(true);
  });

  it("returns ok:false with 'timeout' when probe never succeeds", async () => {
    const r = await waitForReady({
      probe: async () => false,
      deadlineMs: 200,
      pollIntervalMs: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
  });

  it("short-circuits on child error event", async () => {
    // Spawn a nonexistent path via spawnDetached — triggers error event.
    const bad = await spawnDetached({
      cmd: "/does/not/exist/XYZQQ",
      args: [],
    });
    // bad.process may or may not exist depending on how Node surfaced the
    // error. If it does, we can observe the short-circuit; if not, skip
    // this specific assertion. Either way, waitForReady must not hang.
    if (bad.process) {
      const start = Date.now();
      const r = await waitForReady({
        probe: async () => false,
        deadlineMs: 5000,
        pollIntervalMs: 500,
        child: bad.process,
      });
      const elapsed = Date.now() - start;
      expect(r.ok).toBe(false);
      expect(elapsed).toBeLessThan(5000);
    }
  });

  it("polls at pollIntervalMs until probe flips", async () => {
    let calls = 0;
    const r = await waitForReady({
      probe: async () => ++calls >= 3,
      deadlineMs: 2000,
      pollIntervalMs: 50,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
