/**
 * Production wiring of the in-process mode: the real plugin entry (`registerPlugin`) constructs the runtime with
 * `inProcess: true`, so the `agent-teams/inproc` lane and the `in-process` mode are registered, and the mode fails
 * closed until a lead reports availability. `createTeamsRuntime` without options keeps the five core lane types.
 * See change: add-agent-teams-in-process.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeUiHost } from "../../__tests__/harness/fake-ui-host.js";
import { createFakeRuntimeHost } from "../../__tests__/harness/index.js";
import { registerPlugin } from "../index.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("registerPlugin enables the in-process mode", () => {
  it("registers lane agent-teams/inproc (hub-local) and the in-process mode, unavailable until a lead announces it", async () => {
    const fake = createFakeRuntimeHost();
    const ui = createFakeUiHost();
    const app = Fastify();
    const ctx = { ...fake.host, fastify: app, broadcastToSubscribers: ui.host.broadcastToSubscribers, assignSessionRef: ui.host.assignSessionRef, identity: { isEnforced: () => false, principalOf: () => null } };
    cleanups.push(() => fake.runShutdownHooks(), () => app.close());
    await registerPlugin(ctx as never);
    expect(fake.registered.get("agent-teams/inproc")?.opts).toEqual({ hubLocalOnly: true });
    expect([...fake.registered.keys()].sort()).toEqual(["agent-teams/ack", "agent-teams/busy", "agent-teams/call", "agent-teams/hello", "agent-teams/idle", "agent-teams/inproc"]);
    const lead = fake.addSession("S-lead", { cwd: "/work" });
    expect(await fake.call(lead, "TeamCreate", { name: "t", mode: "in-process" })).toMatchObject({ ok: false, error: "mode_unavailable" });
    await fake.lane(lead, "agent-teams/inproc", { op: "hello", incarnation: "i", commandSecret: "s", inProcess: { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } } });
    expect((await fake.call(lead, "TeamCreate", { name: "t", mode: "in-process" })).ok).toBe(true);
  });
});
