/**
 * Lifecycle of the single pending sudo prompt: every way it ends dismisses the
 * modal on all owning browsers and frees the slot (S69).
 *
 * See change: add-sudo-credential-prompt (task 4.13, test-plan #S69).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, makeSudoHarness, OWNER, request, sudoFramesOf, type FakeBrowser, type SudoHarness } from "./helpers/sudo-credential-kit.js";

const dismissedIds = (b: FakeBrowser) => sudoFramesOf(b).filter((f) => f.type === "sudo_credential_dismiss").map((f) => f.callId);
const requestIds = (b: FakeBrowser) => sudoFramesOf(b).filter((f) => f.type === "sudo_credential_request").map((f) => f.callId);

describe("sudo credential pending slot lifecycle", () => {
  let h: SudoHarness;
  let b1: FakeBrowser;
  let b2: FakeBrowser;
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h = makeSudoHarness();
    b1 = await h.connect({ principal: OWNER, tier: "control" });
    b2 = await h.connect({ principal: OWNER, tier: "control" });
    h.relay.handleCache("s1", { type: "sudo_credential_cache", sessionId: "s1", expiresAt: 99_000 });
    h.relay.handleRequest("s1", request("s1", "C1"));
    for (const b of [b1, b2]) await deliver(b, { type: "sudo_credential_shown", sessionId: "s1", callId: "C1" });
  });
  afterEach(() => {
    h.relay.dispose();
    vi.restoreAllMocks();
  });

  const lateResponse = async () => {
    await deliver(b1, { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "late" });
    expect(h.bridgeFrames.some((f) => f.msg.type === "sudo_credential_response")).toBe(false);
  };

  // The bridge reports (a) helper socket closed (SIGKILL), (b) tool_execution_end, (c) abort
  // with the same `sudo_credential_dismiss`; the relay cannot tell them apart and need not.
  for (const cause of ["helper process SIGKILLed (socket close)", "tool_execution_end", "abort"]) {
    it(`${cause}: dismissed on all owners, slot freed, cache unchanged, late _response dropped`, async () => {
      h.relay.handleDismiss("s1", { type: "sudo_credential_dismiss", sessionId: "s1", callId: "C1" });
      expect(dismissedIds(b1)).toEqual(["C1"]);
      expect(dismissedIds(b2)).toEqual(["C1"]);

      await lateResponse();

      // Cache metadata untouched: a joiner still learns {expiresAt: 99000}.
      const joiner = await h.connect({ principal: OWNER, tier: "control" });
      expect(sudoFramesOf(joiner)).toEqual([{ type: "sudo_credential_cache", sessionId: "s1", expiresAt: 99_000 }]);

      // Slot freed: the next request is accepted.
      h.relay.handleRequest("s1", request("s1", "C2"));
      expect(requestIds(b1)).toEqual(["C1", "C2"]);
    });
  }

  it("a dismiss for another callId does not free the slot", async () => {
    h.relay.handleDismiss("s1", { type: "sudo_credential_dismiss", sessionId: "s1", callId: "C-other" });
    expect(dismissedIds(b1)).toEqual([]);
    await deliver(b1, { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "pw" });
    expect(h.bridgeFrames.filter((f) => f.msg.type === "sudo_credential_response")).toHaveLength(1);
  });

  it("bridge disconnect: dismissed on all owners, slot freed, cache cleared, late _response dropped", async () => {
    h.relay.onBridgeDisconnect("s1");
    expect(dismissedIds(b1)).toEqual(["C1"]);
    expect(dismissedIds(b2)).toEqual(["C1"]);
    for (const b of [b1, b2]) {
      expect(sudoFramesOf(b).filter((f) => f.type === "sudo_credential_cache").map((f) => f.expiresAt)).toEqual([99_000, null]);
    }
    await lateResponse();
    h.relay.handleRequest("s1", request("s1", "C2"));
    expect(requestIds(b1)).toEqual(["C1", "C2"]);
  });

  it("server restart: nothing pending, nothing cached, nothing replayed (in-memory only)", async () => {
    h.relay.dispose();
    const fresh = makeSudoHarness();
    const joiner = await fresh.connect({ principal: OWNER, tier: "control" });
    expect(sudoFramesOf(joiner)).toEqual([]);
    fresh.relay.handleRequest("s1", request("s1", "C1"));
    expect(requestIds(joiner)).toEqual(["C1"]);
    fresh.relay.dispose();
  });
});
