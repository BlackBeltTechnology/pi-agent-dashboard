/**
 * See change: render-skill-invocations-collapsibly.
 *
 * Verifies that the event-reducer's `message_start` handler stamps a `skill`
 * field on user messages whose persisted content is a `<skill>` envelope, and
 * leaves `skill` undefined for plain user messages. The raw `content` field
 * MUST remain the unmodified expanded string in both cases (so existing
 * "copy as markdown" semantics are preserved).
 */
import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function userMsgEvent(content: string): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: 1777032001000,
    data: {
      message: { role: "user", content: [{ type: "text", text: content }] },
    },
  } as DashboardEvent;
}

describe("event-reducer message_start: skill-block stamping", () => {
  it("stamps `skill` for a wrapped user message", () => {
    const wrapped =
      `<skill name="openspec-explore" location="/abs/SKILL.md">\nReferences are relative to /abs.\n\nbody line\nmore body\n</skill>\n\ncontinue with X`;
    const state = reduceEvent(createInitialState(), userMsgEvent(wrapped));
    const last = state.messages[state.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.skill).toBeDefined();
    expect(last.skill!.name).toBe("openspec-explore");
    expect(last.skill!.args).toBe("continue with X");
    expect(last.skill!.condensed).toBe("/skill:openspec-explore continue with X");
    // Body is the user-visible body (preamble stripped)
    expect(last.skill!.body).toBe("body line\nmore body");
    // Raw content is preserved unchanged for copy-as-markdown
    expect(last.content).toBe(wrapped);
  });

  it("leaves `skill` undefined for plain user messages", () => {
    const state = reduceEvent(createInitialState(), userMsgEvent("Hello world"));
    const last = state.messages[state.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.skill).toBeUndefined();
    expect(last.content).toBe("Hello world");
  });

  it("preserves images alongside the skill stamp", () => {
    const wrapped = `<skill name="foo" location="/p">\nbody\n</skill>\n\nfoo`;
    const event: DashboardEvent = {
      eventType: "message_start",
      timestamp: 1,
      data: {
        message: {
          role: "user",
          content: [
            { type: "text", text: wrapped },
            { type: "image", data: "fake-base64", mimeType: "image/png" },
          ],
        },
      },
    } as DashboardEvent;
    const state = reduceEvent(createInitialState(), event);
    const last = state.messages[state.messages.length - 1];
    expect(last.skill).toBeDefined();
    expect(last.skill!.name).toBe("foo");
    expect(last.images).toHaveLength(1);
    expect(last.images![0].mimeType).toBe("image/png");
  });

  it("string-content (non-array) shape also stamps skill when wrapped", () => {
    const wrapped = `<skill name="bar" location="/p">\nb\n</skill>`;
    const event: DashboardEvent = {
      eventType: "message_start",
      timestamp: 1,
      data: { message: { role: "user", content: wrapped } },
    } as DashboardEvent;
    const state = reduceEvent(createInitialState(), event);
    const last = state.messages[state.messages.length - 1];
    expect(last.skill).toBeDefined();
    expect(last.skill!.name).toBe("bar");
    expect(last.skill!.args).toBeUndefined();
    expect(last.skill!.condensed).toBe("/skill:bar");
  });
});
