/**
 * Wiring of the lead host into the bridge entry (task 3.5, design D10): the capability probe at `session_start`, on the first
 * `subagents:*` event and after an empty reply, each reported as an `inproc hello` on the lane type `agent-teams/inproc`.
 * The host is OFF unless enabled (`inProcessHost`), and never created for a teammate or a confined session, so session-mode bridges are
 * byte-for-byte what they were: no probe, no extra lane request.
 * See change: add-agent-teams-in-process.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { spawnCommand } from "../../__tests__/harness/inproc-host-env.js";
import { createDoubleBus, installSubagentsDouble } from "../../__tests__/harness/subagents-double.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../../shared/plugin-id.js";
import { SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import { type BridgeOptions, createBridge, type PiLike } from "../index.js";
import type { LaneClient } from "../lane.js";

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(opts: Partial<BridgeOptions> = {}, env: Record<string, string | undefined> = {}) {
  const bus = createDoubleBus();
  const handlers = new Map<string, Handler[]>();
  const probes: unknown[] = [];
  bus.on(SUBAGENTS_CHANNEL.capabilities, (q) => void probes.push(q));
  const requests: Array<Record<string, unknown>> = [];
  const ok = { ok: true as const, data: {} };
  const lane: LaneClient = {
    call: async () => ok,
    hello: async () => ({ ok: true, data: { role: "plain" } as never }),
    busy: async () => ok,
    idle: async () => ok,
    ack: async () => ok,
    inproc: async (payload) => (requests.push(payload), ok),
  };
  const pi: PiLike = {
    on: (event, handler) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerTool: () => undefined,
    getActiveTools: () => [],
    setActiveTools: () => undefined,
    events: { on: (name, fn) => bus.on(name, fn), emit: (name, payload) => bus.emit(name, payload) },
  };
  const bridge = createBridge(pi, { env, lane, sleep: async () => undefined, laneUp: () => false, ...opts });
  const fire = async (event: string, payload: unknown = {}) => {
    for (const h of handlers.get(event) ?? []) await h(payload, {});
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return { bus, bridge, fire, probes, requests };
}

const hellos = (requests: Array<Record<string, unknown>>) => requests.filter((r) => r.op === "hello");

describe("bridge wiring of the in-process host (task 3.5)", () => {
  it("default (the host is not enabled): no probe, no inproc request, no host: session mode is untouched", async () => {
    const h = harness();
    await h.fire("session_start");
    expect(h.probes).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
    expect(h.bridge.inProcHost).toBeUndefined();
  });

  it("enabled, subagents extension absent: session_start probes once and reports subagents_extension_missing", async () => {
    const h = harness({ inProcessHost: true });
    await h.fire("session_start");
    expect(h.probes).toHaveLength(1);
    expect(hellos(h.requests)).toEqual([expect.objectContaining({ op: "hello", inProcess: expect.objectContaining({ available: false, reason: "subagents_extension_missing" }) })]);
  });

  it("the probe that lost the race with the subagents activation is repeated on the first subagents:* event: a second hello, available", async () => {
    const h = harness({ inProcessHost: true });
    await h.fire("session_start");
    installSubagentsDouble(h.bus, { clock: new FakeClock() }); // the extension activates one tick later
    h.bus.emit(SUBAGENTS_CHANNEL.created, { agentId: "agent-x" }); // its first event
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(h.probes).toHaveLength(2);
    expect(hellos(h.requests).map((r) => (r.inProcess as { available: boolean }).available)).toEqual([false, true]);
    // a burst of events does not storm the probe
    for (let i = 0; i < 50; i++) h.bus.emit(SUBAGENTS_CHANNEL.created, { agentId: "agent-y" });
    expect(h.probes).toHaveLength(2);
  });

  it("the hello announces an incarnation and a command secret; a lane reconnect re-sends it with the SAME incarnation", async () => {
    const reconnect = { up: false };
    const h = harness({ inProcessHost: true, laneUp: () => reconnect.up, laneWatchMs: 5 });
    installSubagentsDouble(h.bus, { clock: new FakeClock() });
    await h.fire("session_start");
    expect(hellos(h.requests)).toHaveLength(1);
    reconnect.up = true; // the host re-installs the lane global after a socket drop
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const all = hellos(h.requests);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all.map((r) => r.incarnation)).size).toBe(1);
    expect(typeof all[0]?.commandSecret).toBe("string");
    await h.fire("session_shutdown", { reason: "quit" });
  });

  it.each([
    ["a teammate (env hint)", { PI_EXT_AGENT_TEAMS_MEMBER: "bob", PI_EXT_AGENT_TEAMS_TEAM_ID: "t1" }],
    ["a confined session", { PI_EXT_TEAM_TOOLS: "x" }],
  ])("%s never hosts children: no probe, no host", async (_n, env) => {
    const h = harness({ inProcessHost: true }, env);
    await h.fire("session_start");
    expect(h.probes).toHaveLength(0);
    expect(h.bridge.inProcHost).toBeUndefined();
  });

  it("session_shutdown disposes the host: later bus commands and subagents events do nothing", async () => {
    const h = harness({ inProcessHost: true });
    installSubagentsDouble(h.bus, { clock: new FakeClock() });
    await h.fire("session_start");
    const before = h.requests.length;
    await h.fire("session_shutdown", { reason: "reload" });
    h.bus.emit(SUBAGENTS_CHANNEL.created, { agentId: "a" });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(h.requests).toHaveLength(before);
    expect(h.bridge.inProcHost).toBeUndefined();
  });

  it("the spawn path carries the child team extension (tasks 6.2, 6.5): one inline factory per child that can refresh its proxied hello", async () => {
    const h = harness({ inProcessHost: true });
    const double = installSubagentsDouble(h.bus, { clock: new FakeClock() });
    await h.fire("session_start");
    const base = spawnCommand("bob");
    h.bus.emit(AGENT_TEAMS_EVENT_INPROC, { ...base, cmdId: "w1", secret: h.bridge.inProcHost?.commandSecret, spec: { ...(base.spec as object), cwd: process.cwd(), promptFiles: [fileURLToPath(import.meta.url)] } });
    for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
    const factories = double.spawnRequests[0]?.loader?.extensionFactories as Array<{ (pi: unknown): void; refreshHello?: unknown }> | undefined;
    expect(factories).toHaveLength(1);
    expect(typeof factories?.[0]).toBe("function");
    expect(typeof factories?.[0]?.refreshHello).toBe("function");
  });
});
