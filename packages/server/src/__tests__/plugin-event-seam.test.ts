/**
 * emitEventToSession / sendExtensionMessage refuse reserved namespaces and the raw
 * plugin_emit_event lane. See change: harden-trust-and-credential-boundaries (D3; T-E21, E22).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitEventToSession, sendExtensionMessage } from "../plugin-event-seam.js";

afterEach(() => vi.restoreAllMocks());

describe("emitEventToSession", () => {
  it.each(["roles:set", "role:resolve-model", "model:resolve", "prompt:register-adapter", "dashboard:enqueue-followup", "ui:invalidate"])(
    "refuses reserved %s with one warn",
    (t) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi.fn(() => true);
      expect(emitEventToSession(true, send, "s1", t, {})).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["roles", "rolesx:set", "flow:run"])("allows non-reserved %s", (t) => {
    const send = vi.fn(() => true);
    expect(emitEventToSession(true, send, "s1", t, {})).toBe(true);
    expect(send).toHaveBeenCalledWith("s1", { type: "plugin_emit_event", sessionId: "s1", eventType: t, data: {} });
  });
  it("untrusted plugin is refused", () => {
    const send = vi.fn(() => true);
    expect(emitEventToSession(false, send, "s1", "flow:run", {})).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendExtensionMessage", () => {
  it("refuses the raw plugin_emit_event lane", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    expect(sendExtensionMessage(true, send, "s1", { type: "plugin_emit_event", eventType: "roles:set" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("passes other message types", () => {
    const send = vi.fn(() => true);
    expect(sendExtensionMessage(true, send, "s1", { type: "mcp_token_minted" })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
