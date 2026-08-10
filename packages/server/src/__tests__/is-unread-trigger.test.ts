import { describe, it, expect } from "vitest";
import { isUnreadTrigger } from "../session/event-status-extraction.js";

/**
 * Unread-trigger classifier for `session.unread` flipping to true.
 * See change: session-card-unread-stripes.
 */
describe("isUnreadTrigger", () => {
  describe("trigger 1: streaming -> quiescent (turn finished)", () => {
    it("returns true on streaming -> idle", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
        ),
      ).toBe(true);
    });

    it("returns true on streaming -> active", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "active", currentTool: null },
        ),
      ).toBe(true);
    });

    it("returns false on idle -> idle (no transition)", () => {
      expect(
        isUnreadTrigger(
          "tool_execution_end",
          { status: "idle", currentTool: null },
          { status: "idle", currentTool: null },
        ),
      ).toBe(false);
    });

    it("returns false on active -> idle (was not streaming)", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "active", currentTool: null },
          { status: "idle", currentTool: null },
        ),
      ).toBe(false);
    });

    it("returns false on streaming -> streaming", () => {
      expect(
        isUnreadTrigger(
          "message_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
        ),
      ).toBe(false);
    });

    it("returns false on streaming -> ended (death is not unread)", () => {
      // streaming -> ended is also a transition out of streaming, but per
      // design.md the unread state is only about quiescent-alive sessions.
      // Status "ended" should NOT trigger unread on its own. (If we want
      // to mark ended sessions as needing attention, that's a separate
      // requirement.)
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          // The status union is currently "streaming" | "idle" | "active";
          // "ended" is not in the union but is a valid runtime value
          // upstream, so we cast for the simulation.
          { status: "ended" as unknown as "idle", currentTool: null },
        ),
      ).toBe(false);
    });
  });

  describe("trigger 2: currentTool becomes ask_user", () => {
    it("returns true when currentTool flips from null to ask_user", () => {
      expect(
        isUnreadTrigger(
          "tool_execution_start",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(true);
    });

    it("returns true when currentTool flips from another tool to ask_user", () => {
      expect(
        isUnreadTrigger(
          "tool_execution_start",
          { status: "streaming", currentTool: "Read" },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(true);
    });

    it("returns false when ask_user persists (no transition)", () => {
      expect(
        isUnreadTrigger(
          "message_end",
          { status: "streaming", currentTool: "ask_user" },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(false);
    });
  });

  describe("trigger 3: agent_end with error", () => {
    it("returns true when payload.error is set", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          { error: "rate limit exceeded" },
        ),
      ).toBe(true);
    });

    it("returns false when agent_end has no error", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          {},
        ),
      ).toBe(false);
    });

    it("returns false on agent_end with no payload", () => {
      expect(
        isUnreadTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
        ),
      ).toBe(false);
    });
  });

  describe("non-triggers (intentional false)", () => {
    const states = { status: "streaming", currentTool: null } as const;

    it.each([
      "message_start",
      "message_end",
      "tool_execution_start",
      "tool_execution_end",
      "model_select",
      "git_info_update",
      "process_metrics",
      "ui_modules_list",
      "bash_output",
    ])("returns false for %s when state is unchanged", (eventType) => {
      expect(isUnreadTrigger(eventType, states, states)).toBe(false);
    });

    it("returns false for unknown event types", () => {
      expect(isUnreadTrigger("totally_made_up_event", states, states)).toBe(false);
    });
  });
});

/**
 * Reconnect must not re-stamp a session that was ALREADY blocked on a prompt.
 * The fold keeps `currentTool` at "ask_user" across the trailing synthetic
 * `agent_start`, so the before/after edge the trigger needs never appears —
 * the state is restored silently rather than announced a second time.
 *
 * See change: restore-ask-user-tool-state-on-reconnect, test-plan #F3.
 */
describe("isUnreadTrigger — restored ask_user state (test-plan #F3)", () => {
  it("#F3 does not re-fire when agent_start leaves a folded ask_user in place", () => {
    // What the fold produces at reconnect: status flips to streaming, but the
    // tool field is held at "ask_user" on BOTH sides of the edge.
    expect(
      isUnreadTrigger(
        "agent_start",
        { status: "idle", currentTool: "ask_user" },
        { status: "streaming", currentTool: "ask_user" },
      ),
    ).toBe(false);
  });

  it("#F3 fires on a replayed agent_end via trigger 1 alone — the ask_user edge adds nothing", () => {
    expect(
      isUnreadTrigger(
        "agent_end",
        { status: "streaming", currentTool: "ask_user" },
        { status: "idle", currentTool: "ask_user" },
        {},
      ),
      // Note: trigger 1 (streaming -> idle) legitimately fires here on its own
      // merit; this asserts only that the ask_user edge adds nothing.
    ).toBe(true);
  });

  it("#F3 still fires for a genuinely NEW prompt on a restored session", () => {
    // The complement: a session that came back with no prompt, then gets one.
    expect(
      isUnreadTrigger(
        "prompt_request",
        { status: "streaming", currentTool: null },
        { status: "streaming", currentTool: "ask_user" },
      ),
    ).toBe(true);
  });

  it("#F3 does not fire when a second prompt arrives while one is already pending", () => {
    expect(
      isUnreadTrigger(
        "prompt_request",
        { status: "streaming", currentTool: "ask_user" },
        { status: "streaming", currentTool: "ask_user" },
      ),
    ).toBe(false);
  });
});
