/**
 * provide/consume cross-plugin service seam on ServerPluginContext.
 *
 * The host owns ONE registry Map shared across every plugin context; a value
 * provided through one context is consumable through another (modeling
 * provider plugin → dependent plugin). Absent names return undefined, never
 * throw. See change: register-plugin-automation-events.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { createPluginServiceRegistry, type PluginServiceRegistry } from "../server/plugin-service-registry.js";
import { createServerPluginContext, type ServerContextDeps } from "../server/server-context.js";

afterEach(() => vi.restoreAllMocks());

/**
 * Deps for ONE plugin over the host-owned registry (the host builds deps per
 * plugin, so `provide` is attributed to that plugin's id — as server.ts does).
 */
function depsFor(registry: PluginServiceRegistry, pluginId: string): ServerContextDeps {
  return {
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    onSessionResolved: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    sendExtensionMessage: () => false,
    consumeAll: <T = unknown>(prefix: string) => registry.entries<T>(prefix),
    spawnSession: async () => ({ success: true }),
    abortSession: () => true,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: (name, value) => { registry.provide(pluginId, name, value); },
    consume: <T = unknown>(name: string) => registry.get<T>(name),
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
  };
}

/** Plugin contexts sharing one registry, each attributed to its own id. */
function world(...ids: string[]) {
  const registry = createPluginServiceRegistry();
  const ctx = Object.fromEntries(
    ids.map((id) => [id, createServerPluginContext(depsFor(registry, id), id)]),
  ) as Record<string, ReturnType<typeof createServerPluginContext>>;
  return { registry, ctx };
}

describe("ServerPluginContext provide/consume", () => {
  it("a value provided by one plugin context is consumable by another", () => {
    const { ctx } = world("automation", "flows");
    const provider = ctx.automation;
    const consumer = ctx.flows;

    const service = { register: () => {} };
    provider.provide("automation.action-registry", service);

    expect(consumer.consume("automation.action-registry")).toBe(service);
  });

  it("consume returns undefined for an absent name without throwing", () => {
    const ctx = world("flows").ctx.flows;
    expect(() => ctx.consume("absent-service")).not.toThrow();
    expect(ctx.consume("absent-service")).toBeUndefined();
  });

  it("provide is last-write-wins under the same name", () => {
    const ctx = world("automation").ctx.automation;
    ctx.provide("svc", 1);
    ctx.provide("svc", 2);
    expect(ctx.consume<number>("svc")).toBe(2);
  });
});

describe("ServerPluginContext consumeAll (publish/collect)", () => {
  it("collects every value under a prefix, regardless of publish order", () => {
    const { registry, ctx } = world("flows", "automation");
    const flows = ctx.flows;
    const automation = ctx.automation;
    // publisher order: flows first, then automation (no ordering guarantee)
    flows.provide("automation.action.flows", { id: "flows.run" });
    // `automation.action.core` is host-owned: a plugin cannot publish another source's key.
    registry.set("automation.action.core", [{ id: "core.prompt" }]);
    automation.provide("unrelated.key", { nope: true });

    const collected = automation.consumeAll<unknown>("automation.action.");
    const keys = collected.map((e) => e.key).sort();
    expect(keys).toEqual(["automation.action.core", "automation.action.flows"]);
  });

  it("returns [] for a prefix with no matches and never throws", () => {
    const ctx = world("automation").ctx.automation;
    expect(() => ctx.consumeAll("nope.")).not.toThrow();
    expect(ctx.consumeAll("nope.")).toEqual([]);
  });
});

