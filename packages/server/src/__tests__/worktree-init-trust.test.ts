/**
 * Tests for the worktree-init TOFU trust store.
 * See change: generalize-worktree-init-hook.
 */
import { describe, it, expect } from "vitest";
import { isTrusted, recordTrust } from "../worktree-init-trust.js";

// HOME is re-rooted to an ephemeral tmp dir by the test-support setup, so
// the JSON store lives under that throwaway ~/.pi/dashboard.

describe("worktree-init-trust", () => {
  it("is untrusted by default", () => {
    expect(isTrusted("/repo/a", "hash-a")).toBe(false);
  });

  it("is trusted after recordTrust", () => {
    recordTrust("/repo/b", "hash-b");
    expect(isTrusted("/repo/b", "hash-b")).toBe(true);
  });

  it("re-prompts when the hash changes", () => {
    recordTrust("/repo/c", "hash-c1");
    expect(isTrusted("/repo/c", "hash-c1")).toBe(true);
    expect(isTrusted("/repo/c", "hash-c2")).toBe(false);
  });

  it("keys by repoRoot — a different repo with the same hash is untrusted", () => {
    recordTrust("/repo/d", "shared-hash");
    expect(isTrusted("/repo/e", "shared-hash")).toBe(false);
  });
});
