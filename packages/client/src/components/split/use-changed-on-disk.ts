/**
 * Content-gated changed-on-disk detection for the SESSION editor pane.
 *
 * A `file_changed` event is only a *candidate* (touch / chmod / identical
 * rewrite all fire one). This hook verifies each candidate against a per-tab
 * SHA-1 `baseline` taken before the viewer mounted, via
 * `GET /api/file/digest`, and only a path whose bytes really differ (or whose
 * state cannot be verified) lands in `verified` → the banner.
 *
 *  - generation rule: every `file_changed` carries a monotonic generation; one
 *    verification per path wins (`seq`), an older result is discarded.
 *  - baseline `version` bumps on capture / own save / `setBaseline`; an
 *    in-flight result from an older version is discarded and the pending
 *    candidate re-run against the new baseline.
 *  - failure is never silent: any digest failure / missing sha1 / null
 *    baseline → banner.
 *  - own saves go through `trackedFileWrite` (candidates for that path wait,
 *    the baseline becomes the returned `sha1`).
 *
 * All state lives in a per-(sessionId, cwd) scope that is replaced on a
 * session switch, so two sessions never share a baseline. Disabled
 * (`enabled=false`, folder pane) → inert: no digests, passthrough writes, the
 * banner set mirrors the raw candidates.
 *
 * See change: gate-changed-on-disk-by-content (D1–D3, D7).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithoutGrantPrompt } from "../../lib/access-grants/grant-channel.js";
import { getApiBase } from "../../lib/api/api-context.js";

/** Delay between a candidate and its digest (lets a write burst settle). */
const SETTLE_MS = 150;
/** Mount-time catch-up: one verification this long after a baseline capture. */
const CATCHUP_MS = 1000;
/** Upper bound on how long a candidate waits for / a write runs under an own save. */
const SAVE_WAIT_MS = 60_000;

/**
 * What a tracked save promise resolves to. `ok === false` = the server refused
 * (409/4xx/5xx): baseline unchanged. A rejection carrying a numeric `status`
 * is treated the same; any other rejection = unknown outcome → baseline `null`.
 */
export interface TrackedWriteResult {
  ok?: boolean;
  /** Hex SHA-1 of the saved bytes (`POST /api/file/write` → `data.sha1`). Absent → baseline `null`. */
  sha1?: string;
}
/** A save: a promise, or a runner that gets a signal aborted after {@link SAVE_WAIT_MS}. */
export type TrackedWrite<T extends TrackedWriteResult> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

/** Run a save untracked (no provider, or change detection off). */
export function passthroughWrite<T extends TrackedWriteResult>(w: TrackedWrite<T>): Promise<T> {
  return typeof w === "function" ? w(new AbortController().signal) : w;
}

interface PathState {
  /** `undefined` = never captured; `null` = captured but unverifiable. */
  baseline: string | null | undefined;
  version: number;
  seq: number;
  /** Generation of an unresolved candidate (re-run on a version bump). */
  pendingGen: number | null;
  timer?: ReturnType<typeof setTimeout>;
  catchup?: ReturnType<typeof setTimeout>;
  ctrl?: AbortController;
  capture?: Promise<void>;
  saving?: Promise<void>;
}

interface Scope {
  key: string;
  alive: boolean;
  paths: Map<string, PathState>;
  /** Last candidate generation handed to `verify` per path. */
  processed: Map<string, number>;
}

const newScope = (key: string): Scope => ({ key, alive: true, paths: new Map(), processed: new Map() });
const EMPTY: ReadonlySet<string> = new Set();

function stopTimers(st: PathState): void {
  clearTimeout(st.timer);
  clearTimeout(st.catchup);
  st.timer = st.catchup = undefined;
  st.ctrl?.abort();
  st.ctrl = undefined;
}

