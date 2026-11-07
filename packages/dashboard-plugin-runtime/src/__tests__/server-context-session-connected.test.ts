/**
 * test-plan #X9 — connectivity source for plugins: `isConnected` follows the
 * gateway's open socket for a trusted plugin, and is always false for an
 * untrusted one. See change: polish-automation-board (design D2).
 */
import { describe, expect, it } from "vitest";
import { createPluginSessionManager } from "../server/server-context.js";

function make(trusted: boolean, open: Set<string>) {
  return createPluginSessionManager({
    listActive: () => [],
    listAll: () => [],
    getSession: () => undefined,
    isSessionConnected: (id) => open.has(id),
    trusted,
  });
}

describe("PluginSessionManager.isConnected", () => {
  it("trusted: follows the socket (open → true, closed → false)", () => {
    const open = new Set(["s1"]);
    const sm = make(true, open);
    expect(sm.isConnected?.("s1")).toBe(true);
    expect(sm.isConnected?.("s2")).toBe(false);
    open.delete("s1");
    expect(sm.isConnected?.("s1")).toBe(false);
  });

  it("untrusted: always false, even with an open socket", () => {
    const sm = make(false, new Set(["s1"]));
    expect(sm.isConnected?.("s1")).toBe(false);
    expect(sm.isConnected?.("s2")).toBe(false);
  });
});
