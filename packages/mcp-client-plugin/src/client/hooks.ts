/**
 * mcp-client-plugin · client hooks.
 *
 * `useEffectiveConfig` reads `/api/mcp-client/effective` through a module-level
 * store that keeps ONE in-flight request per key (global = `""`, else the cwd)
 * and caches the last success, so several components mounting together issue a
 * single request and a remount is free.
 *
 * `useAdapterStatus` derives the ONE status object (pill, banner, read-only
 * flag) from an adapter verdict, so those three can never disagree.
 *
 * See change: extract-mcp-client-plugin (task 7.1).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdapterVerdict } from "../core/types.js";
import { ApiError, type EffectiveResponse, fetchEffective } from "./api.js";

/**
 * Fallback floor, used ONLY when a caller has no verdict at all. The real
 * constant lives in `core/adapter-verdict.ts`, which this browser bundle must
 * not import (`node:path`). Every route supplies `floor` on the verdict.
 */
const FALLBACK_ADAPTER_FLOOR = "2.20.0";

// ─── effective config store ──────────────────────────────────────────────────

const cache = new Map<string, EffectiveResponse>();
const inflight = new Map<string, Promise<EffectiveResponse>>();

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
): Promise<EffectiveResponse> {
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
  view: EffectiveResponse | null;
  loading: boolean;
  error: unknown;
  /** Re-fetch, bypassing the cache. */
  reload: () => void;
}

/** The effective view for a cwd (global when omitted). */
export function useEffectiveConfig(cwd?: string): EffectiveState {
  const [view, setView] = useState<EffectiveResponse | null>(() => cache.get(keyOf(cwd)) ?? null);
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

// ─── adapter status ──────────────────────────────────────────────────────────

/** The single derived status: pill, banner, and page-wide read-only all read it. */
export interface AdapterStatus {
  kind: AdapterVerdict["kind"];
  /** True only for `ok` — the sole kind that permits writes. */
  ok: boolean;
  /** Every mutating control is disabled and the editor opens in view mode. */
  readOnly: boolean;
  installed?: string;
  floor: string;
  message: string;
  /** The banner's single CTA: upgrade for `below-floor`, install for `absent`. */
  action: "upgrade" | "install" | null;
}

const DEFAULT_MESSAGE: Record<AdapterVerdict["kind"], string> = {
  ok: "pi-mcp-adapter is up to date.",
  absent: "pi-mcp-adapter is not installed.",
  "below-floor": "pi-mcp-adapter is below the required version.",
  unparseable: "pi-mcp-adapter's installed version could not be read.",
  unknown: "pi-mcp-adapter status is unknown.",
};

export function deriveAdapterStatus(verdict: AdapterVerdict | undefined): AdapterStatus {
  const v: AdapterVerdict = verdict ?? { kind: "unknown", floor: FALLBACK_ADAPTER_FLOOR };
  const ok = v.kind === "ok";
  return {
    kind: v.kind,
    ok,
    readOnly: !ok,
    installed: v.installed,
    floor: v.floor,
    message: v.message ?? DEFAULT_MESSAGE[v.kind],
    action: v.kind === "below-floor" ? "upgrade" : v.kind === "absent" ? "install" : null,
  };
}

/** One memoized status object per verdict, so pill + banner update together. */
export function useAdapterStatus(verdict: AdapterVerdict | undefined): AdapterStatus {
  return useMemo(() => deriveAdapterStatus(verdict), [verdict]);
}
