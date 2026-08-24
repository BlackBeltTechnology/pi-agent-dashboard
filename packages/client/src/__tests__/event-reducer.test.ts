/**
 * Concurrent ask_user prompts: the reducer must never drop a prompt whose
 * `requestId` is new, even when two prompts share a title (the `update_roles`
 * case). Only a same-id re-send (reconnect replay) is suppressed.
 *
 * Covers test-plan U1–U5.
 *
 * See change: surface-concurrent-ask-user-prompts.
 */
import { describe, expect, it } from "vitest";
import {
  addInteractiveRequest,
  createInitialState,
  dismissInteractiveRequest,
  resolveInteractiveRequest,
  type SessionState,
} from "../lib/chat/event-reducer.js";
import { derivePendingFreeFloating } from "../lib/chat/pending-free-floating.js";

function confirm(state: SessionState, id: string, title: string, message: string): SessionState {
  return addInteractiveRequest(state, id, "confirm", { title, message });
}

describe("addInteractiveRequest — concurrent ask_user dedup", () => {
  it("U1 two concurrent confirms sharing a title both surface", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.interactiveRequests.every((r) => r.status === "pending")).toBe(true);
    expect(s.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
    expect(s.messages.filter((m) => m.id === "ui-p2")).toHaveLength(1);
  });

  it("U2 two byte-identical concurrent confirms both surface", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role A");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.interactiveRequests.every((r) => r.status === "pending")).toBe(true);
  });

  it("U3 same-id re-send is suppressed", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    const after = confirm(s, "p1", "Update global roles?", "Set role A");

    expect(after).toBe(s);
    expect(after.interactiveRequests.filter((r) => r.requestId === "p1")).toHaveLength(1);
    expect(after.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
  });

  it("U4 answering one leaves the other pending", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    s = resolveInteractiveRequest(s, "p1", true);

    const p1 = s.interactiveRequests.find((r) => r.requestId === "p1")!;
    const p2 = s.interactiveRequests.find((r) => r.requestId === "p2")!;
    expect(p1.status).toBe("resolved");
    expect(p2.status).toBe("pending");
  });

  it("R-reconnect replay of the pending burst yields no duplicate rows or panel cards", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    // Reconnect replay re-sends the SAME ids.
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");

    expect(s.interactiveRequests.map((r) => r.requestId)).toEqual(["p1", "p2"]);
    expect(s.messages.filter((m) => m.id === "ui-p1")).toHaveLength(1);
    expect(s.messages.filter((m) => m.id === "ui-p2")).toHaveLength(1);
    // Panel derives one card per pending id — no duplication.
    expect(derivePendingFreeFloating(s.messages, s.interactiveRequests).map((r) => r.requestId)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("U5 cancelling one does not cancel the other", () => {
    let s = createInitialState();
    s = confirm(s, "p1", "Update global roles?", "Set role A");
    s = confirm(s, "p2", "Update global roles?", "Set role B");
    s = dismissInteractiveRequest(s, "p1");

    const p1 = s.interactiveRequests.find((r) => r.requestId === "p1")!;
    const p2 = s.interactiveRequests.find((r) => r.requestId === "p2")!;
    expect(p1.status).toBe("dismissed");
    expect(p2.status).toBe("pending");
  });
});
