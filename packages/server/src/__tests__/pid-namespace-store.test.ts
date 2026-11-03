/**
 * `pidNamespace` is stored atomically with `pid` on the direct and the
 * provisional register path, sanitised (S7), and never persisted (S5: `pid`
 * itself is persisted nowhere, so neither is its namespace).
 * Test-plan rows E70–E75, E104, E106 (wiring), E109 (1 MB).
 * See change: scope-pids-to-namespace.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { resolvePidTarget } from "../session/pid-target.js";
import { sessionFromMeta } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";
import { delay, until, waitForBind, waitForOpen } from "./pi-gateway-duplicate-register.test.js";

const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_CTR: PidNamespace = { ...RL, nsId: "pid:[4026532999]" };
const RL_WSL: PidNamespace = {
  platform: "linux",
  kind: "wsl",
  distro: "Ubuntu-24.04",
  hostId: "boot-W",
  nsId: "pid:[4026531840]",
};
const SL = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };

describe("session manager stores pidNamespace atomically with pid", () => {
  it("E70: a re-register with a new pid and no namespace drops the stale namespace", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 5, pidNamespace: RL_WSL });
    expect(sm.get("s")?.pidNamespace).toEqual(RL_WSL);
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 6 });
    expect(sm.get("s")?.pid).toBe(6);
    expect(sm.get("s")?.pidNamespace).toBeUndefined();
  });

  it("E71: a register without pid clears pid, pidRecordedAt and pidNamespace", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 5, pidNamespace: RL });
    sm.register({ id: "s", cwd: "/a", source: "tui", pidNamespace: RL });
    const s = sm.get("s")!;
    expect(s.pid).toBeUndefined();
    expect(s.pidRecordedAt).toBeUndefined();
    expect(s.pidNamespace).toBeUndefined();
  });

  it("E75: a legacy register stores no namespace and does not throw", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 4242 });
    expect(sm.get("s")?.pidNamespace).toBeUndefined();
  });

  it("E106: a malformed namespace is stored as an unusable report (null)", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 4242, pidNamespace: { kind: "wsl" } });
    expect(sm.get("s")?.pidNamespace).toBeNull();
    expect(resolvePidTarget(sm.get("s")!, SL).kind).toBe("unknown");
  });

  it("E109: a 1 MB hostId is not stored", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s", cwd: "/a", source: "tui", pid: 4242, pidNamespace: { ...RL, hostId: "x".repeat(1_000_000) } });
    expect(sm.get("s")?.pidNamespace).toBeNull();
    expect(JSON.stringify(sm.get("s")).length).toBeLessThan(10_000);
  });
});

describe("E104: neither pid nor pidNamespace is persisted (design S5, decision A)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("meta carries no pid / namespace, and a restored session has neither", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pidns-"));
    dirs.push(dir);
    const sessionFile = path.join(dir, "s.jsonl");
    const live = {
      id: "s",
      cwd: "/home/u/p",
      source: "tui",
      status: "active",
      startedAt: 1,
      hidden: false,
      sessionFile,
      pid: 4242,
      pidNamespace: RL_WSL,
    } as DashboardSession;
    const meta = sessionToMeta(live) as Record<string, unknown>;
    expect(meta).not.toHaveProperty("pid");
    expect(meta).not.toHaveProperty("pidNamespace");
    expect(JSON.stringify(meta)).not.toContain("boot-W");
    const restored = sessionFromMeta("s", sessionFile, dir, meta as never, Date.now());
    expect(restored.pid).toBeUndefined();
    expect(restored.pidNamespace).toBeUndefined();
  });
});

// ── provisional path, through a real gateway ────────────────────────────────
const gateways: Array<{ stop: () => void }> = [];
const sockets: WebSocket[] = [];
afterEach(() => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const g of gateways.splice(0)) g.stop();
});

async function startGateway() {
  const sessions = createMemorySessionManager();
  const gw = createPiGateway(sessions, { pingInterval: 0, instanceId: "instance-dest" });
  gw.start(0, "127.0.0.1");
  gateways.push(gw);
  const port = await waitForBind(gw);
  return { gw, sessions, port };
}
async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on("error", () => {});
  sockets.push(ws);
  await waitForOpen(ws);
  return ws;
}
const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve, reject) => {
    ws.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString())));
    setTimeout(() => reject(new Error("no message")), 2000).unref?.();
  });

async function provisionalCommit(port: number, sessionId: string, extra: Record<string, unknown>) {
  const ws = await connect(port);
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/a", source: "tui", provisional: true, ...extra }));
  const accepted = await nextMessage(ws);
  expect(accepted.type).toBe("provisional_accepted");
  ws.send(JSON.stringify({ type: "session_move_commit", sessionId, token: accepted.token }));
  await delay(80);
  return ws;
}

describe("provisional register keeps the namespace with the pid", () => {
  it("E72: a committed provisional stores pid and namespace", async () => {
    const { sessions, port } = await startGateway();
    await provisionalCommit(port, "p1", { pid: 1083, pidNamespace: RL_WSL });
    await until(() => sessions.get("p1") !== undefined);
    expect(sessions.get("p1")?.pid).toBe(1083);
    expect(sessions.get("p1")?.pidNamespace).toEqual(RL_WSL);
  });

  it("E73: a later direct register replaces both, never mixing", async () => {
    const { sessions, port } = await startGateway();
    const ws = await provisionalCommit(port, "p2", { pid: 100, pidNamespace: RL });
    await until(() => sessions.get("p2")?.pid === 100);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "p2", cwd: "/a", source: "tui", pid: 200, pidNamespace: RL_CTR }));
    await until(() => sessions.get("p2")?.pid === 200);
    expect(sessions.get("p2")?.pidNamespace).toEqual(RL_CTR);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "p2", cwd: "/a", source: "tui", pid: 201 }));
    await until(() => sessions.get("p2")?.pid === 201);
    expect(sessions.get("p2")?.pidNamespace).toBeUndefined();
  });

  it("E74: a provisional namespace without a pid is not stored", async () => {
    const { sessions, port } = await startGateway();
    await provisionalCommit(port, "p3", { pidNamespace: RL });
    await until(() => sessions.get("p3") !== undefined);
    expect(sessions.get("p3")?.pid).toBeUndefined();
    expect(sessions.get("p3")?.pidNamespace).toBeUndefined();
  });

  it("E106: a malformed namespace on the wire still registers", async () => {
    const { sessions, port } = await startGateway();
    const ws = await connect(port);
    for (const [i, bad] of [{ kind: "wsl" }, { platform: 42 }, { ...RL, nsId: null }, [RL], "linux"].entries()) {
      ws.send(JSON.stringify({ type: "session_register", sessionId: `m${i}`, cwd: "/a", source: "tui", pid: 4242, pidNamespace: bad }));
      await until(() => sessions.get(`m${i}`)?.pid === 4242);
      expect(sessions.get(`m${i}`)?.pidNamespace).toBeNull();
      expect(resolvePidTarget(sessions.get(`m${i}`)!, SL).kind).toBe("unknown");
    }
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
