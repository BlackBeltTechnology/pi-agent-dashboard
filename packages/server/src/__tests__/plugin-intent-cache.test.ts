/**
 * Tests for PluginIntentCache — server-side replay store for plugin intents.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PluginIntentCache } from "../plugin-intent-cache.js";
import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";

const sampleIntent: IntentNode = {
  primitive: "ui:action-list",
  props: { actions: [{ label: "Run X" }] },
};

describe("PluginIntentCache", () => {
  let cache: PluginIntentCache;

  beforeEach(() => {
    cache = new PluginIntentCache();
  });

  it("set + getForSession returns the cached intent", () => {
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    const entries = cache.getForSession("abc");
    expect(entries).toHaveLength(1);
    expect(entries[0].pluginId).toBe("flows");
    expect(entries[0].intent).toEqual(sampleIntent);
  });

  it("setting null intent clears the slot", () => {
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    cache.set("flows", "abc", "session-card-action-bar", null);
    const entries = cache.getForSession("abc");
    expect(entries).toHaveLength(0);
  });

  it("clearForSession removes only entries for that session", () => {
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    cache.set("flows", "xyz", "session-card-action-bar", sampleIntent);
    cache.clearForSession("abc");
    expect(cache.getForSession("abc")).toHaveLength(0);
    expect(cache.getForSession("xyz")).toHaveLength(1);
  });

  it("supports global slots with sessionId=null", () => {
    cache.set("subagents", null, "settings-section", sampleIntent);
    const entries = cache.getForSession(null);
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBeNull();
  });

  it("two plugins can occupy the same slot for the same session", () => {
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    cache.set("goal", "abc", "session-card-action-bar", sampleIntent);
    const entries = cache.getForSession("abc");
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.pluginId))).toEqual(new Set(["flows", "goal"]));
  });

  it("same (pluginId, sessionId, slot) overwrites", () => {
    const newer: IntentNode = { primitive: "ui:status-pill", props: { text: "updated" } };
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    cache.set("flows", "abc", "session-card-action-bar", newer);
    const entries = cache.getForSession("abc");
    expect(entries).toHaveLength(1);
    expect(entries[0].intent).toEqual(newer);
  });

  it("reset clears everything", () => {
    cache.set("flows", "abc", "session-card-action-bar", sampleIntent);
    cache.set("subagents", null, "settings-section", sampleIntent);
    cache.reset();
    expect(cache.getAll()).toHaveLength(0);
  });
});
