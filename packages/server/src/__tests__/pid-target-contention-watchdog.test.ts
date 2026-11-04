/**
 * Pid-keyed register decisions honour the pid target:
 * - same-pid fast-accept only when incumbent AND newcomer are both `host`, or
 *   both `unknown` on a Windows server (E88–E90, E102 / S3);
 * - the watchdog's pid tier is skipped for a non-local register, its cwd tier
 *   kept (E84, E85, E107 / S11).
 * See change: scope-pids-to-namespace.
 */
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { decideClaim, type ProbeableSocket, WS_OPEN } from "../pi/bridge-contention.js";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { PidTarget, ServerPidContext } from "../session/pid-target.js";
import { _setSpawnRegisterWatchdogForTests, type SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";
import { delay, until, waitForBind, waitForOpen } from "./pi-gateway-duplicate-register.test.js";

const live = (): ProbeableSocket => ({ readyState: WS_OPEN, _socket: { destroyed: false, writable: true } });
const T = {
  host: { kind: "host" } as PidTarget,
  unknown: { kind: "unknown" } as PidTarget,
  wsl: { kind: "wsl", distro: "U" } as PidTarget,
  legacy: { kind: "legacy-wsl" } as PidTarget,
  foreign: { kind: "foreign" } as PidTarget,
};
function claim(incumbent: PidTarget, newcomer: PidTarget, serverPlatform: string, newcomerPid = 4242) {
  return decideClaim({
    incumbent: live(),
    newcomer: live(),
    incumbentSource: "tui",
    incumbentPid: 4242,
    newcomerPid,
    pidTargets: { incumbent, newcomer, serverPlatform },
  });
}

describe("same-pid fast-accept by pid target (S3)", () => {
  it("E88: accept only for host, or unknown on win32", () => {
    expect(claim(T.host, T.host, "linux")).toEqual({ outcome: "accept", reason: "same-pid" });
    expect(claim(T.unknown, T.unknown, "win32")).toEqual({ outcome: "accept", reason: "same-pid" });
    expect(claim(T.unknown, T.unknown, "linux").outcome).toBe("probe");
    for (const t of [T.wsl, T.foreign, T.legacy]) expect(claim(t, t, "win32").outcome).toBe("probe");
  });

  it("E89: a differing pid still grants nothing", () => {
    expect(claim(T.host, T.host, "linux", 4243).outcome).toBe("probe");
  });

  it("E90: a placeholder incumbent is still accepted first", () => {
    const d = decideClaim({
      incumbent: live(),
      newcomer: live(),
      incumbentSource: "unknown",
      newcomerPid: 4242,
      pidTargets: { incumbent: undefined, newcomer: T.wsl, serverPlatform: "win32" },
    });
    expect(d).toEqual({ outcome: "accept", reason: "placeholder" });
  });

  it("E102: an incumbent in another namespace is not the same process", () => {
    expect(claim(T.wsl, T.host, "win32").outcome).toBe("probe");
    expect(claim(T.host, T.host, "win32")).toMatchObject({ reason: "same-pid" });
    expect(claim(T.unknown, T.unknown, "win32")).toMatchObject({ reason: "same-pid" });
    expect(claim(T.host, T.unknown, "win32").outcome).toBe("probe");
  });
});

// ── watchdog pid tier, through the real register handler ────────────────────
const SL: ServerPidContext = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_WSL: PidNamespace = { platform: "linux", kind: "wsl", distro: "U", hostId: "boot-W", nsId: "pid:[1]" };
const RL_CTR: PidNamespace = { ...RL, nsId: "pid:[999]" };

const gateways: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const g of gateways.splice(0)) g.stop();
  _setSpawnRegisterWatchdogForTests(null);
});

async function registerWith(ctx: ServerPidContext, register: Record<string, unknown>) {
  const watchdog = {
    clearByToken: vi.fn(() => false),
    clearByPid: vi.fn(() => true),
    clearByCwd: vi.fn(() => true),
  };
  _setSpawnRegisterWatchdogForTests(watchdog as unknown as SpawnRegisterWatchdog);
  const sm = createMemorySessionManager();
  const gw = createPiGateway(sm, { pingInterval: 0, pidContext: ctx });
  gw.start(0, "127.0.0.1");
  gateways.push(gw);
  const ws = new WebSocket(`ws://127.0.0.1:${await waitForBind(gw)}`);
  ws.on("error", () => {});
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", source: "tui", ...register }));
  await until(() => sm.get("s1")?.source === "tui");
  await delay(10);
  ws.close();
  return watchdog;
}

describe("watchdog pid tier by register target (S11)", () => {
  it("E84: a foreign or WSL register never clears by pid", async () => {
    for (const [ctx, ns] of [
      [SL, RL_CTR],
      [SW, RL_WSL],
    ] as const) {
      const w = await registerWith(ctx, { pid: 777, cwd: "/zzz", pidNamespace: ns });
      expect(w.clearByPid).not.toHaveBeenCalled();
      expect(w.clearByCwd).toHaveBeenCalledWith("/zzz");
    }
  });

  it("E85: a host register still clears by pid", async () => {
    const w = await registerWith(SL, { pid: 777, cwd: "/zzz", pidNamespace: RL });
    expect(w.clearByPid).toHaveBeenCalledWith(777);
  });

  it("E107: a non-local register still clears by cwd", async () => {
    for (const [ctx, ns] of [
      [SW, RL_WSL],
      [SL, RL_CTR],
    ] as const) {
      const w = await registerWith(ctx, { pid: 4242, cwd: "/a", pidNamespace: ns });
      expect(w.clearByCwd).toHaveBeenCalledWith("/a");
      expect(w.clearByPid).not.toHaveBeenCalled();
    }
  });
});
