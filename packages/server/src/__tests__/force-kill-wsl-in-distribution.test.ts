/**
 * Force-kill of a WSL target on a Windows server kills INSIDE the distribution
 * (no taskkill, no age check); a Windows host target is unchanged; `legacy-wsl`
 * and `foreign` stay refused. Test-plan rows E42, E43, E43b, E43c, X11.
 * See change: add-windows-process-identity.
 */
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerPidContext } from "../session/pid-target.js";

const killProcessSpy = vi.fn(async (_pid: number, _opts?: unknown) => ({ ok: true, forced: false }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, killProcess: (pid: number, opts?: unknown) => killProcessSpy(pid, opts) };
});
const { forceKillSession } = await import("../browser-handlers/session-action-handler.js");

const D = "Ubuntu-22.04";
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const NS_WSL: PidNamespace = { platform: "linux", kind: "wsl", distro: D, hostId: "boot-W", nsId: "pid:[1]" };
const NS_HOST: PidNamespace = { platform: "win32", kind: "host", hostId: "WINBOX" };

function make(over: Partial<DashboardSession>) {
  let record = { id: "s1", cwd: "C:\\p", status: "active", pid: 4242, ...over } as DashboardSession;
  const deps = {
    sessionManager: {
      get: vi.fn(() => record),
      update: vi.fn((_id: string, u: Partial<DashboardSession>) => {
        record = { ...record, ...u };
      }),
    },
    piGateway: { closeSession: vi.fn(() => true), sendToSession: vi.fn() },
    headlessPidRegistry: { getPid: vi.fn(() => undefined), killBySessionId: vi.fn(async () => false) },
    broadcast: vi.fn(),
    metaPersistence: { setLiveness: vi.fn() },
    pidContext: SW,
  };
  return { deps, current: () => record };
}

beforeEach(() => killProcessSpy.mockClear());

describe("force-kill on a Windows server", () => {
  it("E42: a Windows host target keeps killProcess", async () => {
    const w = make({ pidNamespace: NS_HOST });
    const verifyAndKillWsl = vi.fn();
    const r = await forceKillSession("s1", { ...w.deps, verifyAndKillWsl } as never);
    expect(r.success).toBe(true);
    expect(killProcessSpy).toHaveBeenCalledWith(4242, { timeoutMs: 2000 });
    expect(verifyAndKillWsl).not.toHaveBeenCalled();
  });

  it("E43: a WSL target is killed inside D with no age check, never via taskkill", async () => {
    const w = make({ pidNamespace: NS_WSL });
    const verifyAndKillWsl = vi.fn(async () => "killed" as const);
    const r = await forceKillSession("s1", { ...w.deps, verifyAndKillWsl } as never);
    expect(r).toEqual({ success: true, message: "Process terminated" });
    expect(verifyAndKillWsl).toHaveBeenCalledWith(4242, D, { timeoutMs: 2000 });
    expect(killProcessSpy).not.toHaveBeenCalled();
    expect(w.deps.piGateway.closeSession).toHaveBeenCalledWith("s1");
    expect(w.current().status).toBe("ended");
  });

  it.each([
    ["legacy-wsl", { cwd: "/home/u/p" }],
    ["foreign", { originDeviceId: "dev-remote-1" }],
  ])("E43b: %s is still refused — no signal, WebSocket open", async (_n, session) => {
    const w = make(session as Partial<DashboardSession>);
    const verifyAndKillWsl = vi.fn();
    const r = await forceKillSession("s1", { ...w.deps, verifyAndKillWsl } as never);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not on this host/);
    expect(verifyAndKillWsl).not.toHaveBeenCalled();
    expect(killProcessSpy).not.toHaveBeenCalled();
    expect(w.deps.piGateway.closeSession).not.toHaveBeenCalled();
  });

  it("E43c: an already-gone WSL process is success (already gone)", async () => {
    const w = make({ pidNamespace: NS_WSL });
    const r = await forceKillSession("s1", { ...w.deps, verifyAndKillWsl: vi.fn(async () => "absent" as const) } as never);
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/already gone/);
    expect(w.current().status).toBe("ended");
  });

  it("X11: helper `error` is not a termination — success:false, WebSocket open, not ended", async () => {
    const w = make({ pidNamespace: NS_WSL });
    const r = await forceKillSession("s1", { ...w.deps, verifyAndKillWsl: vi.fn(async () => "error" as const) } as never);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not terminated/i);
    expect(w.deps.piGateway.closeSession).not.toHaveBeenCalled();
    expect(w.current().status).toBe("active");
    expect(w.current().closedReason).toBeUndefined();
    expect(killProcessSpy).not.toHaveBeenCalled();
  });
});
