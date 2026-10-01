/**
 * WS non-session command classification (D10/D14/D24; task 18.28). Every
 * `NON_SESSION_MESSAGES` member carries an `{ action, resource }` so the
 * optional host policy can decide it; plugin-owned frames are namespaced.
 */
import { describe, expect, it } from "vitest";
import { NON_SESSION_MESSAGES } from "../ws-message-scope.js";
import { classifyWsRoad } from "../ws-road-classification.js";

describe("classifyWsRoad", () => {
  it("classifies every NON_SESSION_MESSAGES member", () => {
    const missing = [...NON_SESSION_MESSAGES].filter((type) => classifyWsRoad({ type, pluginId: "p" }) === undefined);
    expect(missing).toEqual([]);
  });

  it("maps families with the message type and a cwd when present", () => {
    expect(classifyWsRoad({ type: "openspec_get", cwd: "/w" })).toEqual({
      action: "openspec.read",
      resource: { kind: "openspec", ws: "openspec_get", cwd: "/w" },
    });
    expect(classifyWsRoad({ type: "create_terminal" })?.action).toBe("terminal.create");
    expect(classifyWsRoad({ type: "kill_terminal" })?.action).toBe("terminal.write");
    expect(classifyWsRoad({ type: "spawn_session", cwd: "/w" })?.action).toBe("workspace.write");
    expect(classifyWsRoad({ type: "grant_response" })?.action).toBe("access.write");
    expect(classifyWsRoad({ type: "plugin_config_write", id: "kb" })).toEqual({
      action: "plugins.write",
      resource: { kind: "plugin", ws: "plugin_config_write", pluginId: "kb" },
    });
  });

  it("ignores a non-string cwd (bounded plain data)", () => {
    expect(classifyWsRoad({ type: "openspec_get", cwd: { evil: 1 } })?.resource).toEqual({
      kind: "openspec",
      ws: "openspec_get",
    });
  });

  it("plugin_action is namespaced by its target pluginId", () => {
    expect(classifyWsRoad({ type: "plugin_action", pluginId: "automation", action: "run" })).toEqual({
      action: "plugin:automation:write",
      resource: { kind: "plugin", ws: "plugin_action", pluginId: "automation" },
    });
  });

  it("a plugin-registered custom frame is namespaced by its registering plugin", () => {
    expect(classifyWsRoad({ type: "acme_sync" }, "acme")).toEqual({
      action: "plugin:acme:write",
      resource: { kind: "plugin", ws: "acme_sync", pluginId: "acme" },
    });
  });

  it("an unknown frame with no owner is unclassified (fail-closed under a policy)", () => {
    expect(classifyWsRoad({ type: "who_knows" })).toBeUndefined();
    expect(classifyWsRoad({ type: "plugin_action" })).toBeUndefined(); // no pluginId
  });
});
