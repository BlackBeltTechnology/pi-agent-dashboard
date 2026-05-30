import { describe, it, expect } from "vitest";
import { deriveSelectedSessionId } from "../lib/selectedSessionId.js";

// Regression coverage for fix-changed-files-desktop-route.
//
// Before the fix, `selectedId` was `match ? params?.id : undefined` — so on
// `/session/:id/diff` (which the exact `/session/:id` wouter route does NOT
// match) `selectedId` collapsed to undefined, `sessionDetail` became null, and
// the desktop content area fell through to `<LandingPage>` instead of
// `<FileDiffView>`. The diff sub-route now contributes to `selectedId`.
describe("deriveSelectedSessionId", () => {
  it("returns the chat-route id when /session/:id matches", () => {
    expect(deriveSelectedSessionId(true, { id: "S1" }, false, null)).toBe("S1");
  });

  it("returns the diff-route id when only /session/:id/diff matches (regression)", () => {
    expect(deriveSelectedSessionId(false, null, true, { id: "S1" })).toBe("S1");
  });

  it("prefers the chat-route id when both matches are somehow present", () => {
    expect(
      deriveSelectedSessionId(true, { id: "chat" }, true, { id: "diff" }),
    ).toBe("chat");
  });

  it("returns undefined when neither route matches", () => {
    expect(deriveSelectedSessionId(false, null, false, null)).toBeUndefined();
  });

  it("returns undefined when matching route has no id param", () => {
    expect(deriveSelectedSessionId(true, {}, false, null)).toBeUndefined();
    expect(deriveSelectedSessionId(false, null, true, {})).toBeUndefined();
  });
});
