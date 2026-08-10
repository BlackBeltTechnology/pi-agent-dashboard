/**
 * Regression: the server's `roles_list` re-broadcast to browser clients MUST
 * forward `builtinRoleNames` end-to-end. The bridge attaches it (source of
 * truth = DEFAULT_ROLE_NAMES); dropping it on the relay collapses the Roles
 * settings panel to its flat back-compat render and makes custom roles
 * (@fast-style) unreachable in the UI.
 *
 * See change: fix-builtin-role-names-relay.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });
  return ws;
}

describe("roles_list — server relay preserves builtinRoleNames", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
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
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("forwards builtinRoleNames from the bridge roles_list to browser clients", async () => {
    const piWs = await connectSession(piPort, "r1");
    const browserWs = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    const browserMessages: any[] = [];
    await new Promise<void>((resolve) => browserWs.on("open", () => resolve()));
    browserWs.on("message", (raw) => {
      try {
        browserMessages.push(JSON.parse(raw.toString()));
      } catch { /* ignore */ }
    });
    await wait(80);
    browserMessages.length = 0;

    const builtin = ["planning", "coding", "compact", "fast", "vision", "research"];
    piWs.send(JSON.stringify({
      type: "roles_list",
      sessionId: "r1",
      roles: { fast: "deepseek/deepseek-v4-flash" },
      presets: [],
      activePreset: null,
      builtinRoleNames: builtin,
    }));

    await wait(80);

    const rolesList = browserMessages.find((m) => m.type === "roles_list");
    expect(rolesList).toBeDefined();
    expect(rolesList.builtinRoleNames).toEqual(builtin);
    expect(rolesList.roles).toEqual({ fast: "deepseek/deepseek-v4-flash" });

    piWs.close();
    browserWs.close();
  });
});
