/**
 * Member folder display (test-plan S14): whole-segment prefix match, separators and
 * Windows drive case normalised. See change: add-agent-teams-ui.
 */
import { describe, expect, it } from "vitest";
import { formatCwd } from "../format-cwd.js";

describe("formatCwd (S14)", () => {
  const lead = "/ws/lead";
  it.each([
    ["/ws/lead/sub", "sub"],
    ["/ws/lead/sub/deep", "sub/deep"],
    ["/ws/lead-other", "/ws/lead-other"], // string-prefix trap
    ["/ws", "/ws"],
    ["/elsewhere/x", "/elsewhere/x"],
    ["/ws/lead/", "."], // trailing slash = equal
    ["/ws/lead", "."],
    ["/ws/lead/sub/", "sub"],
  ])("%s → %s", (cwd, expected) => {
    expect(formatCwd(cwd, lead)).toBe(expected);
  });

  it("a trailing slash on the lead folder changes nothing", () => {
    expect(formatCwd("/ws/lead/sub", "/ws/lead/")).toBe("sub");
    expect(formatCwd("/ws/lead", "/ws/lead/")).toBe(".");
  });

  it("Windows: drive letter case-insensitive, backslashes normalised", () => {
    expect(formatCwd("C:\\ws\\lead\\sub", "c:\\ws\\lead")).toBe("sub");
    expect(formatCwd("c:\\ws\\lead", "C:\\ws\\lead")).toBe(".");
    expect(formatCwd("D:\\ws\\lead\\sub", "c:\\ws\\lead")).toBe("D:\\ws\\lead\\sub");
    expect(formatCwd("C:\\ws\\lead-other", "c:\\ws\\lead")).toBe("C:\\ws\\lead-other");
  });

  it("root lead folder and empty strings never throw", () => {
    expect(formatCwd("/a", "/")).toBe("a");
    expect(formatCwd("", "")).toBe(".");
    expect(formatCwd("", "/ws")).toBe("");
  });
});
