/**
 * Tests for the worktree-init TOFU trust store.
 * See change: generalize-worktree-init-hook.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookDefHash, type WorktreeInitHook } from "../git-worktree/worktree-init.js";
import { __resetSessionTrust, isTrusted, recordTrust } from "../git-worktree/worktree-init-trust.js";

const storeFile = () => join(getDashboardConfigDir(), "worktree-init-trust.json");
/** Raw persisted map, or `{}` when the store file is absent. */
function persisted(): Record<string, true> {
  const p = storeFile();
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}
/** True iff SOME persisted key ends with the given hash (repoRoot-agnostic). */
function diskHasHash(hash: string): boolean {
  return Object.keys(persisted()).some((k) => k.endsWith(`\u0000${hash}`));
}

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

// ── Session vs project scope (change: add-session-scoped-init-trust) ──────
describe("worktree-init-trust — scope", () => {
  beforeEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });
  afterEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });

  it("S1 session grant is memory-only — isTrusted true, disk untouched", () => {
    recordTrust("/repo/s1", "hash-s1", "session");
    expect(isTrusted("/repo/s1", "hash-s1")).toBe(true);
    // JSON store not created / does not contain the key.
    expect(diskHasHash("hash-s1")).toBe(false);
  });

  it("S2 project grant persists across a reload from disk", () => {
    recordTrust("/repo/s2", "hash-s2", "project");
    // Reload path: the persisted map on disk contains the key.
    expect(diskHasHash("hash-s2")).toBe(true);
    // A fresh in-memory session set (simulated reload) still trusts via disk.
    __resetSessionTrust();
    expect(isTrusted("/repo/s2", "hash-s2")).toBe(true);
  });

  it("S3 OR-combine — memory hit with disk miss returns true", () => {
    recordTrust("/repo/s3", "hash-s3", "session");
    expect(diskHasHash("hash-s3")).toBe(false); // absent on disk
    expect(isTrusted("/repo/s3", "hash-s3")).toBe(true); // memory hit
  });

  it("S4 omitted scope defaults to project (persisted)", () => {
    recordTrust("/repo/s4", "hash-s4");
    expect(diskHasHash("hash-s4")).toBe(true);
    expect(isTrusted("/repo/s4", "hash-s4")).toBe(true);
  });

  it("S5 session trust cleared on a fresh process", () => {
    recordTrust("/repo/s5", "hash-s5", "session");
    expect(isTrusted("/repo/s5", "hash-s5")).toBe(true);
    __resetSessionTrust(); // fresh in-memory Set, disk untouched
    expect(isTrusted("/repo/s5", "hash-s5")).toBe(false);
    expect(diskHasHash("hash-s5")).toBe(false);
  });

  it("S6 key parity — relative grant, absolute query (no false negative)", () => {
    recordTrust("./repo-s6", "hash-s6", "session");
    expect(isTrusted(join(process.cwd(), "repo-s6"), "hash-s6")).toBe(true);
  });

  it("S7 edited hook re-prompts across scope", () => {
    const hookA: WorktreeInitHook = { gate: "test ! -d node_modules", run: { type: "script", command: ":" } };
    const hookB: WorktreeInitHook = { gate: "test ! -d node_modules", run: { type: "script", command: "echo edited" } };
    const hashA = hookDefHash(hookA);
    const hashB = hookDefHash(hookB);
    expect(hashA).not.toBe(hashB);
    recordTrust("/repo/s7", hashA, "session");
    expect(isTrusted("/repo/s7", hashB)).toBe(false);
    recordTrust("/repo/s7", hashB, "session");
    expect(isTrusted("/repo/s7", hashB)).toBe(true);
  });
});
