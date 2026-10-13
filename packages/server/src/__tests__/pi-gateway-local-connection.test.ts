/**
 * Host A: the in-process ACP session attaches to the REAL gateway through a
 * LocalBridgeSocket and runs the same per-connection handling as a WS bridge.
 * See change: add-acp-session-driver (test-plan #E47, #E50).
 */
import { afterEach, describe, expect, it } from "vitest";
import { LocalBridgeSocket } from "../acp-bridge/local-bridge-socket.js";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { _setSpawnRegisterWatchdogForTests, SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(10);
  }
  throw new Error("condition not met within timeout");
}

const SID = "11111111-2222-4333-8444-555555555555";

describe("gateway.attachLocalConnection", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  afterEach(() => {
    gateway?.stop();
    _setSpawnRegisterWatchdogForTests(null);
  });

  function setup() {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    const toCore: Array<Record<string, any>> = [];
    const socket = new LocalBridgeSocket((m) => toCore.push(m as never));
    const disconnects: string[] = [];
    (gateway as unknown as { onDisconnect?: (id: string) => void }).onDisconnect = (id) => disconnects.push(id);
    gateway.attachLocalConnection(socket);
    return { sessionManager, socket, toCore, disconnects };
  }
  const register = (socket: LocalBridgeSocket, extra: Record<string, unknown> = {}) =>
    socket.receive({ type: "session_register", sessionId: SID, cwd: "/work/repo", source: "dashboard", hasUI: false, dashboardSpawned: true, driver: "acp", acpAgentId: "qmt", registerReason: "spawn", ...extra } as never);

  it("E47: registers once, clears the spawn watchdog by token, acks heartbeats, handles close", async () => {
    const wd = new SpawnRegisterWatchdog(60_000, { findPidsBySpawnToken: () => [], kill: () => {} });
    _setSpawnRegisterWatchdogForTests(wd);
    wd.arm({ cwd: "/work/repo", mechanism: "headless", spawnToken: "tok", timeoutMs: 60_000 } as never);
    const { sessionManager, socket, toCore } = setup();
    register(socket, { spawnToken: "tok" });
    await until(() => sessionManager.get(SID) !== undefined);
    expect(sessionManager.listAll().filter((s) => s.id === SID)).toHaveLength(1);
    // the watchdog entry for "tok" was consumed: clearing it again finds nothing
    expect(wd.clearByToken("tok")).toBe(false);

    socket.receive({ type: "session_heartbeat", sessionId: SID } as never);
    await until(() => toCore.some((m) => m.type === "heartbeat_ack"));

    socket.close();
    await delay(30);
    expect(socket.readyState).toBe(3);
  });

  it("E50: an in-process session is a local origin with driver + agent recorded", async () => {
    const { sessionManager, socket } = setup();
    register(socket);
    await until(() => sessionManager.get(SID) !== undefined);
    const s = sessionManager.get(SID);
    expect(s?.originDeviceId).toBeUndefined(); // absent ⇒ local
    expect(s?.driver).toBe("acp");
    expect(s?.acpAgentId).toBe("qmt");
    expect(s?.hidden).toBe(false); // hasUI:false but dashboardSpawned:true ⇒ visible
  });

  it("E43b: a bridge that omits driver never downgrades it; an unknown driver value is dropped", async () => {
    const { sessionManager, socket } = setup();
    register(socket, { driver: "evil", acpAgentId: "x".repeat(500) });
    await until(() => sessionManager.get(SID) !== undefined);
    expect(sessionManager.get(SID)?.driver).toBeUndefined();
    expect(sessionManager.get(SID)?.acpAgentId).toBeUndefined();
  });

  it("gateway → core delivery goes through sendToSession; the virtual socket is 'alive' for contention probes", async () => {
    const { sessionManager, socket, toCore } = setup();
    register(socket);
    await until(() => sessionManager.get(SID) !== undefined);
    expect(gateway.sendToSession(SID, { type: "send_prompt", sessionId: SID, text: "hi" })).toBe(true);
    expect(toCore.some((m) => m.type === "send_prompt" && m.text === "hi")).toBe(true);
    expect(gateway.isSessionConnected(SID)).toBe(true);
    expect(gateway.findLiveSessionBySessionFile).toBeDefined();
  });
});
