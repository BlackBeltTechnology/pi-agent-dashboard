/**
 * Unit tests for signal-handler installation. See change: single-dashboard-per-home.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acquireOrAttach, readMetadata } from "../lifecycle/home-lock.js";
import { installReleaseHandlers } from "../lifecycle/home-lock-release.js";

function fakeProcess() {
  const ee = new EventEmitter() as unknown as NodeJS.Process;
  (ee as unknown as { exit: (code: number) => void }).exit = vi.fn();
  return ee;
}

describe("installReleaseHandlers", () => {
  it("registers SIGINT, SIGTERM, SIGHUP, SIGBREAK, and exit handlers", () => {
    const proc = fakeProcess();
    const onSpy = vi.spyOn(proc, "on");
    installReleaseHandlers(async () => {}, { proc });
    const registered = onSpy.mock.calls.map(c => c[0]);
    expect(registered).toEqual(expect.arrayContaining(["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "exit"]));
  });

  it("calls release() on SIGTERM", async () => {
    const proc = fakeProcess();
    const release = vi.fn(async () => {});
    installReleaseHandlers(release, { proc });
    proc.emit("SIGTERM");
    // Handler is async — let microtasks flush.
    await new Promise(r => setImmediate(r));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("calls release() on SIGBREAK (Windows Ctrl+Break)", async () => {
    // On POSIX Node never emits SIGBREAK, but the handler must still be
    // wired so Windows Ctrl+Break triggers lock release. Exercising via a
    // fake process guarantees the registration + dispatch path works.
    const proc = fakeProcess();
    const release = vi.fn(async () => {});
    installReleaseHandlers(release, { proc });
    proc.emit("SIGBREAK" as NodeJS.Signals);
    await new Promise(r => setImmediate(r));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("calls release() on SIGHUP", async () => {
    const proc = fakeProcess();
    const release = vi.fn(async () => {});
    installReleaseHandlers(release, { proc });
    proc.emit("SIGHUP");
    await new Promise(r => setImmediate(r));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not double-release on repeated signals", async () => {
    const proc = fakeProcess();
    const release = vi.fn(async () => {});
    installReleaseHandlers(release, { proc });
    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    await new Promise(r => setImmediate(r));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("returns a dispose function that removes handlers", () => {
    const proc = fakeProcess();
    const release = vi.fn(async () => {});
    const dispose = installReleaseHandlers(release, { proc });
    dispose();
    proc.emit("SIGTERM");
    // After dispose, the release must not fire.
    expect(release).not.toHaveBeenCalled();
  });

  it("swallows release errors but logs them", async () => {
    const proc = fakeProcess();
    const logs: string[] = [];
    const release = vi.fn(async () => { throw new Error("boom"); });
    installReleaseHandlers(release, { proc, log: (m) => logs.push(m) });
    proc.emit("SIGTERM");
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(logs.join("\n")).toContain("boom");
  });
});

// See change: harden-dashboard-start-detection (D5.4; test-plan X12).
describe("a taken-over holder", () => {
  it("X12: noticing the takeover neither crashes nor releases the successor's lock or record", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lock-compromised-"));
    const lockPath = path.join(home, ".pi", "dashboard", "server.lock");
    const metaPath = `${lockPath}.meta.json`;
    const lockDir = `${lockPath}.lock`;
    const logs: string[] = [];
    const base = {
      httpPort: 8000,
      piPort: 9999,
      version: "t",
      hooks: { lockPath, metaPath, staleMs: 2000, probeHealth: async () => ({ running: false }), isProcessAlive: () => false, log: (m: string) => logs.push(m) },
    };
    try {
      let compromisedNotified = 0;
      const a = await acquireOrAttach({ ...base, identity: "A", onCompromised: () => { compromisedNotified += 1; } });
      expect(a.mode).toBe("acquired");
      if (a.mode !== "acquired") return;

      // Takeover: A's lock directory vanishes, B acquires and writes its record.
      fs.rmSync(lockDir, { recursive: true, force: true });
      const b = await acquireOrAttach({ ...base, identity: "B" });
      expect(b.mode).toBe("acquired");
      const bMetaBefore = fs.readFileSync(metaPath);

      // A's lock library notices (its refresh timer): must not throw.
      const uncaught: unknown[] = [];
      const onUncaught = (e: unknown) => uncaught.push(e);
      process.on("uncaughtException", onUncaught);
      try {
        await vi.waitFor(() => expect(a.compromised).toBe(true), { timeout: 4000, interval: 50 });
      } finally {
        process.off("uncaughtException", onUncaught);
      }
      expect(uncaught).toEqual([]);
      expect(compromisedNotified).toBe(1);
      expect(logs.join("\n")).toMatch(/taken over/);

      await a.release();
      expect(fs.existsSync(lockDir)).toBe(true);
      expect(fs.readFileSync(metaPath).equals(bMetaBefore)).toBe(true);
      expect(readMetadata(metaPath)?.identity).toBe("B");
      if (b.mode === "acquired") await b.release();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);

  it("a release attempted before the library notices still leaves a successor's record alone", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lock-successor-"));
    const lockPath = path.join(home, ".pi", "dashboard", "server.lock");
    const metaPath = `${lockPath}.meta.json`;
    const base = { httpPort: 8000, piPort: 9999, version: "t", hooks: { lockPath, metaPath, probeHealth: async () => ({ running: false }), isProcessAlive: () => false, log: () => {} } };
    try {
      const a = await acquireOrAttach({ ...base, identity: "A" });
      if (a.mode !== "acquired") throw new Error("expected acquired");
      fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
      const b = await acquireOrAttach({ ...base, identity: "B" });
      await a.release(); // immediately: record names B
      expect(fs.existsSync(`${lockPath}.lock`)).toBe(true);
      expect(readMetadata(metaPath)?.identity).toBe("B");
      if (b.mode === "acquired") await b.release();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
