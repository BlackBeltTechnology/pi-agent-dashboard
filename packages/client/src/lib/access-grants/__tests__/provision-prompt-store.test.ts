/**
 * Open provisioning-request queue (change: add-access-provisioning, task 3.2):
 * first-answer-wins dismissal, bounded late-answer memory, reconnect reconcile.
 */
import type { ProvisionRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it } from "vitest";
import { ProvisionPromptStore } from "../provision-prompt-store.js";

function request(requestId: string, over: Partial<ProvisionRequestMessage> = {}): ProvisionRequestMessage {
  return {
    type: "provision_request",
    requestId,
    projectRoot: "/w/app",
    lines: [{ lineId: "l1", path: "/w/lib", why: "x", classification: "grantable" }],
    remote: [],
    expiresAt: 10_000,
    ...over,
  };
}

describe("ProvisionPromptStore", () => {
  it("queues in arrival order and ignores a duplicate requestId", () => {
    const s = new ProvisionPromptStore();
    s.apply(request("a"));
    s.apply(request("b"));
    s.apply(request("a"));
    expect(s.getQueue().map((r) => r.requestId)).toEqual(["a", "b"]);
  });

  it("a dismissed request leaves the queue, refuses a late local answer and is not resurrected", () => {
    const s = new ProvisionPromptStore();
    s.apply(request("a"));
    s.apply({ type: "provision_dismiss", requestId: "a", reason: "settled" });
    expect(s.getQueue()).toEqual([]);
    expect(s.claim("a")).toBe(false);
    s.apply(request("a"));
    expect(s.getQueue()).toEqual([]);
  });

  it("claim succeeds once (first answer wins)", () => {
    const s = new ProvisionPromptStore();
    s.apply(request("a"));
    expect(s.claim("a")).toBe(true);
    expect(s.claim("a")).toBe(false);
  });

  it("re-bases ttlMs onto the local clock", () => {
    const s = new ProvisionPromptStore();
    const before = Date.now();
    s.apply(request("a", { expiresAt: 1, ttlMs: 60_000 }));
    expect(s.getQueue()[0].expiresAt).toBeGreaterThanOrEqual(before + 60_000);
  });

  it("expire drops requests at or before now", () => {
    const s = new ProvisionPromptStore();
    s.apply(request("a", { expiresAt: 5 }));
    s.apply(request("b", { expiresAt: 50 }));
    s.expire(5);
    expect(s.getQueue().map((r) => r.requestId)).toEqual(["b"]);
  });

  it("reconcile removes only requests queued before the snapshot and adds missing pending ones", () => {
    const s = new ProvisionPromptStore();
    s.apply(request("old"));
    const before = s.snapshotIds();
    s.apply(request("raced")); // arrived while the fetch was in flight
    s.reconcile([request("fresh")], before);
    expect(s.getQueue().map((r) => r.requestId).sort()).toEqual(["fresh", "raced"]);
  });

  it("bumps the version on every change", () => {
    const s = new ProvisionPromptStore();
    const v0 = s.getVersion();
    s.apply(request("a"));
    expect(s.getVersion()).toBe(v0 + 1);
  });
});
