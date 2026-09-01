/**
 * Per-session MCP token registry (design.md Decisions 4a, 7, 8).
 *
 * A session-scoped credential is what makes the caller's originating session
 * *server-known and unspoofable* — the precondition for the self-target guard
 * (Req 6) being a real control rather than theatre. A client-declared session
 * id would be trivially forged, which is exactly the objection that overturned
 * the original design.
 *
 * Cryptography mirrors `packages/server/src/pairing/paired-devices.ts`: an
 * opaque 256-bit random token (not a JWT — revocation is a row delete with no
 * denylist), SHA-256 at rest so a leaked registry cannot be replayed, plaintext
 * returned exactly once at mint, and constant-time comparison on verify.
 *
 * Persistence deliberately DIVERGES from that precedent: this registry is
 * **in-memory only**. Consequences, all of them wanted:
 *
 *   - A restart invalidates every token (X9). "Partially valid" is not a state
 *     that can be reached, because there is no file to half-read or half-write.
 *     Sessions simply re-mint when their bridge re-registers.
 *   - The registry dies with the plugin, so a plugin load failure leaves no
 *     stale credential behind (X8).
 *   - There is no `mcp-tokens.json` to leak, chmod wrongly, or corrupt.
 *
 * There is no independent expiry. A token's lifetime IS its session's lifetime;
 * a second expiry axis would add a failure mode without closing a threat.
 */
import crypto from "node:crypto";

/** 256-bit opaque bearer, matching `paired-devices.ts` `TOKEN_BYTES`. */
const TOKEN_BYTES = 32;

/** Distinguishes an MCP session token from a paired-device bearer at a glance. */
const TOKEN_PREFIX = "mcp_";

/**
 * Who the server believes is calling, resolved from the presented credential
 * alone (design.md Decision 4a). Never from anything the client asserts.
 */
export type McpCaller =
  | { kind: "session"; sessionId: string }
  | { kind: "device"; deviceId: string };

interface TokenRow {
  /** SHA-256 hex of the plaintext token. The plaintext is never retained. */
  tokenHash: string;
  /** The session this token authenticates as. */
  sessionId: string;
  /** Epoch ms of mint. Observability only — never an expiry input. */
  mintedAt: number;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare of two equal-length hex digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export class McpTokenRegistry {
  /**
   * A flat array, not a `Map` keyed by hash, on purpose. A map lookup would
   * short-circuit on a miss and leak membership through timing; the linear scan
   * performs the same `timingSafeEqual` work whether or not a row matches
   * (X10).
   */
  private rows: TokenRow[] = [];

  /** Number of live tokens. Test/observability surface. */
  get size(): number {
    return this.rows.length;
  }

  /**
   * Mint a token for `sessionId`, returning the plaintext exactly once.
   *
   * The caller is responsible for having proven the session's identity. The
   * only channel that can do so is the bridge WebSocket, where the sessionId is
   * the key the socket is stored under (design.md Decision 6) — never a field
   * read off the wire.
   */
  mintForSession(sessionId: string): string {
    const token = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    this.rows.push({ tokenHash: hashToken(token), sessionId, mintedAt: Date.now() });
    return token;
  }

  /**
   * Resolve a presented token to its caller, or `null` when it authenticates
   * nothing. Tolerates arbitrary input — this runs on unauthenticated request
   * data, so it must never throw.
   */
  resolve(token: string | undefined | null): McpCaller | null {
    if (typeof token !== "string" || token.length === 0) return null;
    const presented = hashToken(token);
    let found: TokenRow | undefined;
    // Scans every row even after a match, so the work done is independent of
    // WHERE the match sits — see the `rows`-is-an-array note above.
    for (const row of this.rows) {
      if (timingSafeEqualHex(presented, row.tokenHash)) found = row;
    }
    return found ? { kind: "session", sessionId: found.sessionId } : null;
  }

  /** Revoke one token (explicit `mcp/revoke-token`). True when a row went. */
  revokeToken(token: string | undefined | null): boolean {
    if (typeof token !== "string" || token.length === 0) return false;
    const presented = hashToken(token);
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !timingSafeEqualHex(presented, row.tokenHash));
    return this.rows.length !== before;
  }

  /**
   * Revoke every token bound to a session — the primary path, driven by
   * `onSessionEnded` and the bridge's `onDisconnect` (Decision 8). Returns how
   * many rows went, so a caller can log the effect.
   */
  revokeSession(sessionId: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.sessionId !== sessionId);
    return before - this.rows.length;
  }

  /**
   * Drop every token. Called when the plugin unloads so no credential outlives
   * the code that honours it (X8).
   */
  dispose(): void {
    this.rows = [];
  }

  /** Test-only view proving the plaintext is absent from stored state. */
  debugRows(): ReadonlyArray<Readonly<TokenRow>> {
    return this.rows.map((row) => ({ ...row }));
  }

  /** Test-only: rewrite a row's mint time to assert age is never an input. */
  debugBackdate(token: string, mintedAt: number): void {
    const presented = hashToken(token);
    for (const row of this.rows) {
      if (timingSafeEqualHex(presented, row.tokenHash)) row.mintedAt = mintedAt;
    }
  }
}
