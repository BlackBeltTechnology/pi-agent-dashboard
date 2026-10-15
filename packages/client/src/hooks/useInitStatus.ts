/**
 * Single shared `GET /api/git/worktree/init-status` probe for a row.
 *
 * The row's `FolderInitScope` calls this once and feeds the result to BOTH the
 * tier-0 `FolderActionBanner` (setup / init / re-trust / failure rungs) and the
 * folder actions menu's Project setup tally, avoiding a double probe per row.
 * Fail-open: `fetchWorktreeInitStatus` returns `hasHook:false` on error.
 *
 * Re-probes (all gated on `isProjectRoot` AND the last interpretable probe
 * being "not-a-project", so configured / non-project rows pay nothing):
 *   - a session in the row enters `idle`/`ended`, first appears already
 *     idle/ended, or vanishes without `ended` having been observed — a setup
 *     turn finished, however it was launched. Entering `streaming`/`active`
 *     never fires (a turn start cannot observe a completed write);
 *   - `visibilitychange` → visible, throttled to once per 30 s (safety net for
 *     out-of-band changes such as a terminal or editor).
 * `refetch` re-issues the probe on demand (after a hook run flips the gate).
 * Overlapping probes are latest-wins; a response after unmount is dropped.
 *
 * See change: distinguish-initialize-actions, add-folder-action-banner,
 * fix-project-setup-completion-state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWorktreeInitStatus, type WorktreeInitStatus } from "../lib/git/git-api.js";
import { type SetupState, setupState } from "../lib/init-setup-state.js";
import { logRejection } from "../lib/report-error.js";

/** Minimum gap between visibility-triggered re-probes (measured from issue). */
const VISIBILITY_THROTTLE_MS = 30_000;

interface InitStatusOpts {
  /** The row's sessions; only `id` + `status` are read. */
  sessions?: ReadonlyArray<{ id: string; status: string }>;
  /** Client-side project-root gate; false/absent keeps re-probes off. */
  isProjectRoot?: boolean;
}

export function useInitStatus(
  cwd: string,
  opts?: InitStatusOpts,
): { status: WorktreeInitStatus | null; refetch: () => void } {
  const [status, setStatus] = useState<WorktreeInitStatus | null>(null);
  const sessions = opts?.sessions;
  const isProjectRoot = opts?.isProjectRoot === true;

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const lastProbeAtRef = useRef(0);
  /** `setupState` of the most recent applied probe that was interpretable. */
  const lastInterpretableRef = useRef<SetupState | null>(null);
  const isProjectRootRef = useRef(isProjectRoot);
  const seenRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Keep the latest gate input readable from listeners. Written in an effect (not
  // during render, which React may replay or discard); declared before the
  // trigger effects so it is current when they run in the same commit.
  useEffect(() => {
    isProjectRootRef.current = isProjectRoot;
  }, [isProjectRoot]);

  const probe = useCallback(() => {
    const id = ++requestIdRef.current;
    lastProbeAtRef.current = Date.now();
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchWorktreeInitStatus(cwd)
      .then((s) => {
        if (!mountedRef.current || id !== requestIdRef.current) return; // latest wins
        const state = setupState(s);
        // A failed probe (fail-open → "unknown") must not close the gate.
        if (state !== "unknown") lastInterpretableRef.current = state;
        setStatus(s);
      })
      .catch(logRejection("useInitStatus.fetch"));
  }, [cwd]);

  const gateOpen = useCallback(
    () => isProjectRootRef.current && lastInterpretableRef.current === "not-a-project",
    [],
  );

  // Mount / cwd change: reset per-cwd state and issue the first probe.
  useEffect(() => {
    lastInterpretableRef.current = null;
    seededRef.current = false;
    probe();
    // A late response for the previous cwd is discarded by the request id.
  }, [probe]);

  // Throttled visibility re-probe.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!gateOpen()) return;
      if (Date.now() - lastProbeAtRef.current < VISIBILITY_THROTTLE_MS) return;
      probe();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [probe, gateOpen]);

  // Stable signature: unrelated re-renders (new array, same id:status) are no-ops.
  const signature = useMemo(
    () => (sessions ?? []).map((s) => `${s.id}:${s.status}`).sort().join("|"),
    [sessions],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` encodes `sessions`; re-running on array identity would defeat the no-op guarantee
  useEffect(() => {
    const next = new Map((sessions ?? []).map((s) => [s.id, s.status] as const));
    if (!seededRef.current) {
      // The first snapshot only seeds — the mount probe already covers it.
      seededRef.current = true;
      seenRef.current = next;
      return;
    }
    let fire = false;
    for (const [id, st] of next) {
      if ((st === "idle" || st === "ended") && seenRef.current.get(id) !== st) fire = true;
    }
    for (const [id, prev] of seenRef.current) {
      if (!next.has(id) && prev !== "ended") fire = true;
    }
    seenRef.current = next;
    if (fire && gateOpen()) probe();
  }, [signature, probe, gateOpen]);

  return { status, refetch: probe };
}
