/**
 * Agent event hub: registry frames + question changes → compact transitions.
 * See change: add-agent-event-stream.
 */
import { describe, expect, it, vi } from "vitest";
import { type AgentEvent, createAgentEventHub } from "../agent-event-hub.js";

const anna = { iss: "kc", sub: "anna" };

function makeHub(rows: Array<{ id: string; sessionId: string; preview: string; type: string; sessionLabel: string }> = []) {
  const hub = createAgentEventHub({ listQuestionRows: () => rows as never, ownerOf: () => undefined });
  const seen: Array<{ event: AgentEvent; owner?: unknown }> = [];
  hub.subscribe((event, owner) => seen.push({ event, owner }));
  return { hub, seen, rows };
}

describe("agent event hub", () => {
  it("emits a status transition once per change, with the previous status", () => {
    const { hub, seen } = makeHub();
    hub.onRegistryFrame({ type: "session_added", session: { id: "s1", status: "active", cwd: "/p", name: "one" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "streaming" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "streaming", currentTool: "bash" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { tokens: 5 } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } } as never);
    expect(seen.map((s) => s.event)).toEqual([
      { type: "session_added", sessionId: "s1", status: "active", cwd: "/p", name: "one" },
      { type: "status", sessionId: "s1", from: "active", to: "streaming" },
      { type: "status", sessionId: "s1", from: "streaming", to: "idle" },
    ]);
  });

  it("omits `from` for a session it never saw", () => {
    const { hub, seen } = makeHub();
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s9", updates: { status: "idle" } } as never);
    expect(seen[0]?.event).toEqual({ type: "status", sessionId: "s9", to: "idle" });
  });

  it("emits session_removed and forgets the session", () => {
    const { hub, seen } = makeHub();
    hub.onRegistryFrame({ type: "session_added", session: { id: "s1", status: "idle", cwd: "/p" } } as never);
    hub.onRegistryFrame({ type: "session_removed", sessionId: "s1" } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } } as never);
    expect(seen.map((s) => s.event.type)).toEqual(["session_added", "session_removed", "status"]);
    expect(seen[2]?.event).toEqual({ type: "status", sessionId: "s1", to: "idle" });
  });

  it("ignores frames that are not registry frames", () => {
    const { hub, seen } = makeHub();
    hub.onRegistryFrame({ type: "openspec_update", cwd: "/p" } as never);
    expect(seen).toEqual([]);
  });

  it("carries the last known owner, also after the session is removed", () => {
    const { hub, seen } = makeHub();
    hub.onRegistryFrame({ type: "session_added", session: { id: "s1", status: "idle", cwd: "/p", principalOwner: anna } } as never);
    hub.onRegistryFrame({ type: "session_removed", sessionId: "s1" } as never);
    expect(seen.map((s) => s.owner)).toEqual([anna, anna]);
  });

  it("turns question changes into opened/closed, once each", () => {
    const { hub, seen, rows } = makeHub();
    rows.push({ id: "q1", sessionId: "s1", preview: "Push to main?", type: "confirm", sessionLabel: "one" });
    hub.onQuestionChange({ kind: "added", id: "q1", sessionId: "s1" });
    hub.onQuestionChange({ kind: "brief", id: "q1", sessionId: "s1" });
    rows.splice(0);
    hub.onQuestionChange({ kind: "hidden", id: "q1", sessionId: "s1" });
    hub.onQuestionChange({ kind: "removed", id: "q1", sessionId: "s1" });
    expect(seen.map((s) => s.event)).toEqual([
      { type: "question_opened", sessionId: "s1", questionId: "q1", questionType: "confirm", preview: "Push to main?", sessionLabel: "one" },
      { type: "question_closed", sessionId: "s1", questionId: "q1", reason: "answered" },
    ]);
  });

  it("reports a question removed without an answer as removed", () => {
    const { hub, seen, rows } = makeHub();
    rows.push({ id: "q1", sessionId: "s1", preview: "?", type: "input", sessionLabel: "one" });
    hub.onQuestionChange({ kind: "added", id: "q1", sessionId: "s1" });
    hub.onQuestionChange({ kind: "removed", id: "q1", sessionId: "s1" });
    expect(seen[1]?.event).toEqual({ type: "question_closed", sessionId: "s1", questionId: "q1", reason: "removed" });
  });

  it("lists currently open questions as question_opened events", () => {
    const { hub } = makeHub([{ id: "q1", sessionId: "s1", preview: "?", type: "input", sessionLabel: "one" }]);
    expect(hub.openQuestions()).toEqual([
      { type: "question_opened", sessionId: "s1", questionId: "q1", questionType: "input", preview: "?", sessionLabel: "one" },
    ]);
  });

  it("keeps delivering when a listener throws, and unsubscribes", () => {
    const { hub, seen } = makeHub();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsub = hub.subscribe(() => {
      throw new Error("boom");
    });
    hub.onRegistryFrame({ type: "session_removed", sessionId: "s1" } as never);
    unsub();
    hub.onRegistryFrame({ type: "session_removed", sessionId: "s2" } as never);
    expect(seen).toHaveLength(2);
    vi.restoreAllMocks();
  });
});
