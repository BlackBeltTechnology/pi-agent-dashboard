/**
 * mcp-client-plugin · client hooks.
 *
 * `useEffectiveConfig` reads `/api/mcp-client/effective` through a module-level
 * store that keeps ONE in-flight request per key (global = `""`, else the cwd)
 * and caches the last success, so several components mounting together issue a
 * single request and a remount is free.
 *
 * `useLiveState` reads `/api/mcp-client/live` on mount (page view) and on an
 * explicit refresh only — the command connects to every server, so it is slow.
 *
 * See change: migrate-mcp-to-pi-builtin.
 */
import { useCallback, useEffect, useState } from "react";
import type { EffectiveView, LiveState } from "../core/types.js";
import { ApiError, fetchEffective, fetchLive } from "./api.js";

// ─── effective config store ──────────────────────────────────────────────────

const cache = new Map<string, EffectiveView>();
const inflight = new Map<string, Promise<EffectiveView>>();

/**
 * Per-cwd 403 cache. The server is the ONLY source of cwd admission (the slot
 * contract passes `{cwd,label}` only), so once a cwd is refused there is no
 * point re-asking until the client's session / pinned-folder list changes —
 * that list is what can turn an unknown folder into a known one. A refused key
 * therefore short-circuits `loadEffective` and re-renders the not-tracked state
 * without touching the network.
 */
const notTracked = new Map<string, ApiError>();

function keyOf(cwd?: string): string {
  return cwd ?? "";
}

/** Test-only: drop every cached 403 so each test starts from a clean slate. */
export function __resetNotTrackedCache(): void {
  notTracked.clear();
}

/**
 * Load the effective view, sharing one in-flight request per key and reusing
 * the cached success. `force` bypasses both (a user-initiated reload/refresh).
 */
export function loadEffective(
  cwd?: string,
  opts: { force?: boolean } = {},
): Promise<EffectiveView> {
  const key = keyOf(cwd);
  if (!opts.force) {
    const refused = notTracked.get(key);
    if (refused) return Promise.reject(refused);
    const pending = inflight.get(key);
    if (pending) return pending;
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
  }
  const request = fetchEffective(cwd).then(
    (view) => {
      // A superseded request (invalidated, or replaced by a forced reload) must
      // not repopulate the cache with a now-stale body.
      if (inflight.get(key) === request) {
        cache.set(key, view);
        inflight.delete(key);
        notTracked.delete(key);
      }
      return view;
    },
    (err: unknown) => {
      if (inflight.get(key) === request) inflight.delete(key);
      // Remember a cwd refusal so a remount / sibling pill does not re-ask.
      if (err instanceof ApiError && err.isNotAllowed) notTracked.set(key, err);
      throw err;
    },
  );
  inflight.set(key, request);
  return request;
}

/** Drop the cached view — and any cached 403 — for one key after a write. */
export function invalidateEffective(cwd?: string): void {
  const key = keyOf(cwd);
  cache.delete(key);
  inflight.delete(key);
  notTracked.delete(key);
}

export interface EffectiveState {
  view: EffectiveView | null;
  loading: boolean;
  error: unknown;
  /** Re-fetch, bypassing the cache. */
  reload: () => void;
}

/** The effective view for a cwd (global when omitted). */
export function useEffectiveConfig(cwd?: string): EffectiveState {
  const [view, setView] = useState<EffectiveView | null>(() => cache.get(keyOf(cwd)) ?? null);
  const [loading, setLoading] = useState(view === null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadEffective(cwd, nonce > 0 ? { force: true } : {})
      .then((v) => {
        if (!alive) return;
        setView(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cwd, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { view, loading, error, reload };
}

// ─── live state ──────────────────────────────────────────────────────────────

export interface LiveStateHook {
  live: LiveState | null;
  loading: boolean;
  /** Re-run the live command (explicit refresh). */
  refresh: () => void;
}

/**
 * Live state for a scope. Fetches on mount (page view) and on `refresh()`
 * only — never on an interval — and renders `null` until the result lands so
 * the list can render from `/effective` first. A failure leaves `live` null
 * (rows read "state unknown"); it is not a page error.
 */
export function useLiveState(cwd?: string): LiveStateHook {
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the explicit-refresh remount key
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchLive(cwd)
      .then((v) => {
        if (alive) setLive(v);
      })
      .catch(() => {
        if (alive) setLive(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cwd, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { live, loading, refresh };
}
