/**
 * Server-side cleanup when a bridge's WebSocket closes while a sudo prompt is
 * pending and cache metadata is held: `piGateway.onDisconnect` clears the slot
 * and tells the owning (control-tier) subscribers — and only them (S70).
 *
 * See change: add-sudo-credential-prompt (task 4.14, test-plan #S70).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSudoHarness, OWNER, request, sudoFramesOf } from "./helpers/sudo-credential-kit.js";
import { bootSudoRig } from "./helpers/sudo-server-kit.js";

describe("sudo credential teardown on bridge disconnect", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("real server: closing the bridge socket clears slot + cache and notifies owners of THAT session only", async () => {
    const rig = await bootSudoRig();
    try {
      const bridge = await rig.bridge("s-t1");
      const other = await rig.bridge("s-t2");
      const owner = await rig.browser("s-t1");
      const bystander = await rig.browser("s-t2");
      bridge.send({ type: "sudo_credential_cache", sessionId: "s-t1", expiresAt: 5_000_000_000_000 });
      bridge.send({ type: "sudo_credential_request", sessionId: "s-t1", callId: "C1", commands: ["sudo ls"], prompt: "[sudo] password: " });
      await owner.waitFor((f) => f.type === "sudo_credential_request");
      owner.send({ type: "sudo_credential_shown", sessionId: "s-t1", callId: "C1" });

      bridge.ws.close();
      await owner.waitFor((f) => f.type === "sudo_credential_dismiss" && f.callId === "C1");
      await owner.waitFor((f) => f.type === "sudo_credential_cache" && f.expiresAt === null);
      expect(bystander.of("sudo_credential_dismiss", "sudo_credential_cache")).toEqual([]);

      // Slot freed: a reconnected bridge for the same session is served (not refused as slot-busy).
      const again = await rig.bridge("s-t1");
      again.send({ type: "sudo_credential_request", sessionId: "s-t1", callId: "C2", commands: ["sudo ls"], prompt: "[sudo] password: " });
      await owner.waitFor((f) => f.type === "sudo_credential_request" && f.callId === "C2");
      expect(again.of("sudo_credential_cancel")).toEqual([]);
      expect(other.of("sudo_credential_cancel")).toEqual([]);
    } finally {
      await rig.dispose();
    }
  }, 30_000);

  it("observe-tier owner subscribers get neither the dismiss nor the cache clear", async () => {
    const h = makeSudoHarness();
    const control = await h.connect({ principal: OWNER, tier: "control" });
    const observe = await h.connect({ principal: OWNER, tier: "observe" });
    h.relay.handleCache("s1", { type: "sudo_credential_cache", sessionId: "s1", expiresAt: 7 });
    h.relay.handleRequest("s1", request("s1", "C1"));
    h.relay.onBridgeDisconnect("s1");
    expect(sudoFramesOf(control).map((f) => f.type)).toEqual([
      "sudo_credential_cache", "sudo_credential_request", "sudo_credential_dismiss", "sudo_credential_cache",
    ]);
    expect(sudoFramesOf(observe)).toEqual([]);
    h.relay.dispose();
  });
});
