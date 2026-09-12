/**
 * Full-server handover scenarios for the goal product hosted in goal-plugin.
 *
 * The REAL goal plugin loads via workspace discovery; `spawnPiSession` is
 * mocked so driver spawns stay in-process, and the spawn TOKEN the mock sees
 * is what the test sends back over a real bridge `session_register` — the
 * same token-correlated ownership path production uses.
 *
 * Covers test-plan #E26 (restore path does not link — the accepted D2
 * `replaceDriver` divergence is pinned, not latent): a driver whose ref was
 * promoted onto the pid registry re-registers WITHOUT a pending token after a
 * keeper restart → the owning plugin is NOT notified, the goal's driver is
 * NOT replaced, no re-prime happens, the ref still re-merges in memory, and
 * the goal's status stays exactly as persisted (respawning) instead of
 * flipping to pursuing.
 *
 * See change: relocate-goal-product-to-plugin (D2).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const h = vi.hoisted(() => ({ spawnPiSessionMock: vi.fn() }));
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../spawn-process/process-manager.js")>();
  return { ...mod, spawnPiSession: h.spawnPiSessionMock };
});

import { createServer, type DashboardServer } from "../server.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/** Collect text frames of a WS as parsed objects. */
function collect(ws: WebSocket): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  ws.on("message", (raw) => {
    try {
      frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
    } catch { /* non-JSON */ }
  });
  return frames;
}

async function registerBridge(
  piPort: number,
  msg: Record<string, unknown>,
): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await waitForOpen(ws);
  // Collect from BEFORE the register send — the owner-notify + primer happen
  // inside the register path, before first-event forwarding.
  const frames = collect(ws);
  ws.send(JSON.stringify({ type: "session_register", source: "cli", ...msg }));
  await delay(250);
  return { ws, frames };
}

const API = (port: number) => `http://127.0.0.1:${port}`;

async function api(port: number, method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API(port)}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe("goal-plugin handover on the real server (E26)", () => {
  let server: DashboardServer;
  let port: number;
  let piPort: number;
  let cwd: string;
  let goalId: string;
  const sockets: WebSocket[] = [];
  let pidSeq = 100;

  beforeEach(async () => {
    h.spawnPiSessionMock.mockReset();
    h.spawnPiSessionMock.mockImplementation(async (_cwd: string, opts: { spawnToken?: string }) => {
      const proc = new EventEmitter() as EventEmitter & { kill: () => boolean; pid?: number };
      proc.kill = () => true;
      proc.pid = pidSeq + 1;
      return { success: true, spawnToken: opts.spawnToken, pid: ++pidSeq, process: proc };
    });
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    port = server.httpPort()!;
    piPort = server.piPort()!;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "goal-handover-"));

    // Make the folder a KNOWN cwd (host.knownFolderCwds = session cwds ∪
    // pinned dirs) so the goal routes' cwd validation admits it.
    sockets.push((await registerBridge(piPort, { sessionId: "anchor", cwd })).ws);

    // Create the goal and spawn + register its first driver (token-correlated).
    const created = await api(port, "POST", `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`, {
      objective: "pursue the objective",
      autoRespawn: true,
    });
    expect(created.status).toBe(201);
    goalId = created.json.data.id as string;
  });

  afterEach(async () => {
    for (const ws of sockets) try { ws.close(); } catch { /* ignore */ }
    await server.stop();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  async function spawnDriver(): Promise<{ token: string }> {
    const res = await api(port, "POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`, {
      spawn: true,
    });
    expect(res.status).toBe(200);
    // The mock saw the spawn options → the token the "bridge" will carry.
    const last = h.spawnPiSessionMock.mock.calls.at(-1)!;
    const token = (last[1] as { spawnToken?: string }).spawnToken!;
    expect(token).toBeTruthy();
    return { token };
  }

  async function goalRecord(): Promise<Record<string, any>> {
    const res = await api(port, "GET", `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`);
    return (res.json.data as Array<Record<string, any>>).find((g) => g.id === goalId)!;
  }

  it("E26: restore re-register does not link, does not re-prime, and pins the persisted status", async () => {
    // 1. Driver s1 registers via its token → first link + one primer.
    const { token: tok1 } = await spawnDriver();
    const { ws: ws1, frames: frames1 } = await registerBridge(piPort, {
      sessionId: "s1",
      cwd,
      spawnToken: tok1,
      pid: pidSeq,
    });
    sockets.push(ws1);
    await delay(300);
    expect((await goalRecord()).driverSessionId).toBe("s1");
    expect((await goalRecord()).status).toBe("pursuing");
    const primesOnS1 = frames1.filter(
      (f) => f.type === "send_prompt" && String(f.text ?? "").startsWith("/goal"),
    );
    expect(primesOnS1).toHaveLength(1);

    // 2. A respawned driver s2 registers → replaceDriver hands over to s2.
    const { token: tok2 } = await spawnDriver();
    const { ws: ws2, frames: frames2 } = await registerBridge(piPort, {
      sessionId: "s2",
      cwd,
      spawnToken: tok2,
      pid: pidSeq,
    });
    sockets.push(ws2);
    await delay(300);
    expect((await goalRecord()).driverSessionId).toBe("s2");
    // Primer went to the NEW driver exactly once.
    const primesOnS2 = frames2.filter(
      (f) => f.type === "send_prompt" && String(f.text ?? "").startsWith("/goal"),
    );
    expect(primesOnS2).toHaveLength(1);

    // 3. s2 dies (transport-independent unregister) → respawning, driver still s2.
    ws2.send(JSON.stringify({ type: "session_unregister", sessionId: "s2" }));
    await delay(400);
    const afterDeath = await goalRecord();
    expect(afterDeath.status).toBe("respawning");
    expect(afterDeath.driverSessionId).toBe("s2");

    // 4. s1's keeper restarts: the old socket dies, a NEW bridge socket
    // re-registers s1 WITHOUT a pending token (the ref was promoted onto the
    // pid registry at first register). Restore path: no owner-notify, no
    // link, no re-prime.
    ws1.close();
    await delay(150);
    const { ws: ws1b, frames: frames1b } = await registerBridge(piPort, {
      sessionId: "s1",
      cwd,
      pid: pidSeq,
    });
    sockets.push(ws1b);
    await delay(400);

    // a. No replaceDriver: the driver is still s2.
    expect((await goalRecord()).driverSessionId).toBe("s2");
    // b. THE PIN: the persisted status is untouched — today core's
    // replaceDriver would have flipped it to pursuing; the restore path must
    // not (design D2 accepted divergence, asserted not latent).
    expect((await goalRecord()).status).toBe("respawning");
    // c. No second /goal prime reached s1.
    const newPrimes = frames1b.filter(
      (f) => f.type === "send_prompt" && String(f.text ?? "").startsWith("/goal"),
    );
    expect(newPrimes).toHaveLength(0);
    // d. The promoted ref still re-merged in memory: s1 carries goalId again.
    const sessions = await api(port, "GET", "/api/sessions");
    const s1 = (sessions.json.sessions ?? sessions.json.data ?? []).find?.(
      (s: Record<string, unknown>) => s.id === "s1",
    );
    expect(s1?.goalId).toBe(goalId);
  });
});
