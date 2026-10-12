/**
 * Host B transport: register payload, buffering, reconnect, heartbeat.
 * See change: add-acp-session-driver (test-plan #E27, #E41, #X5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { startHostB } from "../main.js";
import { fakeAgentLauncher, SESSION_ID } from "./adapter-harness.js";
import { type FakeGateway, startFakeGateway } from "./fake-gateway.js";

const agent = { id: "qmt", name: "querymt", command: "qmtcode", args: [], env: {}, durable: true };
const closers: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function boot(gw: FakeGateway, extra: { knobs?: never; spawnToken?: string } = {}) {
  const exits: number[] = [];
  const fake = fakeAgentLauncher({ protocol: 1 });
  const host = startHostB({
    agent,
    settings: { ...DEFAULT_ACP_SETTINGS },
    cwd: "/work/repo",
    sessionId: SESSION_ID,
    spawnToken: extra.spawnToken,
    endpoint: () => gw.url,
    launchAgent: fake.launch,
    log: () => {},
    onExit: (c) => exits.push(c),
  });
  closers.push(() => host.client.close());
  return { host, exits, fake };
}

describe("host B gateway client", () => {
  it("E27: first frame is session_register with the full field set, before the agent spawns", async () => {
    const gw = await startFakeGateway();
    closers.push(() => gw.close());
    const { fake } = await boot(gw, { spawnToken: "tok" });
    await gw.waitFor(() => gw.frames.length > 0);
    expect(gw.frames[0]).toMatchObject({
      type: "session_register",
      sessionId: SESSION_ID,
      cwd: "/work/repo",
      source: "dashboard",
      pid: process.pid,
      hasUI: false,
      dashboardSpawned: true,
      spawnToken: "tok",
      registerReason: "spawn",
      driver: "acp",
      acpAgentId: "qmt",
    });
    expect(gw.frames[0]).not.toHaveProperty("eventCount");
    // register is the very first thing the adapter does — it precedes the agent launch
    expect(typeof gw.frames[0]?.sessionFile).toBe("string");
    await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"));
    expect(fake.state.launches).toBe(1);
  });

  it("X5: gateway down at start → backoff retries, frames buffered, register delivered once, no duplicate", async () => {
    // reserve a port, then release it so the first dial is refused
    const probe = await startFakeGateway();
    const port = Number(new URL(probe.url).port);
    await probe.close();
    const exits: number[] = [];
    const fake = fakeAgentLauncher({ protocol: 1 });
    const host = startHostB({
      agent,
      settings: { ...DEFAULT_ACP_SETTINGS },
      cwd: "/w",
      sessionId: SESSION_ID,
      endpoint: () => `ws://127.0.0.1:${port}`,
      launchAgent: fake.launch,
      log: () => {},
      onExit: (c) => exits.push(c),
    });
    closers.push(() => host.client.close());
    await new Promise((r) => setTimeout(r, 700)); // at least one failed dial
    const gw = await startFakeGateway(port);
    closers.push(() => gw.close());
    await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"), 6000);
    expect(gw.frames.filter((f) => f.type === "session_register")).toHaveLength(1);
    expect(gw.frames[0]?.type).toBe("session_register");
    expect(exits).toEqual([]);
  });

  it("E41: heartbeat every 15 s while connected", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const gw = await startFakeGateway();
      closers.push(() => gw.close());
      await boot(gw);
      await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"));
      const hb = () => gw.frames.filter((f) => f.type === "session_heartbeat");
      expect(hb()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(45_000);
      await gw.waitFor(() => hb().length >= 3);
      expect(hb().length).toBeGreaterThanOrEqual(3);
      expect(hb()[0]).toMatchObject({ sessionId: SESSION_ID });
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes server frames to the adapter (send_prompt reaches the agent)", async () => {
    const gw = await startFakeGateway();
    closers.push(() => gw.close());
    const { fake } = await boot(gw);
    await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"));
    gw.send({ type: "send_prompt", sessionId: SESSION_ID, text: "hello", promptId: "p1" });
    await gw.waitFor(() => gw.frames.some((f) => f.type === "event_forward" && f.event.eventType === "agent_settled"));
    expect(fake.state.agent?.received.some((m) => m.method === "session/prompt")).toBe(true);
    expect(gw.frames.find((f) => f.type === "prompt_received")).toMatchObject({ fresh: true, promptId: "p1" });
  });
});
