/**
 * Open-prompt queue (change: add-access-grant-dialog, tasks 7.3, 10.67, 10.69,
 * 10.75). Pure state; the dialog host renders `getQueue()[0]`.
 */
import type { GrantRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it } from "vitest";
import { GrantPromptStore } from "../grant-prompt-store.js";

function request(promptId: string, over: Partial<GrantRequestMessage> = {}): GrantRequestMessage {
  return {
    type: "grant_request",
    promptId,
    plane: "filesystem",
    subject: `/repo/${promptId}`,
    expiresAt: 10_000,
    copy: { mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" },
    ...over,
  };
}

describe("GrantPromptStore", () => {
  it("queues requests in arrival order and ignores a duplicate promptId", () => {
    const s = new GrantPromptStore();
    s.apply(request("a"));
    s.apply(request("b"));
    s.apply(request("a"));
    expect(s.getQueue().map((p) => p.promptId)).toEqual(["a", "b"]);
  });

  it("removes a dismissed prompt and refuses a late local answer (7.3)", () => {
    const s = new GrantPromptStore();
    s.apply(request("a"));
    s.apply({ type: "grant_dismiss", promptId: "a", plane: "filesystem", subject: "/repo/a", reason: "settled" });
    expect(s.getQueue()).toEqual([]);
    expect(s.claim("a")).toBe(false);
    // A re-delivered request for a closed prompt does not resurrect it.
    s.apply(request("a"));
    expect(s.getQueue()).toEqual([]);
  });

  it("claims an open prompt exactly once", () => {
    const s = new GrantPromptStore();
    s.apply(request("a"));
    expect(s.claim("a")).toBe(true);
    expect(s.claim("a")).toBe(false);
    expect(s.getQueue()).toEqual([]);
  });

  it("drops prompts whose expiry has passed (10.69)", () => {
    const s = new GrantPromptStore();
    s.apply(request("a", { expiresAt: 1_000 }));
    s.apply(request("b", { expiresAt: 5_000 }));
    s.expire(1_000);
    expect(s.getQueue().map((p) => p.promptId)).toEqual(["b"]);
    expect(s.claim("a")).toBe(false);
  });

  it("bumps the version on every queue change and notifies subscribers", () => {
    const s = new GrantPromptStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    const v0 = s.getVersion();
    s.apply(request("a"));
    s.apply({ type: "grant_dismiss", promptId: "a", plane: "filesystem", subject: "/repo/a", reason: "expired" });
    expect(s.getVersion()).toBe(v0 + 2);
    expect(calls).toBe(2);
    off();
  });

  describe("reconcile after reconnect (10.75)", () => {
    it("removes prompts settled meanwhile and re-renders ones still pending", () => {
      const s = new GrantPromptStore();
      s.apply(request("settled"));
      s.apply(request("still"));
      const before = s.snapshotIds();
      s.reconcile([request("still"), request("new-while-away")], before);
      expect(s.getQueue().map((p) => p.promptId)).toEqual(["still", "new-while-away"]);
    });

    it("keeps a prompt that arrived after the snapshot was requested", () => {
      const s = new GrantPromptStore();
      const before = s.snapshotIds();
      s.apply(request("raced"));
      s.reconcile([], before);
      expect(s.getQueue().map((p) => p.promptId)).toEqual(["raced"]);
    });

    it("does not re-add a prompt this client already answered", () => {
      const s = new GrantPromptStore();
      s.apply(request("a"));
      s.claim("a");
      s.reconcile([request("a")], s.snapshotIds());
      expect(s.getQueue()).toEqual([]);
    });
  });
});
