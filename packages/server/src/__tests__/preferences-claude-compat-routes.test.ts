/**
 * Claude subscription compat switch routes + relay snapshot.
 *
 * PATCH broadcasts ONE `preferences_update` carrying the full snapshot (both
 * bridge-relevant preferences) to every connected bridge; a bridge that
 * registers later receives the current value through the same snapshot.
 *
 * See change: retire-anthropic-messages-bridge (test-plan #E11).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPreferencesClaudeCompatRoutes } from "../routes/preferences-claude-compat-routes.js";
import { buildPreferencesUpdate } from "../preferences-relay.js";

function fakeStore(initial = { autoName: true, compat: false }) {
  let autoName = initial.autoName;
  let compat = initial.compat;
  return {
    getAutoNameSessions: () => autoName,
    setAutoNameSessions: (v: boolean) => { autoName = v; },
    getClaudeSubscriptionCompat: () => compat,
    setClaudeSubscriptionCompat: (v: boolean) => { compat = v; },
  };
}

function fakeGateway(sessionIds: string[]) {
  const outbox = new Map<string, unknown[]>(sessionIds.map((id) => [id, []]));
  return {
    outbox,
    broadcast(msg: unknown) {
      for (const list of outbox.values()) list.push(msg);
    },
    register(id: string, store: ReturnType<typeof fakeStore>) {
      outbox.set(id, [buildPreferencesUpdate(store as never)]);
    },
  };
}

describe("PATCH /api/preferences/claude-subscription-compat", () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof fakeStore>;
  let gateway: ReturnType<typeof fakeGateway>;

  beforeEach(async () => {
    store = fakeStore();
    gateway = fakeGateway(["s1", "s2", "s3"]);
    app = Fastify();
    registerPreferencesClaudeCompatRoutes(app, {
      preferencesStore: store as never,
      piGateway: gateway as never,
      networkGuard: async () => {},
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("E11: broadcasts one full snapshot to each connected session; a later register gets the new value", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/preferences/claude-subscription-compat",
      payload: { value: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ claudeSubscriptionCompat: true });

    for (const id of ["s1", "s2", "s3"]) {
      expect(gateway.outbox.get(id)).toEqual([
        { type: "preferences_update", autoNameSessions: true, claudeSubscriptionCompat: true },
      ]);
    }

    gateway.register("s4", store);
    expect(gateway.outbox.get("s4")).toEqual([
      { type: "preferences_update", autoNameSessions: true, claudeSubscriptionCompat: true },
    ]);
  });

  it("GET returns the current value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/preferences/claude-subscription-compat" });
    expect(res.json()).toEqual({ claudeSubscriptionCompat: false });
  });

  it("rejects a non-boolean body without broadcasting", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/preferences/claude-subscription-compat",
      payload: { value: "yes" },
    });
    expect(res.statusCode).toBe(400);
    for (const list of gateway.outbox.values()) expect(list).toEqual([]);
    expect(store.getClaudeSubscriptionCompat()).toBe(false);
  });
});
