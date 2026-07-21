/**
 * Unit tests for signal-handler installation. See change: single-dashboard-per-home.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
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
