/**
 * Teammate naming (task 3.6, test 7.35, test-plan #E6): `os-<change>` up to 32 characters, else the
 * 22-character prefix plus a hash; always a valid core member name; stable and collision-resistant.
 * See change: add-agent-teams-openspec.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memberNameFor } from "../names.js";

const CORE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const hex6 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 6);

describe("memberNameFor (7.35 #E6)", () => {
  it("up to 29 characters the name is os-<change> (32 characters at most)", () => {
    expect(memberNameFor("x")).toBe("os-x");
    expect(memberNameFor("a".repeat(28))).toBe(`os-${"a".repeat(28)}`);
    const c29 = `${"a".repeat(28)}b`;
    expect(memberNameFor(c29)).toBe(`os-${c29}`);
    expect(memberNameFor(c29)).toHaveLength(32);
    expect(memberNameFor("fix-x")).toBe("os-fix-x");
  });

  it("30+ characters: os- + first 22 (trailing - trimmed) + - + 6 hex of sha256", () => {
    const c30 = "a".repeat(29) + "b";
    expect(memberNameFor(c30)).toBe(`os-${c30.slice(0, 22)}-${hex6(c30)}`);
    const c31 = "add-agent-teams-templates-hooks";
    expect(c31).toHaveLength(31);
    expect(memberNameFor(c31)).toBe(`os-add-agent-teams-templa-${hex6(c31)}`);
    expect(memberNameFor(c31).length).toBeLessThanOrEqual(32);
    const c60 = `${"x".repeat(59)}y`;
    expect(memberNameFor(c60)).toBe(`os-${"x".repeat(22)}-${hex6(c60)}`);
  });

  it("a change whose 22nd character is - never yields a double dash", () => {
    const change = `${"a".repeat(21)}-${"b".repeat(20)}`; // 42 chars, 22nd = "-"
    const name = memberNameFor(change);
    expect(name).toBe(`os-${"a".repeat(21)}-${hex6(change)}`);
    expect(name).not.toContain("--");
    expect(name).toMatch(CORE_NAME);
  });

  it("a digit-first change still starts with a letter", () => {
    expect(memberNameFor("1x")).toBe("os-1x");
    expect(memberNameFor(`1${"x".repeat(40)}`)).toMatch(CORE_NAME);
  });

  it("every length 1..64 gives a valid core name with no double dash", () => {
    for (let n = 1; n <= 64; n++) {
      const change = `${"ab-".repeat(30)}`.slice(0, n).replace(/-+$/, "z");
      const name = memberNameFor(change);
      expect(name, change).toMatch(CORE_NAME);
      expect(name).not.toContain("--");
    }
  });

  it("is stable across calls and distinct for two changes sharing a 22-character prefix", () => {
    const a = `${"p".repeat(22)}-one`;
    const b = `${"p".repeat(22)}-two`;
    expect(memberNameFor(a)).toBe(memberNameFor(a));
    expect(memberNameFor(a)).not.toBe(memberNameFor(b));
  });

  it("refuses a value that is not a change name", () => {
    for (const bad of ["", "A", "a--b", "-a", "a/b", "a".repeat(65), "x y"]) expect(() => memberNameFor(bad), bad).toThrow(TypeError);
  });
});
