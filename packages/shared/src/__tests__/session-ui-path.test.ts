/** Test-plan #E1 — `sessionUiPath` builds the browser route for a session. */
import { describe, expect, it } from "vitest";
import { sessionUiPath } from "../session-ui-path.js";

describe("sessionUiPath", () => {
  it("E1: plain id, with and without a view", () => {
    expect(sessionUiPath("abc")).toBe("/session/abc");
    expect(sessionUiPath("abc", "diff")).toBe("/session/abc/diff");
    expect(sessionUiPath("abc", "editor")).toBe("/session/abc/editor");
  });

  it("E1: percent-encodes the id", () => {
    expect(sessionUiPath("a/b c")).toBe("/session/a%2Fb%20c");
    expect(sessionUiPath("a/b c", "diff")).toBe("/session/a%2Fb%20c/diff");
  });
});
