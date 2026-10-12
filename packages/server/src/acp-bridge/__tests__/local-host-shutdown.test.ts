/**
 * In-process sessions end when the server stops: the agent dies and the session
 * is persisted as ended with `driver:"acp"`. See change: add-acp-session-driver
 * (test-plan #X9, D1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { createPiGateway } from "../../pi/pi-gateway.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { sessionToMeta } from "../../session/session-to-meta.js";
import { localAcpSessionCount, startLocalAcpSession, stopAllLocalAcpSessions } from "../local-host.js";
import { fakeAgentLauncher } from "./adapter-harness.js";

const agent = { id: "qmt", name: "q", command: "q", args: [], env: {}, durable: false };
const waitFor = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("local host shutdown (X9)", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  afterEach(() => gateway?.stop());

  it("stopAllLocalAcpSessions kills the agent within 3 s and the session ends with driver acp", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    const fake = fakeAgentLauncher({ protocol: 1 });
    const r = startLocalAcpSession(
      { attachLocalConnection: (s) => gateway.attachLocalConnection(s), log: () => {} },
      { agent, settings: { ...DEFAULT_ACP_SETTINGS }, cwd: "/work/x", launch: fake.launch as never },
    );
    const id = r.sessionId as string;
    await waitFor(() => sessionManager.get(id)?.status === "active");
    expect(sessionManager.get(id)).toMatchObject({ driver: "acp", acpAgentId: "qmt", source: "dashboard" });
    expect(localAcpSessionCount()).toBe(1);

    await stopAllLocalAcpSessions();
    await new Promise((res) => setImmediate(res));
    await waitFor(() => (fake.state.handle?.killed.length ?? 0) > 0, 3000);
    await waitFor(() => sessionManager.get(id)?.status === "ended");
    expect(sessionToMeta(sessionManager.get(id) as never)).toMatchObject({ driver: "acp", acpAgentId: "qmt", status: "ended" });
    expect(localAcpSessionCount()).toBe(0);
  });

  it("a launch failure (e.g. Windows .cmd) is a structured failure and registers nothing", () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    const r = startLocalAcpSession(
      { attachLocalConnection: (s) => gateway.attachLocalConnection(s), log: () => {} },
      { agent, settings: { ...DEFAULT_ACP_SETTINGS }, cwd: "/work/x", launch: () => { throw new Error("boom"); } },
    );
    expect(r).toMatchObject({ success: false, message: "boom" });
    expect(localAcpSessionCount()).toBe(0);
  });
});
