/**
 * D8 convergent bridge reload guard. Test plan F6 (+ convergence units).
 * See change: electron-runtime-overlay-updates.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeExtensionFromEnv, createExtensionReloadGuard } from "../runtime-overlay/extension-reload.js";

const SETTLE = 6_000;
const RETRY = 2_000;

type Active = { runtimeId: string; dir: string; version?: string } | null;

function setup(active: Active = { runtimeId: "0.9.1", dir: "/rt/0.9.1/ext", version: "0.9.1" }) {
  let current = active;
  const busy = new Set<string>();
  const reload = vi.fn<(sid: string) => Promise<unknown>>(async () => "forwarded");
  const onMismatch = vi.fn();
  const guard = createExtensionReloadGuard({
    active: () => current,
    reload,
    isBusy: (sid) => busy.has(sid),
    onMismatch,
    realpath: (p) => p.replace(/\/link$/, "/0.9.1/ext"),
    settleMs: SETTLE,
    retryMs: RETRY,
    maxWaitMs: 60_000,
  });
  return { guard, reload, onMismatch, busy, setActive: (a: Active) => (current = a) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("extension reload guard (D8)", () => {
  it("matching identity (dir + version, realpath'd) → no reload", async () => {
    const { guard, reload } = setup();
    expect(guard.onRegister("s1", { dir: "/rt/0.9.1/ext", version: "0.9.1" })).toBe("match");
    expect(guard.onRegister("s2", { dir: "/rt/link", version: "0.9.1" })).toBe("match");
    await vi.advanceTimersByTimeAsync(SETTLE * 2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("same dir but a different version (in-place update) is a mismatch", async () => {
    const { guard, reload } = setup();
    expect(guard.onRegister("s1", { dir: "/rt/0.9.1/ext", version: "0.9.0" })).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(SETTLE);
    expect(reload).toHaveBeenCalledWith("s1");
  });

  it("mismatch (or a legacy bridge reporting none) → one /reload, only after the settle delay", async () => {
    const { guard, reload } = setup();
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("scheduled");
    expect(guard.onRegister("s2", undefined)).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(SETTLE - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload.mock.calls).toEqual([["s1"], ["s2"]]);
  });

  it("a busy (mid-turn) session is not reloaded until it is idle — no new register needed", async () => {
    const { guard, reload, busy } = setup();
    busy.add("s1");
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(SETTLE + RETRY * 5);
    expect(reload).not.toHaveBeenCalled();
    busy.delete("s1");
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a refused / failed dispatch is retried without a new register, and counts once it lands", async () => {
    const { guard, reload } = setup();
    reload.mockResolvedValueOnce("refused").mockRejectedValueOnce(new Error("socket gone"));
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(SETTLE + RETRY * 3);
    expect(reload).toHaveBeenCalledTimes(3);
    // landed → a still-mismatched re-register does not reload again
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("mismatch");
  });

  it("F6: re-register still mismatched after its reload → no 2nd /reload; extension_mismatch recorded", async () => {
    const { guard, reload, onMismatch } = setup();
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(SETTLE);
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("mismatch");
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("mismatch");
    await vi.advanceTimersByTimeAsync(SETTLE * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onMismatch).toHaveBeenCalledWith("s1", expect.stringContaining("extension_mismatch"));
    expect(guard.mismatches()).toEqual([
      expect.objectContaining({ sessionId: "s1", runtimeId: "0.9.1", reported: "/rt/0.9.0/ext", expected: "/rt/0.9.1/ext" }),
    ]);
  });

  it("a re-register during the settle window reschedules (one reload, not two)", async () => {
    const { guard, reload } = setup();
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(SETTLE / 2);
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(SETTLE * 2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("converging before the settle delay cancels the pending reload and clears the mismatch", async () => {
    const { guard, reload } = setup();
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    expect(guard.onRegister("s1", { dir: "/rt/0.9.1/ext", version: "0.9.1" })).toBe("match");
    await vi.advanceTimersByTimeAsync(SETTLE * 2);
    expect(reload).not.toHaveBeenCalled();
    expect(guard.mismatches()).toEqual([]);
  });

  it("gives up after maxWait on a session that never goes idle", async () => {
    const { guard, reload, busy } = setup();
    busy.add("s1");
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(120_000);
    busy.delete("s1");
    await vi.advanceTimersByTimeAsync(RETRY * 3);
    expect(reload).not.toHaveBeenCalled();
  });

  it("the once-per-session guard is per runtime id: a new active runtime may reload again", async () => {
    const { guard, reload, setActive } = setup();
    guard.onRegister("s1", { dir: "/rt/0.9.0/ext" });
    await vi.advanceTimersByTimeAsync(SETTLE);
    setActive({ runtimeId: "0.9.2", dir: "/rt/0.9.2/ext" });
    expect(guard.onRegister("s1", { dir: "/rt/0.9.0/ext" })).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(SETTLE);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("no active identity (not Electron / devMonorepo) → never reloads", async () => {
    const { guard, reload } = setup(null);
    expect(guard.onRegister("s1", { dir: "/x" })).toBe("skipped");
    await vi.advanceTimersByTimeAsync(SETTLE * 2);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("activeExtensionFromEnv (fail-closed override)", () => {
  function extDir(name: string, version = "0.9.1"): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version }));
    return fs.realpathSync(d);
  }

  it("Electron + real dashboard-extension dir → dir (realpath) + version", () => {
    vi.useRealTimers();
    const dir = extDir("@blackbelt-technology/pi-dashboard-extension");
    expect(activeExtensionFromEnv({ PI_DASHBOARD_ELECTRON_INSTANCE: "tok", PI_DASHBOARD_EXTENSION_DIR: dir, PI_DASHBOARD_RUNTIME_ID: "0.9.1" })).toEqual({
      runtimeId: "0.9.1",
      dir,
      version: "0.9.1",
    });
  });

  it("refuses without the Electron owner token, a wrong package, a missing dir or no runtime id", () => {
    vi.useRealTimers();
    const good = extDir("@blackbelt-technology/pi-dashboard-extension");
    const wrong = extDir("evil-package");
    const base = { PI_DASHBOARD_ELECTRON_INSTANCE: "tok", PI_DASHBOARD_RUNTIME_ID: "0.9.1" };
    expect(activeExtensionFromEnv({ PI_DASHBOARD_EXTENSION_DIR: good, PI_DASHBOARD_RUNTIME_ID: "0.9.1" })).toBeNull();
    expect(activeExtensionFromEnv({ ...base, PI_DASHBOARD_EXTENSION_DIR: wrong })).toBeNull();
    expect(activeExtensionFromEnv({ ...base, PI_DASHBOARD_EXTENSION_DIR: "/nope/missing" })).toBeNull();
    expect(activeExtensionFromEnv({ PI_DASHBOARD_ELECTRON_INSTANCE: "tok", PI_DASHBOARD_EXTENSION_DIR: good })).toBeNull();
  });
});
