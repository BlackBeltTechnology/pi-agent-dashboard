/**
 * Tests for the worktree-init TOFU trust store.
 * See change: generalize-worktree-init-hook.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookDefHash, type WorktreeInitHook } from "../git-worktree/worktree-init.js";
import { __resetSessionTrust, isTrusted, recordTrust, revokeTrust } from "../git-worktree/worktree-init-trust.js";

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

// ── Revoke (change: add-access-grants-and-review, task 6.1) ───────────────
describe("worktree-init-trust — revoke", () => {
  beforeEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });
  afterEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });

  it("R1 session grant revoke clears memory without a restart", () => {
    recordTrust("/repo/r1", "hash-r1", "session");
    expect(isTrusted("/repo/r1", "hash-r1")).toBe(true);
    revokeTrust("/repo/r1", "hash-r1");
    // No __resetSessionTrust(): the in-memory session grant must be gone now.
    expect(isTrusted("/repo/r1", "hash-r1")).toBe(false);
  });

  it("R2 project grant revoke clears the persisted entry", () => {
    recordTrust("/repo/r2", "hash-r2", "project");
    expect(diskHasHash("hash-r2")).toBe(true);
    revokeTrust("/repo/r2", "hash-r2");
    expect(diskHasHash("hash-r2")).toBe(false);
    expect(isTrusted("/repo/r2", "hash-r2")).toBe(false);
  });

  it("R3 revoke clears BOTH scopes at once", () => {
    recordTrust("/repo/r3", "hash-r3", "session");
    recordTrust("/repo/r3", "hash-r3", "project");
    expect(isTrusted("/repo/r3", "hash-r3")).toBe(true);
    revokeTrust("/repo/r3", "hash-r3");
    expect(isTrusted("/repo/r3", "hash-r3")).toBe(false);
    expect(diskHasHash("hash-r3")).toBe(false);
    __resetSessionTrust(); // simulate restart: still untrusted
    expect(isTrusted("/repo/r3", "hash-r3")).toBe(false);
  });

  it("R4 revoke is idempotent — a no-op revoke does not create the store", () => {
    revokeTrust("/repo/r4", "hash-r4");
    expect(existsSync(storeFile())).toBe(false);
    expect(isTrusted("/repo/r4", "hash-r4")).toBe(false);
  });
});

// ── Read-only guarantee (change: add-access-grants-and-review, task 6.4) ──
describe("worktree-init-trust — reads do not rewrite the store", () => {
  beforeEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });
  afterEach(() => { __resetSessionTrust(); rmSync(storeFile(), { force: true }); });

  it("R5 a legacy entry is byte-identical after a read", () => {
    const p = storeFile();
    mkdirSync(dirname(p), { recursive: true });
    const legacy = JSON.stringify({ [`${resolve("/repo/r5")}\u0000hash-r5`]: true }, null, 2);
    writeFileSync(p, legacy, "utf8");

    expect(isTrusted("/repo/r5", "hash-r5")).toBe(true);
    expect(readFileSync(p, "utf8")).toBe(legacy);
  });
});
