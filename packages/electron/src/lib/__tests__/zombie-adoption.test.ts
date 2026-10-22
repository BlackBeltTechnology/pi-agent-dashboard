/**
 * Unit tests for the zombie-adoption modal + stop sequence.
 * See change: electron-attach-ownership-fixes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const showMessageBox = vi.fn();

vi.mock("electron", () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}));

import {
  buildVersionSkewInfoDetail,
  promptMergedZombieSkew,
  promptVersionSkewInfo,
  promptVersionSkewRestart,
  promptZombieAdoption,
  stopZombieServer,
} from "../zombie-adoption-dialog.js";

describe("promptZombieAdoption", () => {
  beforeEach(() => showMessageBox.mockReset());

  it("button index 0 → adopt", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    expect(await promptZombieAdoption({ pid: 123 })).toBe("adopt");
  });

  it("button index 1 → leave", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await promptZombieAdoption({ pid: 123 })).toBe("leave");
  });

  it("button index 2 → stop", async () => {
    showMessageBox.mockResolvedValue({ response: 2 });
    expect(await promptZombieAdoption({ pid: 123 })).toBe("stop");
  });

  it("uses 'leave' as both default and cancel button", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    await promptZombieAdoption({ pid: 999 });
    const opts = showMessageBox.mock.calls[0][0];
    expect(opts.defaultId).toBe(1);
    expect(opts.cancelId).toBe(1);
    expect(opts.detail).toContain("999");
  });
});

describe("stopZombieServer (confirms death by PID)", () => {
  /** Virtual clock: the process dies `diesAtMs` after `t0`, `sleep` advances time. */
  function rig(opts: { diesAfterSigtermMs?: number; diesAfterSigkillMs?: number; ignoreTerm?: boolean; eperm?: boolean }) {
    let now = 0;
    let termAt: number | null = null;
    let killAt: number | null = null;
    const kill = vi.fn((_pid: number, sig: NodeJS.Signals) => {
      if (sig === "SIGTERM") termAt = now;
      else killAt = now;
    });
    const isAlive = vi.fn(() => {
      if (opts.eperm) return true;
      if (killAt !== null && opts.diesAfterSigkillMs !== undefined && now >= killAt + opts.diesAfterSigkillMs) return false;
      if (termAt !== null && !opts.ignoreTerm && opts.diesAfterSigtermMs !== undefined && now >= termAt + opts.diesAfterSigtermMs) return false;
      return true;
    });
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    return { kill, isAlive, sleep, signals: () => kill.mock.calls.map((c) => c[1]) };
  }

  it("SIGTERM only when the process exits within the poll window", async () => {
    const r = rig({ diesAfterSigtermMs: 400 });
    expect(await stopZombieServer(1234, r)).toBe(true);
    expect(r.signals()).toEqual(["SIGTERM"]);
  });

  it("X4: dies 1.8 s after SIGKILL → true; 2.2 s → false", async () => {
    const a = rig({ ignoreTerm: true, diesAfterSigkillMs: 1800 });
    expect(await stopZombieServer(1234, a)).toBe(true);
    expect(a.signals()).toEqual(["SIGTERM", "SIGKILL"]);
    const b = rig({ ignoreTerm: true, diesAfterSigkillMs: 2200 });
    expect(await stopZombieServer(1234, b)).toBe(false);
  });

  it("X5: EPERM (alive) escalates then reports failure", async () => {
    const r = rig({ eperm: true });
    expect(await stopZombieServer(1234, r)).toBe(false);
    expect(r.signals()).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("returns true immediately when SIGTERM throws and the PID is gone", async () => {
    const kill = vi.fn(() => {
      throw new Error("ESRCH");
    });
    const sleep = vi.fn(async () => {});
    expect(await stopZombieServer(1234, { kill, isAlive: () => false, sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("version-skew dialogs (E23, E22)", () => {
  beforeEach(() => showMessageBox.mockReset());
  const call = () => showMessageBox.mock.calls[0][0];

  it("restart modal: default follows restartIsDefault, Leave running is cancel", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    expect(await promptVersionSkewRestart({ server: "0.9.0", expected: "0.10.0", restartIsDefault: true })).toBe("restart");
    expect(call().buttons).toEqual(["Restart with v0.10.0", "Leave running"]);
    expect(call().defaultId).toBe(0);
    expect(call().cancelId).toBe(1);
    expect(call().message).toContain("0.9.0");
    expect(call().message).toContain("0.10.0");
    showMessageBox.mockReset();
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await promptVersionSkewRestart({ server: "0.9.0", expected: "0.10.0", restartIsDefault: false })).toBe("leave");
    expect(call().defaultId).toBe(1);
  });

  it("merged modal: three buttons, Restart default, Leave running cancel", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await promptMergedZombieSkew({ pid: 7, server: "0.9.0", expected: "0.10.0" })).toBe("adopt");
    expect(call().buttons).toEqual(["Restart with v0.10.0", "Take ownership", "Leave running"]);
    expect(call().defaultId).toBe(0);
    expect(call().cancelId).toBe(2);
    expect(call().message).toContain("0.9.0");
    expect(call().message).toContain("0.10.0");
  });

  it("info modal: OK default; dismissal button maps to 'dismiss'", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const params = { server: "0.9.0", expected: "0.10.0", shellVersion: "0.10.0", launchSource: "standalone" };
    expect(await promptVersionSkewInfo(params)).toBe("dismiss");
    expect(call().buttons).toEqual(["OK", "Don't show again for this version pair"]);
    expect(call().defaultId).toBe(0);
    expect(call().message).toContain("0.9.0");
    expect(call().message).toContain("0.10.0");
    showMessageBox.mockResolvedValue({ response: 0 });
    expect(await promptVersionSkewInfo(params)).toBe("ok");
  });

  it("E22: disclosure line only when expected differs from the shell version", () => {
    const withSkew = buildVersionSkewInfoDetail({ server: "0.9.0", expected: "0.10.1", shellVersion: "0.10.0", launchSource: "standalone" });
    expect(withSkew).toContain("installs v0.10.0");
    expect(withSkew).toContain("v0.10.1");
    expect(withSkew).toContain("npm i -g @blackbelt-technology/pi-dashboard@0.10.0");
    const same = buildVersionSkewInfoDetail({ server: "0.9.0", expected: "0.10.0", shellVersion: "0.10.0", launchSource: "standalone" });
    expect(same).not.toContain("installs v");
  });
});
