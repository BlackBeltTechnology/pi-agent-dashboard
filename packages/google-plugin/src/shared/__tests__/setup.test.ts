/**
 * L1 setup validators (test-plan E1, E2, E5). See change: improve-gmail-plugin-setup-ux.
 */
import { describe, expect, it } from "vitest";
import { validateClientJson } from "../client-json.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../setup.js";

describe("E1 — classifyProjectId", () => {
  const thirty = `a${"b".repeat(28)}c`;
  it.each([
    ["", "empty"],
    ["abcde", "invalid"],
    ["abcdef", "ok"],
    [thirty, "ok"],
    [`${thirty}d`, "invalid"],
    ["abc-def-", "invalid"],
    ["1abcdef", "invalid"],
    ["PiDashboard", "looks_like_name"],
    ["my project", "looks_like_name"],
    ["  pidashboard-510015 ", "ok"],
  ])("%j → %s", (input, expected) => {
    expect(thirty).toHaveLength(30);
    expect(classifyProjectId(input)).toBe(expected);
  });

  it("normalizeProjectId trims", () => {
    expect(normalizeProjectId("  pidashboard-510015 ")).toBe("pidashboard-510015");
  });
});

describe("E2 — a JSON project_id the shared rule rejects counts as absent", () => {
  it("31-char project_id → accepted client, no projectId", () => {
    const r = validateClientJson({
      installed: {
        client_id: "123-abc.apps.googleusercontent.com",
        client_secret: "GOCSPX-x",
        project_id: `a${"b".repeat(29)}c`,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.client.projectId).toBeUndefined();
  });

  it("valid project_id is kept", () => {
    const r = validateClientJson({
      installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "s", project_id: "pidashboard-510015" },
    });
    expect(r.ok && r.client.projectId).toBe("pidashboard-510015");
  });
});

describe("E5 — owner email", () => {
  it("normalizes and validates", () => {
    expect(normalizeEmail(" Robson@Semmi.SE ")).toBe("robson@semmi.se");
    expect(isEmail(normalizeEmail(" Robson@Semmi.SE "))).toBe(true);
    expect(isEmail("robson@")).toBe(false);
    expect(isEmail("a@b")).toBe(false);
  });

  it.each([
    ["a@b.c", true],
    ["a@b..", true],
    ["a@.b", false],
    ["a@b.", false],
    ["@b.c", false],
    ["a@@b.c", false],
    ["a b@c.d", false],
  ])("%j → %s", (input, expected) => {
    expect(isEmail(input)).toBe(expected);
  });

  it("rejects an oversized hostile address in linear time (no regex backtracking)", () => {
    const hostile = `!@${"!.".repeat(50_000)}`;
    const started = performance.now();
    expect(isEmail(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
