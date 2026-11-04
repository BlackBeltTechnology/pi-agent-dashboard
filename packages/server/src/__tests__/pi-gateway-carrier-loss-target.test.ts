/**
 * The gateway's carrier-loss paths (reconnect-grace expiry, sleep-recovery
 * failure, heartbeat timeout, ping timeout) classify through ONE helper that
 * resolves the pid target first: only a `host` pid is probed; a foreign, WSL,
 * legacy-WSL or unknown pid ends `unknown` without a probe.
 * Test-plan rows X53–X57. See change: scope-pids-to-namespace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { ServerPidContext } from "../session/pid-target.js";
import { delay, waitForBind, waitForOpen } from "./pi-gateway-duplicate-register.test.js";

const SL: ServerPidContext = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_WSL: PidNamespace = { platform: "linux", kind: "wsl", distro: "U", hostId: "boot-W", nsId: "pid:[1]" };
const HB = 150;

const gateways: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const g of gateways.splice(0)) g.stop();
});

async function loseCarrier(ctx: ServerPidContext, register: Record<string, unknown>) {
  const sm = createMemorySessionManager();
  const kill = vi.fn(() => {
    throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
  });
  const gw = createPiGateway(sm, { heartbeatTimeout: HB, pingInterval: 0, pidContext: ctx, carrierLossKill: kill });
  gw.start(0, "127.0.0.1");
  gateways.push(gw);
  const port = await waitForBind(gw);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on("error", () => {});
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd: "/home/u/p", source: "tui", pid: 4242, ...register }));
  await delay(60);
  ws.close();
  // grace period + expiry
  await delay(HB * 2 + 250);
  return { reason: sm.get("s1")?.closedReason, status: sm.get("s1")?.status, kill };
}

describe("carrier loss by pid target (reconnect-grace expiry path)", () => {
  it("X53: a foreign (container) pid ends `unknown`, never probed", async () => {
    const r = await loseCarrier(SL, { pidNamespace: { ...RL, nsId: "pid:[999]" } });
    expect(r.status).toBe("ended");
    expect(r.reason).toBe("unknown");
    expect(r.kill).not.toHaveBeenCalled();
  }, 10_000);

  it("X54: a WSL pid on a win32 server ends `unknown`, never probed", async () => {
    const r = await loseCarrier(SW, { pidNamespace: RL_WSL });
    expect(r.reason).toBe("unknown");
    expect(r.kill).not.toHaveBeenCalled();
  }, 10_000);

  it("X55: a legacy-WSL pid (POSIX cwd, no report) on win32 ends `unknown`", async () => {
    const r = await loseCarrier(SW, {});
    expect(r.reason).toBe("unknown");
    expect(r.kill).not.toHaveBeenCalled();
  }, 10_000);

  it("X57: a host pid that is gone is still `process_gone`", async () => {
    const r = await loseCarrier(SL, { pidNamespace: RL });
    expect(r.reason).toBe("process_gone");
    expect(r.kill).toHaveBeenCalledTimes(1);
  }, 10_000);
});

/**
 * @structural-pin the ping-timeout and sleep-recovery callers need real TCP death to reach; routing all four through one helper is a placement fact
 */
describe("X56/X53–X55: every carrier-loss caller routes through the target-aware helper", () => {
  it("pi-gateway.ts calls classifyCarrierLoss only inside carrierLossReason", () => {
    const src = readFileSync(join(__dirname, "..", "pi", "pi-gateway.ts"), "utf8");
    const direct = [...src.matchAll(/classifyCarrierLoss\(/g)].length;
    expect(direct).toBe(1); // the helper's own call
    const viaHelper = [...src.matchAll(/closedReason: carrierLossReason\(/g)].length;
    expect(viaHelper).toBe(4); // grace expiry, sleep recovery, heartbeat timeout, ping timeout
  });
});
