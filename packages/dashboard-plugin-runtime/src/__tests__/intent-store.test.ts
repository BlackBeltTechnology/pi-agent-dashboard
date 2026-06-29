/**
 * Tests for client-side IntentStore.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IntentStore } from "../intent-store.js";
import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";

const sampleIntent: IntentNode = {
  primitive: "ui:action-list",
  props: { actions: [{ label: "Run X" }] },
};

describe("IntentStore", () => {
  let store: IntentStore;

  beforeEach(() => {
    store = new IntentStore();
  });

  it("set + getForSlot returns the intent under the right pluginId", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const intents = store.getForSlot("session-card-action-bar", "abc");
    expect(intents.size).toBe(1);
    expect(intents.get("flows")).toEqual(sampleIntent);
  });

  it("setting null intent removes the entry", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      null,
    );
    expect(store.getForSlot("session-card-action-bar", "abc").size).toBe(0);
  });

  it("subscribers are notified on set", () => {
    const cb = vi.fn();
    store.subscribe(cb);
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("subscribers are notified on clear via null intent", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const cb = vi.fn();
    store.subscribe(cb);
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      null,
    );
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setting null on an absent key does NOT notify", () => {
    const cb = vi.fn();
    store.subscribe(cb);
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      null,
    );
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const cb = vi.fn();
    const unsubscribe = store.subscribe(cb);
    unsubscribe();
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    expect(cb).not.toHaveBeenCalled();
  });

  it("clearForSession removes only entries for that session", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    store.set(
      { pluginId: "flows", sessionId: "xyz", slot: "session-card-action-bar" },
      sampleIntent,
    );
    store.clearForSession("abc");
    expect(store.getForSlot("session-card-action-bar", "abc").size).toBe(0);
    expect(store.getForSlot("session-card-action-bar", "xyz").size).toBe(1);
  });

  it("getForSlot result is reference-stable between mutations", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const first = store.getForSlot("session-card-action-bar", "abc");
    const second = store.getForSlot("session-card-action-bar", "abc");
    expect(first).toBe(second);
  });

  it("getForSlot returns a different reference after mutation", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const first = store.getForSlot("session-card-action-bar", "abc");
    store.set(
      { pluginId: "goal", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const second = store.getForSlot("session-card-action-bar", "abc");
    expect(first).not.toBe(second);
    expect(second.size).toBe(2);
  });

  it("multiple plugins can occupy the same slot+session", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    store.set(
      { pluginId: "goal", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    const intents = store.getForSlot("session-card-action-bar", "abc");
    expect(intents.size).toBe(2);
    expect(intents.has("flows")).toBe(true);
    expect(intents.has("goal")).toBe(true);
  });

  it("supports global slots with sessionId=null", () => {
    store.set(
      { pluginId: "subagents", sessionId: null, slot: "settings-section" },
      sampleIntent,
    );
    expect(store.getForSlot("settings-section", null).size).toBe(1);
    expect(store.getForSlot("settings-section", "abc").size).toBe(0);
  });

  it("__resetForTests clears all state", () => {
    store.set(
      { pluginId: "flows", sessionId: "abc", slot: "session-card-action-bar" },
      sampleIntent,
    );
    store.__resetForTests();
    expect(store.getForSlot("session-card-action-bar", "abc").size).toBe(0);
  });
});
