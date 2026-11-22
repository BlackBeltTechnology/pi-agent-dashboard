/**
 * Sudo credential relay behind the REAL browser-gateway message loop:
 * D5 authz (S38), binding (S39), first answer wins (S40), observe-tier
 * fan-out (S83) and empty/over-long password rejection (S85, relay half).
 *
 * See change: add-sudo-credential-prompt (tasks 4.1-4.5).
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliver, framesOf, makeSudoHarness, OTHER, OWNER, request, sudoFramesOf,
  type FakeBrowser, type SudoHarness,
} from "./helpers/sudo-credential-kit.js";

const respond = (sessionId: string, callId: string, password: unknown) => ({
  type: "sudo_credential_response", sessionId, callId, password,
});

/** Bridge frames of one type. */
const bridgeOf = (h: SudoHarness, type: string) => h.bridgeFrames.filter((f) => f.msg.type === type);

describe("sudo credential gateway", () => {
  let h: SudoHarness;
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const k of ["log", "error", "warn", "info"] as const) {
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
    }
  });
  afterEach(() => {
    h?.relay.dispose();
    vi.restoreAllMocks();
  });

  // S38 — D5 authz
  describe("D5 authz: who may answer", () => {
    type Case = { name: string; sender: () => Promise<FakeBrowser>; relayed: boolean };
    const cases = (): Case[] => [
      { name: "owner@control", sender: () => h.connect({ principal: OWNER, tier: "control" }), relayed: true },
      { name: "paired control device", sender: () => h.connect({ principal: OWNER, tier: "control" }), relayed: true },
      {
        name: "plain-HTTP non-loopback LAN owner (no TLS)",
        sender: () => h.connect({ principal: OWNER, req: { socket: { remoteAddress: "192.168.1.20", encrypted: false } } }),
        relayed: true,
      },
      { name: "owner@observe", sender: () => h.connect({ principal: OWNER, tier: "observe" }), relayed: false },
      { name: "non-owner@control", sender: () => h.connect({ principal: OTHER, tier: "control" }), relayed: false },
      { name: "principal-less (resolver active)", sender: () => h.connect({}), relayed: false },
    ];

    for (const c of cases()) {
      it(`${c.name}: ${c.relayed ? "relayed to the bridge" : "dropped (no bridge frame, no throw)"}`, async () => {
        h = makeSudoHarness({ active: true });
        // An answerable receiver keeps the request pending regardless of the sender under test.
        const receiver = await h.connect({ principal: OWNER, tier: "control" });
        const sender = await (cases().find((x) => x.name === c.name)!).sender();
        h.relay.handleRequest("s1", request("s1", "C1"));
        expect(sudoFramesOf(receiver).map((f) => f.type)).toEqual(["sudo_credential_request"]);

        await expect(deliver(sender, respond("s1", "C1", "pw-S38"))).resolves.toBeUndefined();

        const responses = bridgeOf(h, "sudo_credential_response");
        if (c.relayed) {
          expect(responses).toHaveLength(1);
          expect(responses[0].msg).toMatchObject({ sessionId: "s1", callId: "C1", password: "pw-S38" });
        } else {
          expect(responses).toHaveLength(0);
          // Still pending: the legitimate owner can answer afterwards.
          await deliver(receiver, respond("s1", "C1", "pw-real"));
          expect(bridgeOf(h, "sudo_credential_response").map((f) => (f.msg as { password: string }).password)).toEqual(["pw-real"]);
        }
      });
    }
  });

  // S39 — D5 binding
  describe("D5 binding to the pending (sessionId, callId)", () => {
    it("drops wrong callId, wrong sessionId, a finished callId and the in-flight toolCallId", async () => {
      h = makeSudoHarness();
      const b = await h.connect({ principal: OWNER, tier: "control" });
      await deliver(b, { type: "subscribe", sessionId: "s2" });
      h.relay.handleRequest("s1", request("s1", "C1"));

      await deliver(b, respond("s1", "C2", "pw"));
      await deliver(b, respond("s2", "C1", "pw"));
      await deliver(b, respond("s1", "toolu_01INFLIGHT", "pw")); // callId equal to the in-flight toolCallId
      expect(bridgeOf(h, "sudo_credential_response")).toHaveLength(0);

      await deliver(b, respond("s1", "C1", "pw-ok"));
      expect(bridgeOf(h, "sudo_credential_response")).toHaveLength(1);

      // Replay of the finished C1 is dropped (no second delivery).
      await deliver(b, respond("s1", "C1", "pw-replay"));
      expect(bridgeOf(h, "sudo_credential_response")).toHaveLength(1);
    });

    it("binds each of 10 000 generated callIds: all distinct, none equals a toolCallId, stale ones never deliver", async () => {
      h = makeSudoHarness();
      const b = await h.connect({ principal: OWNER, tier: "control" });
      const toolCallIds = new Set<string>();
      const callIds = new Set<string>();
      let previous: string | undefined;
      for (let i = 0; i < 10_000; i++) {
        const toolCallId = `toolu_${i}`;
        toolCallIds.add(toolCallId);
        const callId = randomBytes(16).toString("hex");
        callIds.add(callId);
        h.relay.handleRequest("s1", request("s1", callId));
        if (previous) h.relay.handleBrowserMessage(b, respond("s1", previous, "stale") as never);
        h.relay.handleBrowserMessage(b, respond("s1", toolCallId, "tool") as never);
        h.relay.handleBrowserMessage(b, respond("s1", callId, `pw-${i}`) as never);
        previous = callId;
      }
      expect(callIds.size).toBe(10_000);
      expect([...callIds].some((id) => toolCallIds.has(id))).toBe(false);
      const delivered = bridgeOf(h, "sudo_credential_response").map((f) => (f.msg as { password: string }).password);
      expect(delivered).toHaveLength(10_000);
      expect(delivered.some((p) => p === "stale" || p === "tool")).toBe(false);
    });
  });

  // S40 — first answer wins
  describe("D5 first answer wins", () => {
    it("two browsers answering in the same tick: exactly one _response, the loser is dismissed, no password leaks", async () => {
      h = makeSudoHarness();
      const b1 = await h.connect({ principal: OWNER, tier: "control" });
      const b2 = await h.connect({ principal: OWNER, tier: "control" });
      h.relay.handleRequest("s1", request("s1", "C1"));

      b1.emit("message", Buffer.from(JSON.stringify(respond("s1", "C1", "pw-B1-winner"))));
      b2.emit("message", Buffer.from(JSON.stringify(respond("s1", "C1", "pw-B2-LOSER-canary"))));
      await new Promise((r) => setImmediate(r));

      const responses = bridgeOf(h, "sudo_credential_response");
      expect(responses).toHaveLength(1);
      expect((responses[0].msg as { password: string }).password).toBe("pw-B1-winner");
      expect(sudoFramesOf(b2).filter((f) => f.type === "sudo_credential_dismiss")).toEqual([
        { type: "sudo_credential_dismiss", sessionId: "s1", callId: "C1" },
      ]);

      // The loser's password appears in no log, event store or session record.
      const haystack = JSON.stringify([logs, h.eventStore.getEvents("s1", 1), h.sessionManager.listAll(), framesOf(b1), framesOf(b2)]);
      expect(haystack).not.toContain("pw-B2-LOSER-canary");
      expect(haystack).not.toContain("pw-B1-winner");
    });
  });

  // S83 — observe-tier fan-out
  describe("D5 / G7 observe-tier sockets are not fan-out targets", () => {
    it("only the control socket receives the request and dismiss; the observe socket's _shown is no ack", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        h = makeSudoHarness();
        const control = await h.connect({ principal: OWNER, tier: "control" });
        const observe = await h.connect({ principal: OWNER, tier: "observe" });
        h.relay.handleRequest("s1", request("s1", "C1"));

        expect(sudoFramesOf(control).map((f) => f.type)).toEqual(["sudo_credential_request"]);
        expect(sudoFramesOf(observe)).toEqual([]);

        await deliver(observe, { type: "sudo_credential_shown", sessionId: "s1", callId: "C1" });
        vi.advanceTimersByTime(2_000);
        // The observe ack did not count: the control socket never acked, so the prompt is refused.
        expect(bridgeOf(h, "sudo_credential_cancel").map((f) => f.msg)).toEqual([
          { type: "sudo_credential_cancel", sessionId: "s1", callId: "C1", reason: "unanswerable" },
        ]);

        h.relay.handleRequest("s1", request("s1", "C2"));
        h.relay.handleDismiss("s1", { type: "sudo_credential_dismiss", sessionId: "s1", callId: "C2" });
        expect(sudoFramesOf(control).filter((f) => f.type === "sudo_credential_dismiss").map((f) => f.callId)).toEqual(["C1", "C2"]);
        expect(sudoFramesOf(observe)).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("only an observe socket subscribed: refused at once, no ack timer started", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        h = makeSudoHarness();
        const observe = await h.connect({ principal: OWNER, tier: "observe" });
        h.relay.handleRequest("s1", request("s1", "C1"));
        expect(bridgeOf(h, "sudo_credential_cancel").map((f) => f.msg)).toEqual([
          { type: "sudo_credential_cancel", sessionId: "s1", callId: "C1", reason: "unanswerable" },
        ]);
        expect(vi.getTimerCount()).toBe(0);
        expect(sudoFramesOf(observe)).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // S85 — relay half: empty / over-long answers
  describe("G5 empty and over-long passwords are dropped server-side", () => {
    it("empty and 1 025 chars are dropped and the prompt stays pending; 1 024 is delivered once", async () => {
      h = makeSudoHarness();
      const b = await h.connect({ principal: OWNER, tier: "control" });
      h.relay.handleRequest("s1", request("s1", "C1"));

      await expect(deliver(b, respond("s1", "C1", ""))).resolves.toBeUndefined();
      await expect(deliver(b, respond("s1", "C1", "x".repeat(1025)))).resolves.toBeUndefined();
      await expect(deliver(b, respond("s1", "C1", undefined))).resolves.toBeUndefined();
      await expect(deliver(b, respond("s1", "C1", 12345))).resolves.toBeUndefined();
      expect(bridgeOf(h, "sudo_credential_response")).toHaveLength(0);

      await deliver(b, respond("s1", "C1", "y".repeat(1024)));
      const delivered = bridgeOf(h, "sudo_credential_response");
      expect(delivered).toHaveLength(1);
      expect((delivered[0].msg as { password: string }).password).toHaveLength(1024);
    });
  });
});
