/**
 * Tests for bridge-probe recording in PluginStatusStore — see change
 * fix-pi-flows-end-to-end (Group 2, task 2.5).
 */
import { describe, expect, it } from "vitest";
import { createPluginStatusStore } from "../server/plugin-status-store.js";

describe("PluginStatusStore.recordBridgeProbe", () => {
  it("stores latest probe and exposes via listAll().lastProbe", () => {
    const store = createPluginStatusStore();
    store.setStatus({ id: "demo", displayName: "demo", enabled: true, loaded: true, claims: 0 });
    store.recordBridgeProbe("demo", {
      status: "active",
      peers: { "@x": { ok: true } },
      at: 1000,
    });
    const list = store.listAll();
    expect(list).toHaveLength(1);
    expect(list[0].lastProbe?.status).toBe("active");
    expect(list[0].lastProbe?.at).toBe(1000);
  });

  it("keeps the most recent probe (higher `at` wins)", () => {
    const store = createPluginStatusStore();
    store.setStatus({ id: "demo", displayName: "demo", enabled: true, loaded: true, claims: 0 });
    store.recordBridgeProbe("demo", { status: "probing", peers: {}, at: 1000 });
    store.recordBridgeProbe("demo", { status: "active", peers: {}, at: 2000 });
    expect(store.getBridgeProbe("demo")?.status).toBe("active");
  });

  it("ignores stale probe (lower `at`)", () => {
    const store = createPluginStatusStore();
    store.setStatus({ id: "demo", displayName: "demo", enabled: true, loaded: true, claims: 0 });
    store.recordBridgeProbe("demo", { status: "active", peers: {}, at: 2000 });
    store.recordBridgeProbe("demo", { status: "probing", peers: {}, at: 1000 });
    expect(store.getBridgeProbe("demo")?.status).toBe("active");
  });

  it("does not pollute lastProbe of unrelated plugins", () => {
    const store = createPluginStatusStore();
    store.setStatus({ id: "a", displayName: "a", enabled: true, loaded: true, claims: 0 });
    store.setStatus({ id: "b", displayName: "b", enabled: true, loaded: true, claims: 0 });
    store.recordBridgeProbe("a", { status: "active", peers: {}, at: 1000 });
    const list = store.listAll();
    const a = list.find((x) => x.id === "a")!;
    const b = list.find((x) => x.id === "b")!;
    expect(a.lastProbe).toBeDefined();
    expect(b.lastProbe).toBeUndefined();
  });

  it("persists requirements and missingRequirements fields verbatim", () => {
    // Repo-lint per change add-plugin-activation-ui task 7.3:
    // every PluginStatus field must round-trip through the store.
    const store = createPluginStatusStore();
    store.setStatus({
      id: "with-req",
      displayName: "With Reqs",
      enabled: true,
      loaded: true,
      claims: 0,
      requirements: {
        piExtensions: [{ name: "pi-web-access", satisfied: false }],
        binaries: [{ name: "zrok", satisfied: true, resolvedPath: "/usr/bin/zrok" }],
        services: [{ name: "model-proxy", satisfied: false, error: "unreachable" }],
        paths: [],
      },
      missingRequirements: ["pi-web-access", "model-proxy"],
    });
    const got = store.getStatus("with-req");
    expect(got?.requirements?.piExtensions[0].satisfied).toBe(false);
    expect(got?.requirements?.binaries[0].resolvedPath).toBe("/usr/bin/zrok");
    expect(got?.requirements?.services[0].error).toBe("unreachable");
    expect(got?.missingRequirements).toEqual(["pi-web-access", "model-proxy"]);
  });

  it("recordBridgeProbe for unknown pluginId is silently dropped at listAll time", () => {
    const store = createPluginStatusStore();
    // No setStatus for "ghost"
    store.recordBridgeProbe("ghost", { status: "active", peers: {}, at: 1000 });
    expect(store.listAll()).toHaveLength(0);
    // But probe IS retained — if the plugin is registered later, the latest
    // probe is surfaced. This matches the bridge-probe-first-then-discover
    // timing that can happen at server start.
    store.setStatus({ id: "ghost", displayName: "ghost", enabled: true, loaded: true, claims: 0 });
    expect(store.listAll()[0].lastProbe?.status).toBe("active");
  });
});

// decouple-plugins-from-core (tasks 6.6, 6.7): read-time client resolver + serveApp side map.
describe("PluginStatusStore client resolver and serveApp outcome", () => {
  const row = { id: "demo", displayName: "demo", enabled: true, loaded: true, claims: 0 };

  it("resolves `client` at every read, never stores it", () => {
    const store = createPluginStatusStore();
    let state: "runtime" | "bundled" = "runtime";
    store.setStatus(row);
    store.setClientResolver(() => ({ delivery: state }));
    expect(store.getStatus("demo")?.client).toEqual({ delivery: "runtime" });
    state = "bundled";
    expect(store.listAll()[0].client).toEqual({ delivery: "bundled" });
    expect(store.getStoredStatus("demo")?.client).toBeUndefined();
  });

  it("a resolver returning undefined keeps the stored client; clearing the resolver restores stored rows", () => {
    const store = createPluginStatusStore();
    store.setStatus({ ...row, client: { delivery: "refused", refusedReason: "host-api" } });
    store.setClientResolver(() => undefined);
    expect(store.getStatus("demo")?.client?.refusedReason).toBe("host-api");
    store.setClientResolver(() => ({ delivery: "bundled" }));
    store.setClientResolver(null);
    expect(store.getStatus("demo")?.client?.refusedReason).toBe("host-api");
  });

  it("serveApp outcome survives a later setStatus from the loader; refusal is sticky", () => {
    const store = createPluginStatusStore();
    store.recordServeApp("demo", "mounted");
    store.setStatus(row);
    expect(store.getStatus("demo")?.serveApp).toBe("mounted");
    store.recordServeApp("demo", "refused");
    store.setStatus({ ...row, loaded: false });
    expect(store.listAll()[0].serveApp).toBe("refused");
    store.recordServeApp("demo", "mounted");
    expect(store.getStatus("demo")?.serveApp).toBe("refused");
  });
});
