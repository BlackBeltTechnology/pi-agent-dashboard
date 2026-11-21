/**
 * Fan-out of a sudo credential request: the full command reaches every hop
 * untruncated (S14), and a socket that cannot be written to counts as "no
 * answerable browser" (S71).
 *
 * See change: add-sudo-credential-prompt (tasks 4.11, 4.12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, framesOf, makeSudoHarness, OWNER, request, sudoFramesOf } from "./helpers/sudo-credential-kit.js";
import { bootSudoRig } from "./helpers/sudo-server-kit.js";

const UNANSWERABLE = (callId: string) => ({ type: "sudo_credential_cancel", sessionId: "s1", callId, reason: "unanswerable" });

describe("sudo credential fan-out", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // S14 — D4 full command, no hidden text
  describe("D4 full command at every hop", () => {
    const lengths = [1, 10_000, 1_048_576];

    for (const n of lengths) {
      it(`relay → browser frame keeps a ${n}-char command (not truncated, not dropped)`, async () => {
        const h = makeSudoHarness();
        const b = await h.connect({ principal: OWNER, tier: "control" });
        const command = "x".repeat(n);
        h.relay.handleRequest("s1", request("s1", "C1", { commands: [command] }));
        const frames = sudoFramesOf(b).filter((f) => f.type === "sudo_credential_request");
        expect(frames).toHaveLength(1);
        expect((frames[0].commands as string[])[0].length).toBe(n);
        h.relay.dispose();
      });

      it(`bridge → server → browser (real sockets) keeps a ${n}-char command`, async () => {
        const rig = await bootSudoRig();
        try {
          const bridge = await rig.bridge("s-big");
          const browser = await rig.browser("s-big");
          bridge.send({ type: "sudo_credential_request", sessionId: "s-big", callId: "C1", commands: ["y".repeat(n)], prompt: "[sudo] password: " });
          const got = await browser.waitFor((f) => f.type === "sudo_credential_request", 15_000);
          expect(got.commands[0].length).toBe(n);
          expect(got.commands).toHaveLength(1);
        } finally {
          await rig.dispose();
        }
      }, 30_000);
    }
  });

  // S71 — D9 fan-out failure
  describe("D9 fan-out failure", () => {
    it("a single subscribed socket that throws on send: refused at once, no slot leaked, no unhandled rejection", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown) => unhandled.push(e);
      process.on("unhandledRejection", onUnhandled);
      try {
        const h = makeSudoHarness();
        const b = await h.connect({ principal: OWNER, tier: "control" });
        b.send.mockImplementation(() => { throw new Error("EPIPE"); });

        expect(() => h.relay.handleRequest("s1", request("s1", "C1"))).not.toThrow();
        expect(h.bridgeFrames.map((f) => f.msg)).toEqual([UNANSWERABLE("C1")]);

        // No pending slot leaked: with a healthy socket the next request is served (not slot-busy).
        b.send.mockReset();
        h.relay.handleRequest("s1", request("s1", "C2"));
        expect(sudoFramesOf(b).map((f) => f.callId)).toEqual(["C2"]);
        expect(h.bridgeFrames).toHaveLength(1);

        await new Promise((r) => setImmediate(r));
        expect(unhandled).toEqual([]);
        h.relay.dispose();
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("one throwing socket among several does not stop the healthy one", async () => {
      const h = makeSudoHarness();
      const bad = await h.connect({ principal: OWNER, tier: "control" });
      const good = await h.connect({ principal: OWNER, tier: "control" });
      bad.send.mockImplementation(() => { throw new Error("EPIPE"); });
      h.relay.handleRequest("s1", request("s1", "C1"));
      expect(sudoFramesOf(good).map((f) => f.type)).toEqual(["sudo_credential_request"]);
      expect(h.bridgeFrames.some((f) => f.msg.type === "sudo_credential_cancel")).toBe(false);
      // the answer still goes through
      await deliver(good, { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "pw" });
      expect(h.bridgeFrames.filter((f) => f.msg.type === "sudo_credential_response")).toHaveLength(1);
      expect(framesOf(good).length).toBeGreaterThan(0);
      h.relay.dispose();
    });
  });
});
