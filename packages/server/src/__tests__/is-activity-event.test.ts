import { describe, it, expect } from "vitest";
import { isActivityEvent } from "../session/event-status-extraction.js";

/**
 * Activity-event allowlist for `session.lastActivityAt` stamping.
 * See change: session-card-last-activity-badge.
 */
describe("isActivityEvent", () => {
  describe("included (user-or-agent action)", () => {
    const included = [
      "prompt_send",
      "message_start",
      "message_end",
      "turn_end",
      "tool_execution_start",
      "tool_execution_end",
      "agent_start",
      "agent_end",
      "bash_output",
      // Flow / architect events removed: per change
      // pluginize-flows-via-registry the shell carries no flow
      // knowledge. lastActivityAt for flow-only sessions is bumped
      // by the constituent tool/agent events the flow generates.
    ];

    for (const t of included) {
      it(`returns true for "${t}"`, () => {
        expect(isActivityEvent(t)).toBe(true);
      });
    }
  });

  describe("excluded (plumbing / noise / UI state)", () => {
    const excluded = [
      // Pure heartbeat / metrics
      "process_metrics",
      "heartbeat",
      // Stats roll-ups (covered by turn_end)
      "stats_update",
      // Selection / config
      "model_select",
      // Git polling
      "git_info_update",
      // OpenSpec polling
      "openspec_update",
      // Extension UI plumbing
      "ui_modules_list",
      "ui_data_list",
      "ext_ui_decorator",
      // Command UI noise
      "command_feedback",
      // Internal entry tracking
      "entry_persisted",
      // Lifecycle (not event_forward types, but defensive)
      "session_register",
      "session_unregister",
    ];

    for (const t of excluded) {
      it(`returns false for "${t}"`, () => {
        expect(isActivityEvent(t)).toBe(false);
      });
    }
  });

  describe("unknown event types", () => {
    it("returns false for an unknown type", () => {
      expect(isActivityEvent("definitely_not_a_real_event")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isActivityEvent("")).toBe(false);
    });
  });
});
