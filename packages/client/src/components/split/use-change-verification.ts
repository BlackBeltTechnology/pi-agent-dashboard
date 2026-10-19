/**
 * Changed-on-disk verification for the session editor pane.
 *
 * A `file_changed` signal is only a *candidate*. This hook verifies it against
 * a per-tab content baseline (`GET /api/file/digest`) and exposes the set of
 * paths whose bytes really differ (`verified`) — the only thing the banner
 * reads. An identical digest clears the candidate silently.
 *
 * Invariants (see design D1–D3):
 *  - A stale view is never silent: every failure (404, refusal, network error,
 *    no `sha1`, null baseline) resolves toward "banner".
 *  - One verification per path at a time; a newer candidate supersedes an older
 *    one, and a baseline `version` bump while one is in flight discards its
 *    result and re-runs it.
 *  - The baseline is read BEFORE the viewer loads content (`captureBaseline`),
 *    so a change in between yields a false-positive banner, never a missed one.
 *  - The pane's own Save rebaselines from the write response (`trackedFileWrite`)
 *    and a candidate for a path with a save in flight waits for it (bounded).
 *  - Dismiss/Refresh bump a per-path epoch so an in-flight verification cannot
 *    resurrect a dismissed banner.
 *  - All per-path state belongs to one `(sessionId, cwd)` scope; a switch drops it.
 *
 * Inert when `enabled` is false (the folder-scoped pane): no digests, no timers,
 * `trackedFileWrite` is a plain passthrough.
 *
 * See change: gate-changed-on-disk-by-content (D1–D3, D7).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { type FileDigest, fetchFileDigest } from "../../lib/file-digest.js";
import { plainFileWrite } from "./tracked-file-write.js";

/** Let a burst of events (a pi `write`, a formatter) settle before hashing. */
const SETTLE_MS = 150;
/** Mount-time catch-up: covers a change landing before `watch_files` reached the server. */
const CATCH_UP_MS = 1000;
/** Bound on waiting for an own save (and on the save request itself). */
const SAVE_WAIT_MS = 60_000;

interface Run {
  ac: AbortController;
}

interface Store {
  key: string;
  disposed: boolean;
  /** `null` = baseline unknown/unverifiable: the next candidate always banners. */
  baseline: Map<string, FileDigest | null>;
  versions: Map<string, number>;
  epochs: Map<string, number>;
  captureSeq: Map<string, number>;
  saving: Map<string, Promise<void>>;
  runs: Map<string, Run>;
  settle: Map<string, ReturnType<typeof setTimeout>>;
  catchUp: Map<string, ReturnType<typeof setTimeout>>;
  baselineSeen: Set<string>;
  lastGen: Map<string, number>;
}

function newStore(key: string): Store {
  return {
    key,
    disposed: false,
    baseline: new Map(),
    versions: new Map(),
    epochs: new Map(),
    captureSeq: new Map(),
    saving: new Map(),
    runs: new Map(),
    settle: new Map(),
    catchUp: new Map(),
    baselineSeen: new Set(),
    lastGen: new Map(),
  };
}

function cancelRun(st: Store, path: string): void {
  const t = st.settle.get(path);
  if (t) clearTimeout(t);
  st.settle.delete(path);
  st.runs.get(path)?.ac.abort();
  st.runs.delete(path);
}

function dropPath(st: Store, path: string): void {
  cancelRun(st, path);
  const c = st.catchUp.get(path);
  if (c) clearTimeout(c);
  st.catchUp.delete(path);
  st.baseline.delete(path);
  st.baselineSeen.delete(path);
  st.lastGen.delete(path);
  st.saving.delete(path);
}

function disposeStore(st: Store): void {
  st.disposed = true;
  for (const p of new Set([...st.runs.keys(), ...st.settle.keys(), ...st.catchUp.keys(), ...st.baseline.keys()])) {
    dropPath(st, p);
  }
}

interface VerifyCtx {
  opts: () => ChangeVerificationOptions;
  setVerified: (path: string, on: boolean) => void;
  reschedule: (path: string) => void;
}

