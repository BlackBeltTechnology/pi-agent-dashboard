/**
 * Refuse-immediately latency (G8): 200 helper requests that nobody can answer
 * are all refused within the budget; none waits the 120 s prompt timeout.
 *
 * See change: add-sudo-credential-prompt (task 4.17, test-plan #S46).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSudoHarness, request } from "./helpers/sudo-credential-kit.js";
import { bootSudoRig } from "./helpers/sudo-server-kit.js";

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

describe("sudo credential refuse-immediately under load", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("relay: 200 requests with no browser are each refused synchronously, no timer started", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const h = makeSudoHarness();
      for (let i = 0; i < 200; i++) h.relay.handleRequest("s1", request("s1", `C${i}`));
      expect(h.bridgeFrames.filter((f) => f.msg.type === "sudo_credential_cancel")).toHaveLength(200);
      expect(vi.getTimerCount()).toBe(0);
      h.relay.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("real server: 200 helper requests over a bridge socket, refuse p95 <= 250 ms, none waits for the timeout", async () => {
    const rig = await bootSudoRig();
    try {
      const bridge = await rig.bridge("s-load"); // no browser subscribed
      const sentAt = new Map<string, number>();
      const refusedAt = new Map<string, number>();
      bridge.ws.on("message", (raw) => {
        const f = JSON.parse(String(raw));
        if (f.type === "sudo_credential_cancel") refusedAt.set(f.callId, performance.now());
      });
      for (let i = 0; i < 200; i++) {
        const callId = `L${i}`;
        sentAt.set(callId, performance.now());
        bridge.send({ type: "sudo_credential_request", sessionId: "s-load", callId, commands: ["sudo true"], prompt: "[sudo] password: " });
      }
      await vi.waitFor(() => expect(refusedAt.size).toBe(200), { timeout: 10_000 });
      const latencies = [...sentAt].map(([id, t0]) => refusedAt.get(id)! - t0);
      expect(p95(latencies)).toBeLessThanOrEqual(250);
      expect(Math.max(...latencies)).toBeLessThan(10_000); // nowhere near the 120 s prompt timeout
      expect(bridge.of("sudo_credential_cancel").every((f) => f.reason === "unanswerable")).toBe(true);
    } finally {
      await rig.dispose();
    }
  }, 30_000);
});
