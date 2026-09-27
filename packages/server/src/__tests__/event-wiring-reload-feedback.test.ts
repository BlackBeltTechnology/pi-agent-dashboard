/**
 * Event-wiring settle hook for forwarded reloads (design D5), end to end over
 * the real bridge socket: a terminal `/reload` `command_feedback` passes
 * through once and settles the watch. The replay-skip-window branch (#X11) is
 * pinned at unit level in dispatch-reload-forwarded-watch.test.ts.
 * See change: fix-terminal-session-dashboard-reload (test-plan #E9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  _resetForwardedReloads,
  type DispatchReloadContext,
  dispatchReload,
} from "../rpc-keeper/dispatch-reload.js";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fwd(sessionId: string, eventType: string, data: Record<string, unknown>) {
  return JSON.stringify({ type: "event_forward", sessionId, event: { eventType, timestamp: Date.now(), data } });
}

function reloadFeedbackRows(server: DashboardServer, sid: string) {
  return server.eventStore
    .getEvents(sid, 1)
    .filter((e: any) => e.event.eventType === "command_feedback" && e.event.data?.command === "/reload");
}

function watchCtx(feedback: string[]): DispatchReloadContext {
  return {
    headlessPidRegistry: { getPid: () => undefined, listSessions: () => [] },
    getSession: () => ({ status: "idle" }),
    isSessionConnected: () => true,
    sendToSession: () => true,
    respawn: async () => {},
    emitCommandFeedback: (_s, _c, status, message) => feedback.push(`${status}:${message ?? ""}`),
  };
}

describe("event-wiring: forwarded /reload feedback", () => {
  let server: DashboardServer;
  let piPort: number;

  beforeEach(async () => {
    _resetForwardedReloads();
    vi.spyOn(console, "log").mockImplementation(() => {});
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
    _resetForwardedReloads();
    vi.restoreAllMocks();
  });

  async function openBridge(sid: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => resolve());
    });
    ws.send(JSON.stringify({ type: "session_register", sessionId: sid, cwd: "/tmp/reload-fb", source: "cli", eventCount: 1 }));
    ws.send(JSON.stringify({ type: "replay_complete", sessionId: sid }));
    await wait(100);
    return ws;
  }

  it("feedback outside a replay window passes through once and settles the watch", async () => {
    const SID = "reload-fb-live";
    const ws = await openBridge(SID);
    const deadline: string[] = [];
    await dispatchReload(SID, watchCtx(deadline));
    const frames: any[] = [];
    (server.browserGateway as any).addInProcessSubscriber(SID, (m: unknown) => frames.push(m));
    ws.send(fwd(SID, "command_feedback", { command: "/reload", status: "completed" }));
    await wait(100);
    expect(reloadFeedbackRows(server, SID)).toHaveLength(1);
    expect(
      frames.filter((m) => m?.type === "event" && m.event?.data?.command === "/reload"),
    ).toHaveLength(1);
    expect(await dispatchReload(SID, watchCtx(deadline))).toBe("forwarded");
    ws.close();
  });
});
