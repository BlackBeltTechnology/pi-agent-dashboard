/**
 * Pure-helper tests for the idempotent attach/detach auto-rename rule.
 * See change: fix-mobile-attach-proposal-display (design.md decision matrix).
 */
import { describe, it, expect } from "vitest";
import {
  attachRenameTarget,
  detachShouldClearName,
  isNameAutoSetFromAttachment,
} from "../openspec/proposal-attach-naming.js";

type S = { name?: string | null; attachedProposal?: string | null };

describe("attachRenameTarget — decision matrix", () => {
  it("(a) empty name + null attached → returns new change name", () => {
    const s: S = { name: undefined, attachedProposal: null };
    expect(attachRenameTarget(s as any, "bar")).toBe("bar");
  });

  it("(a) whitespace-only name → treated as empty, returns new change name", () => {
    const s: S = { name: "   ", attachedProposal: null };
    expect(attachRenameTarget(s as any, "bar")).toBe("bar");
  });

  it("custom name + null attached → returns undefined (preserve user name)", () => {
    const s: S = { name: "my custom", attachedProposal: null };
    expect(attachRenameTarget(s as any, "bar")).toBeUndefined();
  });

  it("(b) name === attached (auto-set) → returns new change name (re-track)", () => {
    const s: S = { name: "foo", attachedProposal: "foo" };
    expect(attachRenameTarget(s as any, "bar")).toBe("bar");
  });

  it("custom name + non-null attached (user customised after auto) → returns undefined", () => {
    const s: S = { name: "my custom", attachedProposal: "foo" };
    expect(attachRenameTarget(s as any, "bar")).toBeUndefined();
  });

  it("undefined session → returns undefined (defensive)", () => {
    expect(attachRenameTarget(undefined, "bar")).toBeUndefined();
  });
});

describe("detachShouldClearName — decision matrix", () => {
  it("name === attached (auto-set) → true", () => {
    expect(detachShouldClearName({ name: "foo", attachedProposal: "foo" } as any)).toBe(true);
  });

  it("custom name + non-null attached → false", () => {
    expect(detachShouldClearName({ name: "my custom", attachedProposal: "foo" } as any)).toBe(false);
  });

  it("empty name + non-null attached → false (nothing to revert)", () => {
    expect(detachShouldClearName({ name: undefined, attachedProposal: "foo" } as any)).toBe(false);
    expect(detachShouldClearName({ name: "", attachedProposal: "foo" } as any)).toBe(false);
    expect(detachShouldClearName({ name: "  ", attachedProposal: "foo" } as any)).toBe(false);
  });

  it("name set + null attached → false (defensive: not auto-set)", () => {
    expect(detachShouldClearName({ name: "foo", attachedProposal: null } as any)).toBe(false);
  });

  it("undefined session → false", () => {
    expect(detachShouldClearName(undefined)).toBe(false);
  });
});

describe("isNameAutoSetFromAttachment", () => {
  it("name === attached → true", () => {
    expect(isNameAutoSetFromAttachment({ name: "foo", attachedProposal: "foo" } as any)).toBe(true);
  });
  it("name !== attached → false", () => {
    expect(isNameAutoSetFromAttachment({ name: "foo", attachedProposal: "bar" } as any)).toBe(false);
  });
  it("trims whitespace before comparing", () => {
    expect(isNameAutoSetFromAttachment({ name: "  foo  ", attachedProposal: "foo" } as any)).toBe(true);
  });
});
