/**
 * Ack deadline of the sudo credential relay: a subscribed browser counts as
 * able to answer only once it sent `sudo_credential_shown {callId}`; with no
 * ack within 2 000 ms the server relays a non-sticky refusal to the bridge.
 *
 * See change: add-sudo-credential-prompt (task 4.6, test-plan #S41).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, makeSudoHarness, request, sudoFramesOf, type SudoHarness } from "./helpers/sudo-credential-kit.js";

const shown = (callId: string, sessionId = "s1") => ({ type: "sudo_credential_shown", sessionId, callId });
const UNANSWERABLE = (callId: string) => ({ type: "sudo_credential_cancel", sessionId: "s1", callId, reason: "unanswerable" });

describe("sudo credential ack deadline (2 000 ms)", () => {
  let h: SudoHarness;
  beforeEach(() => {
    // Only the timer pair: the gateway harness awaits `setImmediate`.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    h = makeSudoHarness();
  });
  afterEach(() => {
    h.relay.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const cancels = () => h.bridgeFrames.filter((f) => f.msg.type === "sudo_credential_cancel").map((f) => f.msg);

  it("no ack: nothing before 2 000 ms, then a non-sticky refusal to the bridge", async () => {
    const b = await h.connect({ principal: undefined, tier: "control" });
    h.relay.handleRequest("s1", request("s1", "C1"));
    vi.advanceTimersByTime(1_999);
    expect(cancels()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(cancels()).toEqual([UNANSWERABLE("C1")]);
    // The browser is told to drop its dialog.
    expect(sudoFramesOf(b).map((f) => f.type)).toEqual(["sudo_credential_request", "sudo_credential_dismiss"]);
  });

  it("an ack at 1 999 ms keeps the prompt pending, answerable afterwards", async () => {
    const b = await h.connect({ tier: "control" });
    h.relay.handleRequest("s1", request("s1", "C1"));
    vi.advanceTimersByTime(1_999);
    await deliver(b, shown("C1"));
    vi.advanceTimersByTime(60_000);
    expect(cancels()).toEqual([]);
    await deliver(b, { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "pw" });
    expect(h.bridgeFrames.filter((f) => f.msg.type === "sudo_credential_response")).toHaveLength(1);
  });

  it("one valid ack suffices; two acks are harmless", async () => {
    const b1 = await h.connect({ tier: "control" });
    const b2 = await h.connect({ tier: "control" }); // stale tab: never acks
    h.relay.handleRequest("s1", request("s1", "C1"));
    await deliver(b1, shown("C1"));
    await deliver(b1, shown("C1"));
    await deliver(b2, shown("C1"));
    vi.advanceTimersByTime(10_000);
    expect(cancels()).toEqual([]);
  });

  it("a wrong-callId ack is ignored", async () => {
    const b = await h.connect({ tier: "control" });
    h.relay.handleRequest("s1", request("s1", "C1"));
    await deliver(b, shown("C-other"));
    await deliver(b, shown("C1", "s2"));
    vi.advanceTimersByTime(2_000);
    expect(cancels()).toEqual([UNANSWERABLE("C1")]);
  });

  it("an ack after the refusal is ignored (no resurrection)", async () => {
    const b = await h.connect({ tier: "control" });
    h.relay.handleRequest("s1", request("s1", "C1"));
    vi.advanceTimersByTime(2_000);
    await deliver(b, shown("C1"));
    await deliver(b, { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "late" });
    expect(cancels()).toEqual([UNANSWERABLE("C1")]);
    expect(h.bridgeFrames.some((f) => f.msg.type === "sudo_credential_response")).toBe(false);
  });

  it("the refusal is not sticky: a later request from a current client is served", async () => {
    const b = await h.connect({ tier: "control" });
    h.relay.handleRequest("s1", request("s1", "C1"));
    vi.advanceTimersByTime(2_000);
    h.relay.handleRequest("s1", request("s1", "C2"));
    await deliver(b, shown("C2"));
    vi.advanceTimersByTime(10_000);
    expect(cancels()).toEqual([UNANSWERABLE("C1")]);
    expect(sudoFramesOf(b).filter((f) => f.type === "sudo_credential_request").map((f) => f.callId)).toEqual(["C1", "C2"]);
  });
});
