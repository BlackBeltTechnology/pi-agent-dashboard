/**
 * WS message → tier map is total over the browser protocol.
 * `ws-message-scope.test.ts` proves SESSION_OWNED ∪ SESSION_LIST ∪ NON_SESSION
 * equals the `BrowserToServerMessage` union, so equality with that set here
 * makes the tier map total transitively. See change: add-passkey-user-auth.
 */
import { BROWSER_HOST_CLIENT_TYPES } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { WS_MESSAGE_TIERS, wsMessageTier } from "@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js";
import { describe, expect, it } from "vitest";
import { NON_SESSION_MESSAGES, SESSION_LIST_MESSAGES, SESSION_OWNED_MESSAGES } from "../ws-message-scope.js";

const protocol = new Set([...SESSION_OWNED_MESSAGES, ...SESSION_LIST_MESSAGES, ...NON_SESSION_MESSAGES]);

describe("WS_MESSAGE_TIERS", () => {
  it("lists exactly the protocol's browser→server types", () => {
    expect([...protocol].filter((t) => !Object.hasOwn(WS_MESSAGE_TIERS, t))).toEqual([]);
    expect(Object.keys(WS_MESSAGE_TIERS).filter((t) => !protocol.has(t))).toEqual([]);
  });

  it("unlisted (e.g. plugin-registered) types fail closed at operate", () => {
    expect(wsMessageTier("some_plugin_message")).toBe("operate");
    expect(wsMessageTier("__proto__")).toBe("operate");
  });

  it("craft-web live-control claim / result / gone messages fail closed at operate (observe and control sockets cannot claim)", () => {
    for (const t of ["craft-web/control-claim", "craft-web/control-result", "craft-web/control-gone"]) {
      expect(Object.hasOwn(WS_MESSAGE_TIERS, t), t).toBe(false);
      expect(wsMessageTier(t), t).toBe("operate");
    }
  });

  it("matches the REST tiers of the equivalent routes", () => {
    expect(wsMessageTier("subscribe")).toBe("observe");
    expect(wsMessageTier("send_prompt")).toBe("control"); // POST /api/session/:id/prompt
    expect(wsMessageTier("abort")).toBe("control"); // POST /api/session/:id/abort
    expect(wsMessageTier("spawn_session")).toBe("control"); // POST /api/session/spawn
    expect(wsMessageTier("force_kill")).toBe("operate"); // lifecycle action-level operate
    expect(wsMessageTier("kill_process")).toBe("operate");
    expect(wsMessageTier("create_terminal")).toBe("operate");
    expect(wsMessageTier("grant_response")).toBe("operate"); // POST /api/access/prompts/:id
  });
});

describe("WS_MESSAGE_TIERS — browser_host_* (E33)", () => {
  it("lists every browser→server browser_host_* type at operate", () => {
    for (const t of BROWSER_HOST_CLIENT_TYPES) {
      expect(Object.hasOwn(WS_MESSAGE_TIERS, t), t).toBe(true);
      expect(wsMessageTier(t), t).toBe("operate");
    }
  });
});

/** E59: the WS tables no longer carry the retired flow message types. See change: update-flows-plugin. */
describe("WS tables drop flow_control / flow_management (E59)", () => {
  it("tier, scope and road tables have no flow key; plugin_action is present in each", async () => {
    const { classifyWsRoad } = await import("../ws-road-classification.js");
    for (const t of ["flow_control", "flow_management"]) {
      expect(t in WS_MESSAGE_TIERS, t).toBe(false);
      expect(NON_SESSION_MESSAGES.has(t), t).toBe(false);
      expect(SESSION_OWNED_MESSAGES.has(t), t).toBe(false);
      expect(SESSION_LIST_MESSAGES.has(t), t).toBe(false);
      expect(classifyWsRoad({ type: t }), t).toBeUndefined();
    }
    expect(WS_MESSAGE_TIERS.plugin_action).toBe("operate");
    expect(NON_SESSION_MESSAGES.has("plugin_action") || SESSION_OWNED_MESSAGES.has("plugin_action")).toBe(true);
    expect(classifyWsRoad({ type: "plugin_action", pluginId: "flows" })).toBeDefined();
  });
});
