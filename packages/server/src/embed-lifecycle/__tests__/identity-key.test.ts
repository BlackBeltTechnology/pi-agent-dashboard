/**
 * Canonical identity key + cwd allowlist (test-plan #E11, #X1).
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import { isCwdAllowed } from "../cwd-allowlist.js";
import { buildIdentityKey, canonicalizeCwd } from "../identity-key.js";

describe("canonicalizeCwd", () => {
  // E11 — symlink/worktree paths collapse via realpath.
  it("collapses a symlinked path via realpath", () => {
    const realpath = (p: string) => (p === "/link/work" ? "/real/work" : p);
    expect(canonicalizeCwd("/link/work", { realpath, caseInsensitive: false })).toBe("/real/work");
  });

  // E11 — case-variants collapse on a case-insensitive filesystem.
  it("collapses case-variants when case-insensitive", () => {
    const realpath = (p: string) => p;
    const a = canonicalizeCwd("/Work/Repo", { realpath, caseInsensitive: true });
    const b = canonicalizeCwd("/work/repo", { realpath, caseInsensitive: true });
    expect(a).toBe(b);
  });

  it("preserves case on a case-sensitive filesystem", () => {
    const realpath = (p: string) => p;
    expect(canonicalizeCwd("/Work", { realpath, caseInsensitive: false })).toBe("/Work");
    expect(canonicalizeCwd("/work", { realpath, caseInsensitive: false })).toBe("/work");
  });

  it("falls back to the raw path when realpath throws", () => {
    const realpath = () => {
      throw new Error("ENOENT");
    };
    expect(canonicalizeCwd("/missing", { realpath, caseInsensitive: false })).toBe("/missing");
  });
});

describe("buildIdentityKey", () => {
  // E11 — same physical dir via two path strings ⇒ one key.
  it("produces one key for two path strings of the same physical dir", () => {
    const realpath = (p: string) => (p.startsWith("/link") ? p.replace("/link", "/real") : p);
    const k1 = buildIdentityKey(
      { visitorId: "v1", cwd: "/link/w", agentIdentity: "a" },
      { realpath, caseInsensitive: false },
    );
    const k2 = buildIdentityKey(
      { visitorId: "v1", cwd: "/real/w", agentIdentity: "a" },
      { realpath, caseInsensitive: false },
    );
    expect(k1).toBe(k2);
  });

  it("distinguishes different visitors on the same cwd", () => {
    const realpath = (p: string) => p;
    const k1 = buildIdentityKey({ visitorId: "v1", cwd: "/w" }, { realpath });
    const k2 = buildIdentityKey({ visitorId: "v2", cwd: "/w" }, { realpath });
    expect(k1).not.toBe(k2);
  });
});

describe("isCwdAllowed", () => {
  const realpath = (p: string) => p;
  // X1 — an out-of-allowlist cwd is rejected.
  it("rejects a cwd outside every allowed root", () => {
    expect(isCwdAllowed("/etc", ["/srv/embeds"], { realpath })).toBe(false);
  });
  it("accepts a cwd inside an allowed root", () => {
    expect(isCwdAllowed("/srv/embeds/proj", ["/srv/embeds"], { realpath })).toBe(true);
  });
  it("denies everything when the allowlist is empty (unconfigured)", () => {
    expect(isCwdAllowed("/srv/embeds/proj", [], { realpath })).toBe(false);
  });
});
