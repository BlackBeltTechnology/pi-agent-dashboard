/**
 * WS message → tier map is total over the browser protocol.
 * `ws-message-scope.test.ts` proves SESSION_OWNED ∪ SESSION_LIST ∪ NON_SESSION
 * equals the `BrowserToServerMessage` union, so equality with that set here
 * makes the tier map total transitively. See change: add-passkey-user-auth.
 */
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
