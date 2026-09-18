/**
 * Token-keyed pending store correlating a human `principalOwner` to a spawn,
 * filed BEFORE the spawn await (openspec §6.2 / design D11), mirroring the
 * `pending-plugin-ref-registry` precedent the design names.
 *
 * A trusted spawn road (browser `spawn_session`, host HTTP spawn, or the
 * trusted owned-spawn API) files `spawnToken → { iss, sub }` before awaiting
 * `spawnPiSession`, so a `session_register` that arrives DURING the await still
 * resolves the owner rather than dropping or misattributing it. Ownership never
 * falls through to a lower correlation tier — `cwd` is never an ownership
 * signal.
 *
 * Keyed by the unique spawn token (1:1), so there is no per-cwd FIFO cap.
 * Retention is a 60s TTL swept on touch; a register past the TTL resolves no
 * owner (the session is ownerless). The owner is copied and frozen on file so a
 * later caller mutation cannot change a stored identity.
 */

import type { PrincipalOwner } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export const PENDING_PRINCIPAL_OWNER_TTL_MS = 60_000;

interface PendingOwnerEntry {
  owner: PrincipalOwner;
  filedAt: number;
}

export interface PendingPrincipalOwnerRegistry {
  /**
   * File `spawnToken → owner` BEFORE the spawn await. Returns `true` when a
   * well-formed owner was stored; a malformed owner or empty token stores
   * nothing (the session registers ownerless) and returns `false`.
   */
  file(token: string, owner: unknown): boolean;
  /** Consuming resolve by token; `null` when absent or past TTL. */
  resolve(token: string): PrincipalOwner | null;
  /** Idempotent, token-keyed rollback: removes only this token's entry. */
  remove(token: string): void;
  /** Live entry count (post-sweep). For tests/observability. */
  size(): number;
}

export interface PendingPrincipalOwnerOptions {
  now?: () => number;
}

/** Validate + copy + freeze an owner `(iss, sub)`; `null` when malformed. */
function sanitizeOwner(owner: unknown): PrincipalOwner | null {
  if (owner == null || typeof owner !== "object") return null;
  const iss = (owner as Record<string, unknown>).iss;
  const sub = (owner as Record<string, unknown>).sub;
  if (typeof iss !== "string" || iss.trim().length === 0) return null;
  if (typeof sub !== "string" || sub.trim().length === 0) return null;
  return Object.freeze({ iss, sub });
}

export function createPendingPrincipalOwnerRegistry(
  opts: PendingPrincipalOwnerOptions = {},
): PendingPrincipalOwnerRegistry {
  const now = opts.now ?? (() => Date.now());
  const store = new Map<string, PendingOwnerEntry>();

  function sweep(): void {
    const cutoff = now() - PENDING_PRINCIPAL_OWNER_TTL_MS;
    for (const [token, entry] of store) {
      if (entry.filedAt < cutoff) store.delete(token);
    }
  }

  return {
    file(token, owner): boolean {
      if (!token) return false;
      sweep();
      const clean = sanitizeOwner(owner);
      if (!clean) return false;
      store.set(token, { owner: clean, filedAt: now() });
      return true;
    },

    resolve(token): PrincipalOwner | null {
      if (!token) return null;
      sweep();
      const entry = store.get(token);
      if (!entry) return null;
      store.delete(token);
      return entry.owner;
    },

    remove(token): void {
      store.delete(token);
    },

    size(): number {
      sweep();
      return store.size;
    },
  };
}
