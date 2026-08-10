/**
 * Canonical identity key for the idempotent acquire path (D10).
 *
 * `identityKey = visitor-or-channel-or-trigger identity + canonical cwd +
 * agent/profile identity`, where the canonical cwd is realpath-resolved and
 * case-normalized so symlinks, worktrees, and case-insensitive filesystems
 * (macOS/Windows default) collapse one physical dir to a single key — otherwise
 * one visitor/cwd maps to many keys and spawns many sessions (E11).
 *
 * Case normalization is platform-gated: lower-casing is applied ONLY on
 * case-insensitive filesystems, so `/Foo` and `/foo` (genuinely distinct on
 * case-sensitive Linux) are NOT wrongly collapsed there.
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import { realpathSync } from "node:fs";
import { caseInsensitiveFilesystem } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

const NUL = "\u0000"; // unambiguous separator — cannot appear in a path/identity

export interface IdentityKeyParts {
  /** visitorId | channelId | trigger — the machine-front identity. */
  visitorId: string;
  /** Requested working directory (raw; canonicalized here). */
  cwd: string;
  /** Agent/profile identity; empty string when unspecified. */
  agentIdentity?: string;
}

export interface CanonicalizeOptions {
  /** Test seam for `realpathSync`. */
  realpath?: (p: string) => string;
  /** Force case-insensitivity (defaults to darwin/win32 detection). */
  caseInsensitive?: boolean;
}

const platformIsCaseInsensitive = caseInsensitiveFilesystem();

/**
 * Realpath-resolve + case-normalize a cwd. A realpath failure (missing dir)
 * falls back to the input path so an out-of-allowlist reject still has a stable
 * key to log. Never throws.
 */
export function canonicalizeCwd(cwd: string, opts: CanonicalizeOptions = {}): string {
  const realpath = opts.realpath ?? realpathSync;
  const caseInsensitive = opts.caseInsensitive ?? platformIsCaseInsensitive;
  let resolved: string;
  try {
    resolved = realpath(cwd);
  } catch {
    resolved = cwd;
  }
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/** Extract the visitor/channel/trigger identity (first segment) from a key. */
export function visitorIdOf(key: string): string {
  return key.split(NUL)[0] ?? "";
}

/** Join already-canonical parts into the composite key (no canonicalization). */
export function composeIdentityKey(
  visitorId: string,
  canonicalCwd: string,
  agentIdentity = "",
): string {
  return [visitorId, canonicalCwd, agentIdentity].join(NUL);
}

/** Build the composite identity key from its parts (cwd canonicalized). */
export function buildIdentityKey(parts: IdentityKeyParts, opts: CanonicalizeOptions = {}): string {
  return composeIdentityKey(parts.visitorId, canonicalizeCwd(parts.cwd, opts), parts.agentIdentity);
}
