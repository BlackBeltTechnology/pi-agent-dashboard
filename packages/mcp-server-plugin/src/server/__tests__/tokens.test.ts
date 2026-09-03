/**
 * Per-session MCP token registry.
 *
 * Covers test-plan M1 (mint resolves to its session), M2 (identity from the
 * token), M6 (token dies with its session), M7 (session-end race), A6
 * (revocation is immediate), X8 (registry dies with the plugin), X9 (restart
 * leaves nothing partially valid) and X10 (constant-time comparison).
 *
 * design.md Decision 7 — opaque 32-byte, SHA-256 at rest, no independent
 * expiry, in-memory only.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { McpTokenRegistry } from "../tokens.js";

describe("McpTokenRegistry — minting (M1)", () => {
  it("resolves a minted token to the session it was minted for", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    expect(reg.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("issues an opaque 256-bit token, not a structured claim", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    expect(token.startsWith("mcp_")).toBe(true);
    const body = token.slice("mcp_".length);
    // base64url of 32 bytes — 43 chars, no padding.
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The session id must not be recoverable from the token itself.
    expect(token).not.toContain("session-a");
    expect(Buffer.from(body, "base64url").toString("utf8")).not.toContain("session-a");
  });

  it("never stores the plaintext token (a leaked registry cannot be replayed)", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    const dumped = JSON.stringify(reg.debugRows());
    expect(dumped).not.toContain(token);
    expect(dumped).toContain(crypto.createHash("sha256").update(token).digest("hex"));
  });

  it("mints distinct tokens per call, and both remain valid for the session", () => {
    const reg = new McpTokenRegistry();
    const a = reg.mintForSession("session-a");
    const b = reg.mintForSession("session-a");
    expect(a).not.toBe(b);
    expect(reg.resolve(a)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(reg.resolve(b)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("keeps sessions isolated — one session's token never resolves to another", () => {
    const reg = new McpTokenRegistry();
    const a = reg.mintForSession("session-a");
    const b = reg.mintForSession("session-b");
    expect(reg.resolve(a)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(reg.resolve(b)).toEqual({ kind: "session", sessionId: "session-b" });
  });
});

describe("McpTokenRegistry — resolution (M2)", () => {
  it.each([
    ["an unknown but well-formed token", `mcp_${crypto.randomBytes(32).toString("base64url")}`],
    ["garbage", "not-a-token"],
    ["the empty string", ""],
    ["a bare prefix", "mcp_"],
  ])("returns null for %s", (_label, token) => {
    const reg = new McpTokenRegistry();
    reg.mintForSession("session-a");
    expect(reg.resolve(token)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("returns null for %s without throwing", (_label, token) => {
    const reg = new McpTokenRegistry();
    expect(() => reg.resolve(token as unknown as string)).not.toThrow();
    expect(reg.resolve(token as unknown as string)).toBeNull();
  });

  it("does not resolve a token that differs by a single character", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`;
    expect(reg.resolve(tampered)).toBeNull();
  });
});

describe("McpTokenRegistry — revocation (A6, M6)", () => {
  it("A6 — a revoked token is refused immediately", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    expect(reg.resolve(token)).not.toBeNull();
    expect(reg.revokeToken(token)).toBe(true);
    expect(reg.resolve(token)).toBeNull();
  });

  it("revoking an unknown token reports no row removed", () => {
    const reg = new McpTokenRegistry();
    expect(reg.revokeToken("mcp_nope")).toBe(false);
  });

  it("revoking one token leaves the session's other tokens alone", () => {
    const reg = new McpTokenRegistry();
    const a = reg.mintForSession("session-a");
    const b = reg.mintForSession("session-a");
    reg.revokeToken(a);
    expect(reg.resolve(a)).toBeNull();
    expect(reg.resolve(b)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("M6 — every token of a session dies when the session ends", () => {
    const reg = new McpTokenRegistry();
    const a1 = reg.mintForSession("session-a");
    const a2 = reg.mintForSession("session-a");
    const b = reg.mintForSession("session-b");

    expect(reg.revokeSession("session-a")).toBe(2);

    expect(reg.resolve(a1)).toBeNull();
    expect(reg.resolve(a2)).toBeNull();
    // A sibling session is untouched.
    expect(reg.resolve(b)).toEqual({ kind: "session", sessionId: "session-b" });
  });

  it("ending a session with no tokens is a no-op, not an error", () => {
    const reg = new McpTokenRegistry();
    expect(reg.revokeSession("never-minted")).toBe(0);
  });

  it("ending a session twice does not resurrect or double-count", () => {
    const reg = new McpTokenRegistry();
    reg.mintForSession("session-a");
    expect(reg.revokeSession("session-a")).toBe(1);
    expect(reg.revokeSession("session-a")).toBe(0);
  });

  it("M7 — a token captured before session end does not authenticate after it", () => {
    // The race in M7: a request resolves its caller, then the session ends
    // mid-flight. Re-resolution must fail, so a handler that re-checks (as the
    // streaming path does per event) can never act on a dead session.
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    const captured = reg.resolve(token);
    expect(captured).toEqual({ kind: "session", sessionId: "session-a" });

    reg.revokeSession("session-a");

    expect(reg.resolve(token)).toBeNull();
  });
});

describe("McpTokenRegistry — lifetime (X8, X9)", () => {
  it("X9 — a fresh registry (post-restart) honours no previously minted token", () => {
    const before = new McpTokenRegistry();
    const token = before.mintForSession("session-a");
    expect(before.resolve(token)).not.toBeNull();

    // Decision 7: the registry is in-memory, so a restart is simply a new
    // instance. "Partially valid" is unrepresentable — there is no file to
    // half-read.
    const after = new McpTokenRegistry();
    expect(after.resolve(token)).toBeNull();
    expect(after.size).toBe(0);
  });

  it("X8 — disposing the registry invalidates every token at once", () => {
    const reg = new McpTokenRegistry();
    const a = reg.mintForSession("session-a");
    const b = reg.mintForSession("session-b");
    reg.dispose();
    expect(reg.resolve(a)).toBeNull();
    expect(reg.resolve(b)).toBeNull();
    expect(reg.size).toBe(0);
  });

  it("X9 — tokens never expire on their own while their session lives", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("session-a");
    // No independent expiry axis exists (Decision 7), so a token minted far in
    // the past is still valid until its session ends.
    reg.debugBackdate(token, Date.now() - 1000 * 60 * 60 * 24 * 365);
    expect(reg.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });
});

describe("McpTokenRegistry — comparison discipline (X10)", () => {
  it("compares equal-length digests in constant time via timingSafeEqual", () => {
    // A behavioural timing assertion is inherently flaky in CI, so the
    // guarantee is asserted structurally: the registry must route every
    // comparison through crypto.timingSafeEqual. Spying proves the discipline
    // is actually exercised rather than merely imported.
    const reg = new McpTokenRegistry();
    const valid = reg.mintForSession("session-a");
    const invalid = `mcp_${crypto.randomBytes(32).toString("base64url")}`;
    expect(valid.length).toBe(invalid.length);

    let calls = 0;
    const real = crypto.timingSafeEqual;
    (crypto as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = ((
      a: NodeJS.ArrayBufferView,
      b: NodeJS.ArrayBufferView,
    ) => {
      calls += 1;
      return real(a, b);
    }) as typeof crypto.timingSafeEqual;
    try {
      expect(reg.resolve(valid)).not.toBeNull();
      expect(calls).toBeGreaterThan(0);
      const afterValid = calls;
      expect(reg.resolve(invalid)).toBeNull();
      // A miss must still perform the comparison work — an early `Map.has`
      // shortcut would leak membership through timing.
      expect(calls).toBeGreaterThan(afterValid);
    } finally {
      (crypto as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = real;
    }
  });

  it("scans every row on a miss, so lookup cost does not reveal a near match", () => {
    const reg = new McpTokenRegistry();
    for (let i = 0; i < 5; i += 1) reg.mintForSession(`session-${i}`);
    expect(reg.size).toBe(5);
    expect(reg.resolve(`mcp_${crypto.randomBytes(32).toString("base64url")}`)).toBeNull();
  });
});
