import { describe, it, expect } from "vitest";
import { isPushTrigger } from "../event-status-extraction.js";

/**
 * Push-trigger classifier. Narrower than `isUnreadTrigger` — only
 * ask_user transitions and agent_end errors. See change: add-server-push-notifications.
 */
describe("isPushTrigger", () => {
  describe("trigger 1: currentTool transitions TO ask_user", () => {
    it("returns true when currentTool flips from null to ask_user", () => {
      expect(
        isPushTrigger(
          "tool_execution_start",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(true);
    });

    it("returns true when currentTool flips from another tool to ask_user", () => {
      expect(
        isPushTrigger(
          "tool_execution_start",
          { status: "streaming", currentTool: "Read" },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(true);
    });

    it("returns false when ask_user persists (no transition)", () => {
      expect(
        isPushTrigger(
          "message_end",
          { status: "streaming", currentTool: "ask_user" },
          { status: "streaming", currentTool: "ask_user" },
        ),
      ).toBe(false);
    });

    it("returns false when currentTool transitions away from ask_user", () => {
      expect(
        isPushTrigger(
          "tool_execution_end",
          { status: "streaming", currentTool: "ask_user" },
          { status: "streaming", currentTool: null },
        ),
      ).toBe(false);
    });
  });

  describe("trigger 2: agent_end with error", () => {
    it("returns true when payload.error is set", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          { error: "rate limit exceeded" },
        ),
      ).toBe(true);
    });

    it("returns false when agent_end has no error", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          {},
        ),
      ).toBe(false);
    });

    it("returns false on agent_end with no payload", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
        ),
      ).toBe(false);
    });

    it("returns true when error is truthy non-string (e.g. object)", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          { error: { code: 429, message: "overloaded" } },
        ),
      ).toBe(true);
    });
  });

  describe("completion push", () => {
    it("returns false on streaming → idle when completion push is not opted in", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
        ),
      ).toBe(false);
    });

    it("returns true on successful agent_end when session bell is on", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
          {},
          {
            notifyErrors: true,
            notifyAskUser: true,
            notifyCompletion: "off",
            pushPrefs: { notifyCompletion: "on" },
          },
        ),
      ).toBe(true);
    });

    it("uses the global completion default when session prefs are absent", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
          {},
          {
            notifyErrors: true,
            notifyAskUser: true,
            notifyCompletion: "on",
          },
        ),
      ).toBe(true);
    });

    it("returns false on successful agent_end when session bell is off or auto", () => {
      const opts = { notifyErrors: true, notifyAskUser: true, notifyCompletion: "off" as const };
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
          {},
          { ...opts, pushPrefs: { notifyCompletion: "off" } },
        ),
      ).toBe(false);
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "idle", currentTool: null },
          {},
          { ...opts, pushPrefs: { notifyCompletion: "auto" } },
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
      "turn_start",
      "turn_end",
    ])("returns false for %s when state is unchanged", (eventType) => {
      expect(isPushTrigger(eventType, states, states)).toBe(false);
    });

    it("returns false for unknown event types", () => {
      expect(isPushTrigger("totally_made_up_event", states, states)).toBe(false);
    });

    it("returns false for agent_end with falsy error (null, 0, empty string)", () => {
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          { error: null },
        ),
      ).toBe(false);
      expect(
        isPushTrigger(
          "agent_end",
          { status: "streaming", currentTool: null },
          { status: "streaming", currentTool: null },
          { error: "" },
        ),
      ).toBe(false);
    });
  });
});