describe("automation.action.<source> key ownership (SE20)", () => {
  const KEY = "automation.action.flows";

  it("accepts the owning plugin and records it as provider", () => {
    const { ctx } = world("flows", "automation");
    ctx.flows.provide(KEY, { id: "flows.run" });
    expect(ctx.automation.consume(KEY)).toEqual({ id: "flows.run" });
    expect(ctx.automation.consumeAll(KEY)).toEqual([{ key: KEY, value: { id: "flows.run" }, provider: "flows" }]);
  });

  it("refuses a spoofing plugin; consume still returns the owner's value; no evil entry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = world("flows", "evil", "automation");
    ctx.flows.provide(KEY, "flows-value");
    ctx.evil.provide(KEY, "evil-value");
    expect(ctx.automation.consume(KEY)).toBe("flows-value");
    expect(ctx.automation.consumeAll("automation.action.").some((e) => e.provider === "evil")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("evil");
    expect(String(warn.mock.calls[0]![0])).toContain(KEY);
  });

  it("evil-first: refused, a later flows write is stored", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = world("flows", "evil", "automation");
    ctx.evil.provide(KEY, "evil-value");
    expect(ctx.automation.consume(KEY)).toBeUndefined();
    expect(ctx.automation.consumeAll("automation.action.")).toEqual([]);
    ctx.flows.provide(KEY, "flows-value");
    expect(ctx.automation.consumeAll(KEY)).toEqual([{ key: KEY, value: "flows-value", provider: "flows" }]);
  });

  it("refuses a mismatching source for the core key too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = world("flows", "automation");
    ctx.flows.provide("automation.action.core", "x");
    expect(ctx.automation.consume("automation.action.core")).toBeUndefined();
  });

  it.each(["automation.actionX", "automation.action-registry", "svc.other"])(
    "keys outside the namespace (%s) are accepted with provider = caller",
    (key) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { ctx } = world("flows", "evil");
      ctx.flows.provide(key, 1);
      ctx.evil.provide(`${key}.evil`, 2);
      expect(ctx.flows.consumeAll(key).map((e) => [e.key, e.provider])).toEqual([
        [key, "flows"],
        [`${key}.evil`, "evil"],
      ]);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("the same plugin overwriting its own key: last write wins", () => {
    const { ctx } = world("flows");
    ctx.flows.provide(KEY, 1);
    ctx.flows.provide(KEY, 2);
    expect(ctx.flows.consume<number>(KEY)).toBe(2);
  });
});

describe("consumeAll provider attribution is not aliased (SE21)", () => {
  it("host-set entries carry provider host; mutating a returned entry does not leak", () => {
    const { registry, ctx } = world("flows", "consumer");
    ctx.flows.provide("automation.action.flows", { id: "flows.run" });
    registry.set("automation.action.core", { id: "core.prompt" });

    const first = ctx.consumer.consumeAll<unknown>("automation.action.");
    const byKey = Object.fromEntries(first.map((e) => [e.key, e]));
    expect(byKey["automation.action.flows"]!.provider).toBe("flows");
    expect(byKey["automation.action.core"]!.provider).toBe("host");

    // consumer tampers with its copies
    for (const e of first) {
      (e as { provider: string }).provider = "flows";
      (e as { value: unknown }).value = null;
    }
    const second = Object.fromEntries(ctx.consumer.consumeAll<unknown>("automation.action.").map((e) => [e.key, e]));
    expect(second["automation.action.flows"]).toEqual({
      key: "automation.action.flows", value: { id: "flows.run" }, provider: "flows",
    });
    expect(second["automation.action.core"]!.provider).toBe("host");
    expect(second["automation.action.core"]!.value).toEqual({ id: "core.prompt" });
  });
});

describe("refused provide never throws (SE41)", () => {
  it("returns undefined after one log line naming the plugin and key; later steps run; owner's value intact", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = world("flows", "evil");
    ctx.flows.provide("automation.action.flows", "flows-value");
    let result: unknown = "unset";
    let laterStepRan = false;
    expect(() => {
      result = ctx.evil.provide("automation.action.flows", "evil-value");
      laterStepRan = true;
    }).not.toThrow();
    expect(result).toBeUndefined();
    expect(laterStepRan).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain("evil");
    expect(line).toContain("automation.action.flows");
    expect(ctx.evil.consume("automation.action.flows")).toBe("flows-value");
  });
});

describe("source segment parsing (SE42)", () => {
  it("first segment after the prefix is the source; empty source is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = world("flows", "evil", "automation");
    ctx.flows.provide("automation.action.flows.extra", "ok");
    ctx.evil.provide("automation.action.flows.extra2", "nope");
    ctx.flows.provide("automation.action.", "malformed1");
    ctx.flows.provide("automation.action..x", "malformed2");

    const keys = ctx.automation.consumeAll("automation.action.").map((e) => `${e.key}=${e.provider}`);
    expect(keys).toEqual(["automation.action.flows.extra=flows"]);
    // evil refused (wrong source) + two malformed keys = three log lines
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
