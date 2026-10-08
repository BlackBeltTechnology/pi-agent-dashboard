/**
 * Event wiring for the agent path gate × YOLO frames.
 * See change: yolo-covers-agent-path-gate — test-plan #E26, #E27.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { __resetRefusalLedger, isRefused } from "../access/refusal-ledger.js";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

describe("agent path gate × YOLO wiring", () => {
  let server: DashboardServer;
  let tmp: string;
  const sockets: WebSocket[] = [];

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-yolo-")));
    process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "refusals.json");
    __resetRefusalLedger();
  });
  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
    delete process.env.PI_ACCESS_REFUSALS_STORE;
    __resetRefusalLedger();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function bridge() {
    server = await createServer({ ...baseConfig });
    await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    const frames: any[] = [];
    ws.on("message", (raw) => {
      try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ }
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    sockets.push(ws);
    return { ws, frames };
  }
  const send = (ws: WebSocket, msg: Record<string, unknown>) => ws.send(JSON.stringify(msg));

  it("#E26 dashboard_identity always carries features:[path-yolo]", async () => {
    const { ws, frames } = await bridge();
    send(ws, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli" });
    await wait(150);
    const id = frames.find((f) => f.type === "dashboard_identity");
    expect(id?.features).toEqual(["path-yolo"]);
    if (id && "grantStoreId" in id) expect(typeof id.grantStoreId).toBe("string");
  });

  it("#E27 a gate select prompt is observed, so a deny report is remembered once", async () => {
    const { ws, frames } = await bridge();
    send(ws, { type: "session_register", sessionId: "s1", cwd: "/tmp", source: "cli" });
    send(ws, { type: "replay_complete", sessionId: "s1" });
    await wait(100);
    const dir = path.join(tmp, "denied");
    send(ws, {
      type: "prompt_request", sessionId: "s1", promptId: "p1",
      prompt: { question: "q", type: "select", options: ["Allow once", "Deny"], metadata: { kind: "agent-path-gate", path: path.join(dir, "a.txt"), subject: dir } },
      component: { type: "generic-dialog", props: {} }, placement: "inline",
    });
    await wait(100);
    // an unobserved prompt id records nothing
    send(ws, { type: "path_gate_refusal", sessionId: "s1", promptId: "nope", path: path.join(dir, "a.txt"), subject: dir });
    await wait(80);
    expect(isRefused("agent-path", dir)).toBe(false);
    send(ws, { type: "path_gate_refusal", sessionId: "s1", promptId: "p1", path: path.join(dir, "a.txt"), subject: dir });
    await wait(100);
    expect(isRefused("agent-path", dir)).toBe(true);
    // no YOLO session → a request declines
    send(ws, { type: "path_yolo_request", requestId: "r1", sessionId: "s1", path: path.join(dir, "b.txt"), access: "w", tool: "write" });
    await wait(100);
    expect(frames.find((f) => f.type === "path_yolo_result")).toMatchObject({ requestId: "r1", verdict: expect.stringMatching(/decline|refused/) });
  });
});
