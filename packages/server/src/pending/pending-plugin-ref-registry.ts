/**
 * Unified token-keyed pending store for the generic session-ownership seam.
 *
 * Replaces the two byte-similar per-feature clones
 * (`pending-automation-run-registry` + `pending-goal-link-registry`). A plugin
 * (or a first-party feature spawning in core) files an opaque `pluginRef`
 * against the spawn TOKEN it already mints, BEFORE the `spawnPiSession` await,
 * so a `session_register` arriving during the await resolves the ref rather
 * than missing it.
 *
 * Keyed by token, not cwd — token keys are unique (1:1), so there is NO
 * per-cwd FIFO cap (that cap was a per-cwd-queue artifact). Retention is a 60s
 * TTL swept on touch. A register past the TTL resolves no ref (the session is
 * unowned and consequently recovery-eligible) and ownership NEVER falls through
 * to a lower correlation tier — cwd never confers ownership.
 *
 * See change: detach-automation-goal-from-core.
 */

export const PENDING_PLUGIN_REF_TTL_MS = 60_000;

/**
 * Core-managed session fields a `pluginRef` may NEVER set. This is core owning
 * its OWN keys — it names no plugin. `recover` / `finalizeOnSocketClose` come
 * only from the separate lifecycle declaration, never the ref body.
 */
export const CORE_RESERVED_REF_KEYS: ReadonlySet<string> = new Set([
  "sessionId",
  "cwd",
  "source",
  "status",
  "closedReason",
  "live",
  "liveEpoch",
  "recover",
  "finalizeOnSocketClose",
  "spawnToken",
  "sessionFile",
  "startedAt",
  "endedAt",
  "name",
  "nameSource",
]);

/** Generic lifecycle declaration; core reads only these two booleans. */
export interface PluginSessionLifecycle {
  recover?: boolean;
  finalizeOnSocketClose?: boolean;
}

/** A resolved ownership record handed back on register. */
export interface ResolvedPluginRef {
  /** Sanitized identity keys safe to merge onto the session. */
  ref: Record<string, unknown>;
  /** Owning plugin/feature id (used to route the owner-notify). */
  ownerId: string;
  lifecycle?: PluginSessionLifecycle;
}

interface PendingRefEntry extends ResolvedPluginRef {
  filedAt: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Boundary-validate + sanitize a `pluginRef`, fail-open (publish/collect
 * doctrine). Drops:
 *   - a non-plain-object ref entirely (warns once under key `*`),
 *   - any core-reserved key,
 *   - any key already claimed by a DIFFERENT owner (first-writer-wins per key).
 * Claims previously-unowned keys for `ownerId`. Returns only the keys safe to
 * merge (possibly empty). Never throws. `warnOnce` is expected to de-duplicate
 * per key across calls.
 */
export function sanitizePluginRef(
  ref: unknown,
  ownerId: string,
  keyOwners: Map<string, string>,
  warnOnce: (key: string) => void,
): Record<string, unknown> {
  if (!isPlainObject(ref)) {
    warnOnce("*");
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ref)) {
    if (CORE_RESERVED_REF_KEYS.has(k)) {
      warnOnce(k);
      continue;
    }
    const owner = keyOwners.get(k);
    if (owner === undefined) {
      keyOwners.set(k, ownerId);
    } else if (owner !== ownerId) {
      warnOnce(k);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export interface PendingPluginRefRegistry {
  /**
   * File `spawnToken → pluginRef` BEFORE the spawn await. Returns `true` when a
   * non-empty sanitized ref (or a lifecycle declaration) was stored. A fully
   * dropped ref with no lifecycle stores nothing (the session registers
   * unowned) but is not an error.
   */
  file(
    token: string,
    ref: unknown,
    ownerId: string,
    lifecycle?: PluginSessionLifecycle,
  ): boolean;
  /** Consuming resolve by token; `null` when absent or past TTL. */
  resolve(token: string): ResolvedPluginRef | null;
  /**
   * Non-destructive presence probe: `true` while a live (unexpired) entry
   * exists for `token`. Unlike {@link resolve} it consumes nothing, so a
   * caller can reject a duplicate caller-supplied `spawnToken` without
   * destroying the prior owner's entry. See change:
   * relocate-goal-product-to-plugin (D1-#1).
   */
  has(token: string): boolean;
  /**
   * Sanitize a ref for `ownerId` against THIS store's shared key-ownership
   * state (core-reserved keys dropped, keys owned by a different plugin
   * dropped, first-writer-wins per key, warn-once) and CLAIM newly-unowned
   * keys for `ownerId` — exactly the register path's boundary, applied to
   * post-spawn ref merges. Never throws. See change:
   * relocate-goal-product-to-plugin (D1-#5).
   */
  sanitize(ref: unknown, ownerId: string): Record<string, unknown>;
  /** Idempotent, token-keyed rollback: removes only this token's entry. */
  remove(token: string): void;
  /** Live entry count (post-sweep). For tests/observability. */
  size(): number;
}

export interface PendingPluginRefOptions {
  now?: () => number;
  warn?: (msg: string) => void;
}

export function createPendingPluginRefRegistry(
  opts: PendingPluginRefOptions = {},
): PendingPluginRefRegistry {
  const now = opts.now ?? (() => Date.now());
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const store = new Map<string, PendingRefEntry>();
  /** Process-lifetime key→owner map for cross-owner key protection. */
  const keyOwners = new Map<string, string>();
  /** Warn-once-per-key dedupe across the store's lifetime. */
  const warnedKeys = new Set<string>();

  function warnOnceForKey(key: string): void {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    warn(`[pending-plugin-ref-registry] dropped ref key "${key}" (reserved, malformed, or owned by another plugin)`);
  }

  function sweep(): void {
    const cutoff = now() - PENDING_PLUGIN_REF_TTL_MS;
    for (const [token, entry] of store) {
      if (entry.filedAt < cutoff) store.delete(token);
    }
  }

  return {
    file(token, ref, ownerId, lifecycle): boolean {
      if (!token) return false;
      sweep();
      const sanitized = sanitizePluginRef(ref, ownerId, keyOwners, warnOnceForKey);
      const hasLifecycle =
        lifecycle !== undefined &&
        (lifecycle.recover !== undefined || lifecycle.finalizeOnSocketClose !== undefined);
      if (Object.keys(sanitized).length === 0 && !hasLifecycle) {
        // Nothing to own — do not file (register resolves unowned).
        return false;
      }
      store.set(token, {
        ref: sanitized,
        ownerId,
        ...(hasLifecycle ? { lifecycle } : {}),
        filedAt: now(),
      });
      return true;
    },

    resolve(token): ResolvedPluginRef | null {
      if (!token) return null;
      sweep();
      const entry = store.get(token);
      if (!entry) return null;
      store.delete(token);
      return { ref: entry.ref, ownerId: entry.ownerId, ...(entry.lifecycle ? { lifecycle: entry.lifecycle } : {}) };
    },

    has(token): boolean {
      if (!token) return false;
      sweep();
      return store.has(token);
    },

    sanitize(ref, ownerId): Record<string, unknown> {
      return sanitizePluginRef(ref, ownerId, keyOwners, warnOnceForKey);
    },

    remove(token): void {
      if (!token) return;
      store.delete(token);
    },

    size(): number {
      sweep();
      return store.size;
    },
  };
}
