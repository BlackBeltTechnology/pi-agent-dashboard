/**
 * Host A (in-process) and host B (WebSocket) mount the SAME core: the same
 * scripted agent conversation yields the same browser-visible sequence.
 * See change: add-acp-session-driver (test-plan #E49).
 */

import { DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPiGateway } from "../../pi/pi-gateway.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { startLocalAcpSession } from "../local-host.js";
import { startHostB } from "../main.js";
import { fakeAgentLauncher, SESSION_ID } from "./adapter-harness.js";
import { startFakeGateway } from "./fake-gateway.js";

const agent = { id: "qmt", name: "q", command: "q", args: [], env: {}, durable: false };
const KEEP = new Set(["session_register", "models_list", "commands_list", "prompt_received", "event_forward", "queue_update"]);

const normalize = (msgs: Array<Record<string, any>>): string[] =>
  msgs
    .filter((m) => KEEP.has(m.type))
    .map((m) => (m.type === "event_forward" ? `event:${m.event.eventType}` : m.type));

const waitFor = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("host parity (E49)", () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  for (const protocol of [1, 2] as const) {
    it(`same fake-agent script → same browser-visible sequence (v${protocol})`, async () => {
      // ── host A: real gateway + real session manager
      const sessionManager = createMemorySessionManager();
      const gateway = createPiGateway(sessionManager, { pingInterval: 0 });
      cleanups.push(() => gateway.stop());
      const aMsgs: Array<Record<string, any>> = [];
      gateway.onEvent = (_id, msg) => aMsgs.push(msg as ExtensionToServerMessage as never);
      const fakeA = fakeAgentLauncher({ protocol });
      const started = startLocalAcpSession(
        { attachLocalConnection: (s) => gateway.attachLocalConnection(s), log: () => {} },
        { agent, settings: { ...DEFAULT_ACP_SETTINGS, protocolV2: protocol === 2 }, cwd: "/work", launch: fakeA.launch as never },
      );
      expect(started.success).toBe(true);
      await waitFor(() => aMsgs.some((m) => m.type === "models_list"));
      gateway.sendToSession(started.sessionId as string, { type: "send_prompt", sessionId: started.sessionId as string, text: "hello", promptId: "p1" });
      await waitFor(() => aMsgs.some((m) => m.type === "event_forward" && m.event.eventType === "agent_settled"));

      // ── host B: fake gateway over WebSocket
      const gw = await startFakeGateway();
      cleanups.push(() => gw.close());
      const fakeB = fakeAgentLauncher({ protocol });
      const host = startHostB({
        agent: { ...agent, durable: true },
        settings: { ...DEFAULT_ACP_SETTINGS, protocolV2: protocol === 2 },
        cwd: "/work",
        sessionId: SESSION_ID,
        endpoint: () => gw.url,
        launchAgent: fakeB.launch,
        log: () => {},
        onExit: () => {},
      });
      cleanups.push(() => host.client.close());
      await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"));
      gw.send({ type: "send_prompt", sessionId: SESSION_ID, text: "hello", promptId: "p1" });
      await gw.waitFor(() => gw.frames.some((f) => f.type === "event_forward" && f.event.eventType === "agent_settled"));

      const a = normalize(aMsgs);
      const b = normalize(gw.frames);
      expect(a.length).toBeGreaterThan(10);
      expect(a).toEqual(b);
    });
  }
});