/** Wait for an own save on `path` to settle, bounded by `SAVE_WAIT_MS`. */
async function awaitSave(saving: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    saving,
    new Promise<void>((res) => {
      timer = setTimeout(res, SAVE_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/**
 * One verification run: (wait for an own save) → digest → commit. Commits only
 * if this run is still the path's current one; a baseline `version` bump while
 * in flight discards the result and re-runs; a dismiss (`epoch`) discards it.
 */
async function executeVerification(st: Store, path: string, run: Run, ctx: VerifyCtx): Promise<void> {
  const current = (): boolean => !st.disposed && st.runs.get(path) === run;
  const saving = st.saving.get(path);
  if (saving) {
    await awaitSave(saving);
    if (!current()) return;
  }
  const startVersion = st.versions.get(path) ?? 0;
  const startEpoch = st.epochs.get(path) ?? 0;
  const startGen = ctx.opts().candidates?.get(path);
  // A transport error is `null` (never silent); an abort leaves `current()` false.
  const digest = await fetchFileDigest(ctx.opts().cwd, path, "verify", run.ac.signal).catch(() => null);
  if (!current()) return;
  st.runs.delete(path);
  if ((st.versions.get(path) ?? 0) !== startVersion) {
    ctx.reschedule(path); // baseline moved while we were in flight: re-run against it
    return;
  }
  if ((st.epochs.get(path) ?? 0) !== startEpoch) return; // dismissed meanwhile
  const base = st.baseline.get(path);
  if (digest && base && digest.sha1 === base.sha1) {
    ctx.opts().onClearCandidate(path, startGen);
    ctx.setVerified(path, false);
  } else {
    ctx.setVerified(path, true);
  }
}

/**
 * What a write response means for the tab baseline: the written bytes' digest
 * (own save), `null` (written but unverifiable — above the ceiling or an
 * unreadable answer: next candidate banners), or `"unchanged"` (the server
 * refused with 4xx/5xx: nothing was written).
 */
async function writeOutcome(res: Response): Promise<FileDigest | null | "unchanged"> {
  if (!res.ok) return "unchanged";
  const json = await res
    .clone()
    .json()
    .catch(() => null);
  const d = json?.success ? json.data : null;
  if (typeof d?.sha1 !== "string") return null;
  return { sha1: d.sha1, size: typeof d.size === "number" ? d.size : 0, mtime: typeof d.mtime === "number" ? d.mtime : 0 };
}

const bump = (m: Map<string, number>, k: string): number => {
  const n = (m.get(k) ?? 0) + 1;
  m.set(k, n);
  return n;
};

export interface ChangeVerificationOptions {
  /** Session scope only (D7). When false the hook is inert. */
  enabled: boolean;
  sessionId: string;
  cwd: string;
  /** Candidate map from the message handler: path → generation (bumped on every `file_changed`). */
  candidates: Map<string, number> | null;
  /** Remove a candidate; with `gen`, only if it is still that generation. */
  onClearCandidate: (path: string, gen?: number) => void;
  /** Real (non-pseudo) file paths currently open as tabs. */
  openPaths: string[];
  /** WS connection generation; a bump re-declares the watch and runs a catch-up. */
  connectionGeneration: number;
  /** Re-send `watch_files` for the open set. */
  resyncWatch: () => void;
}

export interface ChangeVerification {
  /** Paths whose bytes differ from the tab baseline (drives the banner). */
  verified: Set<string>;
  captureBaseline: (path: string) => Promise<void>;
  trackedFileWrite: (path: string, body: Record<string, unknown>) => Promise<Response>;
  /** Dismiss/Refresh: drop the banner + candidate and make any in-flight verification moot. */
  dismiss: (path: string) => void;
}

const EMPTY_SET: Set<string> = new Set();

export function useChangeVerification(o: ChangeVerificationOptions): ChangeVerification {
  const { enabled, sessionId, cwd, candidates, openPaths, connectionGeneration } = o;
  const key = `${sessionId}\u0000${cwd}`;
  const store = useMemo(() => newStore(key), [key]);
  const optsRef = useRef(o);
  optsRef.current = o;

  const [verifiedState, setVerifiedState] = useState<{ key: string; set: Set<string> }>({ key, set: EMPTY_SET });
  const verified = verifiedState.key === key ? verifiedState.set : EMPTY_SET;

  const setVerified = useCallback(
    (path: string, on: boolean) => {
      if (store.disposed) return;
      setVerifiedState((prev) => {
        const base = prev.key === store.key ? prev.set : EMPTY_SET;
        if (base.has(path) === on) return prev.key === store.key ? prev : { key: store.key, set: base };
        const next = new Set(base);
        if (on) next.add(path);
        else next.delete(path);
        return { key: store.key, set: next };
      });
    },
    [store],
  );

  // Drop everything for the outgoing scope (session switch / unmount).
  useEffect(() => () => disposeStore(store), [store]);

  const schedule = useCallback(
    (path: string, delay: number = SETTLE_MS) => {
      const st = store;
      if (st.disposed) return;
      cancelRun(st, path);
      const run: Run = { ac: new AbortController() };
      st.runs.set(path, run);
      st.settle.set(
        path,
        setTimeout(() => {
          st.settle.delete(path);
          void executeVerification(st, path, run, {
            opts: () => optsRef.current,
            setVerified,
            reschedule: (p) => schedule(p, 0),
          });
        }, delay),
      );
    },
    [store, setVerified],
  );

  // Candidates → verification. Each new generation is a new candidate.
  const openSet = useMemo(() => new Set(openPaths), [openPaths]);
  useEffect(() => {
    if (!enabled || !candidates) return;
    for (const [path, gen] of candidates) {
      if (store.lastGen.get(path) === gen) continue;
      store.lastGen.set(path, gen);
      if (openSet.has(path)) schedule(path);
    }
  }, [enabled, candidates, openSet, store, schedule]);

  // A closed tab loses its baseline, timers and banner mark.
  useEffect(() => {
    if (!enabled) return;
    for (const p of [...store.baseline.keys(), ...store.runs.keys(), ...store.catchUp.keys(), ...store.baselineSeen]) {
      if (!openSet.has(p)) {
        dropPath(store, p);
        setVerified(p, false);
      }
    }
  }, [enabled, openSet, store, setVerified]);

  const captureBaseline = useCallback(
    async (path: string): Promise<void> => {
      if (!enabled) return;
      const st = store;
      const seq = bump(st.captureSeq, path);
      const startGen = optsRef.current.candidates?.get(path);
      cancelRun(st, path);
      const pending = st.catchUp.get(path);
      if (pending) clearTimeout(pending);
      st.catchUp.delete(path);
      let digest: FileDigest | null = null;
      try {
        digest = await fetchFileDigest(optsRef.current.cwd, path, "baseline");
      } catch {
        digest = null;
      }
      if (st.disposed || st.captureSeq.get(path) !== seq) return;
      st.baseline.set(path, digest);
      bump(st.versions, path);
      setVerified(path, false);
      if (startGen !== undefined) optsRef.current.onClearCandidate(path, startGen);
      if (digest && !st.baselineSeen.has(path)) {
        st.baselineSeen.add(path);
        st.catchUp.set(
          path,
          setTimeout(() => {
            st.catchUp.delete(path);
            if (!st.disposed && st.baseline.get(path)) schedule(path, 0);
          }, CATCH_UP_MS),
        );
      }
    },
    [enabled, store, setVerified, schedule],
  );

  const trackedFileWrite = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Response> => {
      // Not tracked: change detection off, or a write for another cwd than this
      // pane's (e.g. a preview overlay of another project).
      if (!enabled || (typeof body.cwd === "string" && body.cwd !== optsRef.current.cwd)) return plainFileWrite(body);
      const st = store;
      let done!: () => void;
      const settled = new Promise<void>((res) => {
        done = res;
      });
      st.saving.set(path, settled);
      // The write itself is NOT aborted on a timer: a slow-but-successful save (large file, tunnel) would be
      // reported as failed and leave a stale mtime (next Save -> 409). Only a candidate's WAIT is bounded
      // (`awaitSave`, SAVE_WAIT_MS); a late response still rebaselines and clears any banner it caused.
      const rebaseline = (next: FileDigest | null): void => {
        if (st.disposed) return;
        st.baseline.set(path, next);
        bump(st.versions, path);
      };
      try {
        const res = await fetch(`${getApiBase()}/api/file/write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const outcome = await writeOutcome(res);
        if (outcome !== "unchanged") {
          rebaseline(outcome);
          if (outcome) setVerified(path, false); // the view now equals disk
        }
        return res;
      } catch (err) {
        rebaseline(null); // outcome unknown (network error): safe direction
        throw err;
      } finally {
        if (st.saving.get(path) === settled) st.saving.delete(path);
        done();
      }
    },
    [enabled, store, setVerified],
  );

  const dismiss = useCallback(
    (path: string) => {
      bump(store.epochs, path);
      cancelRun(store, path);
      setVerified(path, false);
      optsRef.current.onClearCandidate(path);
    },
    [store, setVerified],
  );

  // Reconnect: the server dropped every watcher. Re-declare the open set, then
  // check every non-null baseline (changes made while disconnected).
  const prevConnGen = useRef(connectionGeneration);
  useEffect(() => {
    if (prevConnGen.current === connectionGeneration) return;
    prevConnGen.current = connectionGeneration;
    if (!enabled) return;
    optsRef.current.resyncWatch();
    for (const [p, b] of store.baseline) if (b) schedule(p, 0);
  }, [connectionGeneration, enabled, store, schedule]);

  return { verified, captureBaseline, trackedFileWrite, dismiss };
}