/** Hex sha1 of the file's current bytes, or `null` on ANY failure / missing hash. */
async function fetchDigest(
  cwd: string,
  path: string,
  purpose: "baseline" | "verify",
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${getApiBase()}/api/file/digest?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}&purpose=${purpose}`;
    const res = await fetchWithoutGrantPrompt(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const sha = body?.data?.sha1;
    return body?.success && typeof sha === "string" && sha ? sha : null;
  } catch {
    return null;
  }
}

const isRefusal = (e: unknown): boolean => typeof (e as { status?: unknown } | null)?.status === "number";

export interface ChangedOnDiskOptions {
  enabled: boolean;
  sessionId: string;
  cwd: string;
  /** Raw `file_changed` candidates: path → generation. */
  candidates: ReadonlyMap<string, number> | null;
  /** Remove a candidate (only if still at `generation`, when given). */
  clearCandidate: (path: string, generation?: number) => void;
  /** Real (non-pseudo) open tab paths. */
  openPaths: readonly string[];
  /** WS connection generation (0 / undefined = disconnected). */
  connectionGeneration?: number;
}

export interface ChangedOnDisk {
  /** Paths whose banner shows (detection off: the raw candidates). */
  verified: ReadonlySet<string>;
  captureBaseline: (path: string) => Promise<string | null>;
  setBaseline: (path: string, sha1: string | null) => void;
  trackedFileWrite: <T extends TrackedWriteResult>(path: string, write: TrackedWrite<T>) => Promise<T>;
  /** Banner Dismiss: clear banner + candidate, keep the baseline. */
  dismiss: (path: string) => void;
  /** Banner Refresh: as Dismiss, and re-declare the watch set. */
  refresh: (path: string) => void;
  /** Bumps on Refresh + WS reconnect; a dep of the `watch_files` effect. */
  watchNonce: number;
}

export function useChangedOnDisk(opts: ChangedOnDiskOptions): ChangedOnDisk {
  const { enabled, sessionId, cwd, candidates, connectionGeneration } = opts;
  const scopeKey = `${sessionId}\u0000${cwd}`;
  const scopeRef = useRef<Scope | null>(null);
  if (!scopeRef.current || scopeRef.current.key !== scopeKey) scopeRef.current = newScope(scopeKey);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const clearRef = useRef(opts.clearCandidate);
  clearRef.current = opts.clearCandidate;
  const openPathsRef = useRef(opts.openPaths);
  openPathsRef.current = opts.openPaths;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const [verifiedState, setVerifiedState] = useState<{ key: string; paths: ReadonlySet<string> }>({
    key: scopeKey,
    paths: EMPTY,
  });
  const [watchNonce, setWatchNonce] = useState(0);

  const live = (scope: Scope, st: PathState, seq: number): boolean =>
    scope.alive && scopeRef.current === scope && st.seq === seq;

  const getState = (scope: Scope, path: string): PathState => {
    let st = scope.paths.get(path);
    if (!st) {
      st = { baseline: undefined, version: 0, seq: 0, pendingGen: null };
      scope.paths.set(path, st);
    }
    return st;
  };

  const markVerified = useCallback((scope: Scope, path: string, on: boolean) => {
    if (!scope.alive) return;
    setVerifiedState((prev) => {
      const base = prev.key === scope.key ? prev.paths : EMPTY;
      if (base.has(path) === on) return prev.key === scope.key ? prev : { key: scope.key, paths: base };
      const next = new Set(base);
      if (on) next.add(path);
      else next.delete(path);
      return { key: scope.key, paths: next };
    });
  }, []);

  /** (Re)start the verification of `path`; `gen` null = candidate-less catch-up. */
  const verify = useCallback(
    (scope: Scope, path: string, gen: number | null) => {
      const st = getState(scope, path);
      const seq = ++st.seq;
      clearTimeout(st.timer);
      st.ctrl?.abort();
      if (gen !== null) st.pendingGen = gen;
      const run = async () => {
        st.timer = undefined;
        if (st.capture !== undefined) await st.capture;
        if (!live(scope, st, seq)) return;
        if (st.saving !== undefined) await st.saving;
        if (!live(scope, st, seq)) return;
        const version = st.version;
        const ctrl = new AbortController();
        st.ctrl = ctrl;
        const sha = await fetchDigest(cwdRef.current, path, "verify", ctrl.signal);
        if (!live(scope, st, seq) || st.version !== version) return;
        st.ctrl = undefined;
        const resolvedGen = gen ?? st.pendingGen;
        st.pendingGen = null;
        if (sha !== null && st.baseline != null && sha === st.baseline) {
          markVerified(scope, path, false);
          if (resolvedGen !== null) clearRef.current(path, resolvedGen);
        } else {
          markVerified(scope, path, true);
        }
      };
      st.timer = setTimeout(() => void run(), gen !== null ? SETTLE_MS : 0);
    },
    [markVerified],
  );

  /** New baseline from an own save / `setBaseline`: discard in-flight results, re-run a pending candidate. */
  const rebaseline = useCallback(
    (scope: Scope, path: string, sha: string | null) => {
      const st = getState(scope, path);
      st.baseline = sha;
      st.version++;
      if (st.pendingGen !== null) verify(scope, path, st.pendingGen);
      else {
        st.seq++;
        st.ctrl?.abort();
        st.ctrl = undefined;
      }
    },
    [verify],
  );

  const captureBaseline = useCallback(
    async (path: string): Promise<string | null> => {
      if (!enabledRef.current) return null;
      const scope = scopeRef.current as Scope;
      const st = getState(scope, path);
      st.version++;
      st.seq++;
      stopTimers(st);
      st.pendingGen = null;
      markVerified(scope, path, false);
      clearRef.current(path);
      const version = st.version;
      const p = fetchDigest(cwdRef.current, path, "baseline", new AbortController().signal);
      const mark = p.then(() => undefined);
      st.capture = mark;
      const sha = await p;
      if (st.capture === mark) st.capture = undefined;
      if (!scope.alive || scopeRef.current !== scope || st.version !== version) return sha;
      st.baseline = sha;
      if (sha !== null) {
        st.catchup = setTimeout(() => {
          st.catchup = undefined;
          if (scope.alive && scopeRef.current === scope && st.baseline != null && openPathsRef.current.includes(path)) {
            verify(scope, path, null);
          }
        }, CATCHUP_MS);
      }
      return sha;
    },
    [markVerified, verify],
  );

  const setBaseline = useCallback(
    (path: string, sha1: string | null) => {
      if (!enabledRef.current) return;
      rebaseline(scopeRef.current as Scope, path, sha1);
    },
    [rebaseline],
  );

  const trackedFileWrite = useCallback(
    <T extends TrackedWriteResult>(path: string, write: TrackedWrite<T>): Promise<T> => {
      if (!enabledRef.current) return passthroughWrite(write);
      const scope = scopeRef.current as Scope;
      const st = getState(scope, path);
      const ctrl = new AbortController();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      st.saving = gate;
      const timer = setTimeout(() => {
        ctrl.abort();
        if (st.saving === gate) st.saving = undefined;
        release();
      }, SAVE_WAIT_MS);
      return (async () => {
        try {
          const r = await (typeof write === "function" ? write(ctrl.signal) : write);
          if (scope.alive && scopeRef.current === scope && r?.ok !== false) {
            rebaseline(scope, path, typeof r?.sha1 === "string" && r.sha1 ? r.sha1 : null);
            // The saved bytes ARE the view now: a banner raised by an interleaved read is stale.
            if (st.pendingGen === null) markVerified(scope, path, false);
          }
          return r;
        } catch (e) {
          if (scope.alive && scopeRef.current === scope && !isRefusal(e)) rebaseline(scope, path, null);
          throw e;
        } finally {
          clearTimeout(timer);
          if (st.saving === gate) st.saving = undefined;
          release();
        }
      })();
    },
    [rebaseline, markVerified],
  );

  const dismiss = useCallback(
    (path: string) => {
      const scope = scopeRef.current as Scope;
      const st = scope.paths.get(path);
      if (st) {
        st.seq++;
        clearTimeout(st.timer);
        st.timer = undefined;
        st.ctrl?.abort();
        st.ctrl = undefined;
        st.pendingGen = null;
      }
      markVerified(scope, path, false);
      clearRef.current(path);
    },
    [markVerified],
  );

  const refresh = useCallback(
    (path: string) => {
      dismiss(path);
      setWatchNonce((n) => n + 1);
    },
    [dismiss],
  );

  // Own lifecycle: tear the scope down on session switch / unmount (re-arm for StrictMode).
  useEffect(() => {
    const scope = scopeRef.current as Scope;
    scope.alive = true;
    return () => {
      scope.alive = false;
      for (const st of scope.paths.values()) stopTimers(st);
    };
  }, [scopeKey]);

  // Candidates → verifications.
  useEffect(() => {
    if (!enabled) return;
    const scope = scopeRef.current as Scope;
    const cur = candidates ?? new Map<string, number>();
    for (const [path, gen] of cur) {
      if (scope.processed.get(path) === gen) continue;
      scope.processed.set(path, gen);
      verify(scope, path, gen);
    }
    for (const path of [...scope.processed.keys()]) if (!cur.has(path)) scope.processed.delete(path);
  }, [enabled, candidates, scopeKey, verify]);

  // A closed tab drops its state (and cancels its pending catch-up / digest).
  const openKey = opts.openPaths.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: openKey is the content key for openPaths
  useEffect(() => {
    const scope = scopeRef.current as Scope;
    const open = new Set(openPathsRef.current);
    for (const [path, st] of scope.paths) {
      if (open.has(path)) continue;
      stopTimers(st);
      st.seq++;
      scope.paths.delete(path);
      scope.processed.delete(path);
      markVerified(scope, path, false);
    }
  }, [openKey, scopeKey, markVerified]);

  // Reconnect: the server dropped every watcher → re-declare the set, then one catch-up per baseline.
  const prevConn = useRef(connectionGeneration);
  useEffect(() => {
    if (prevConn.current === connectionGeneration) return;
    prevConn.current = connectionGeneration;
    if (!connectionGeneration) return;
    setWatchNonce((n) => n + 1);
    if (!enabled) return;
    const scope = scopeRef.current as Scope;
    for (const path of openPathsRef.current) {
      if (scope.paths.get(path)?.baseline != null) verify(scope, path, null);
    }
  }, [connectionGeneration, enabled, verify]);

  const verified = useMemo<ReadonlySet<string>>(() => {
    if (!enabled) return candidates && candidates.size > 0 ? new Set(candidates.keys()) : EMPTY;
    return verifiedState.key === scopeKey ? verifiedState.paths : EMPTY;
  }, [enabled, candidates, verifiedState, scopeKey]);

  return { verified, captureBaseline, setBaseline, trackedFileWrite, dismiss, refresh, watchNonce };
}
