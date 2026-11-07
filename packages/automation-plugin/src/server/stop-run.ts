/**
 * The ONE Stop pipeline behind both entry points (REST `/stop` and the
 * `plugin_action` `stop`). The caller has already admitted the request cwd and
 * resolved `scopeBase` (folder = admitted cwd, global = home dir).
 *
 *  - Tracked run → the run's own scope must equal the admitted one, then the
 *    engine's live Stop (`engine.stopRun`).
 *  - Untracked → read `run.json`; finished → reject; running but started by
 *    this process → reject (the stale-run reaper owns it); orphaned → the
 *    orphan path below.
 *  - Orphan leaf (flat or child): kill ONLY a session that is connected, carries
 *    the dashboard's `automationRun` stamp for this run id AND scope, and whose
 *    real cwd is the admitted scope base. A `sessionId` in `run.json` alone is
 *    never trusted (workspace content can forge it). Then finalize `stopped`
 *    by compare-and-set without pruning.
 *  - Orphan parent: every running child through the same path, then the parent.
 *  - In-flight dedupe keyed `realpath(scopeBase)\0runId`: concurrent Stops of
 *    one run share one attempt (at most one kill per run).
 *
 * See change: polish-automation-board (design D2, D3, D6).
 */
import fs from "node:fs";
import path from "node:path";
import type { AutomationScope, RunRecord, RunStatus, StopOutcome } from "../shared/automation-types.js";
import type { Engine } from "./engine.js";
import {
  finishParentRunIfRunning,
  finishRunIfRunning,
  readChildRuns,
  readRun,
} from "./run-store.js";
import { combineOutcomes, reasonFor } from "./stop-outcome.js";

export interface StopRequest {
  scope: AutomationScope;
  /** Admitted scope base: the folder cwd, or the home dir for global scope. */
  scopeBase: string;
  runId: string;
}

export interface StopResult {
  ok: boolean;
  outcome?: StopOutcome;
  /** Another writer (a concurrent Stop, the reaper) finalized the record first. */
  alreadyFinalized?: boolean;
  error?: string;
}

type AbortFn = (args: {
  sessionId?: string;
  spawnToken?: string;
  onResult?: (r: { outcome: string; pid?: number }) => void;
}) => Promise<boolean>;

export interface StopPipelineDeps {
  engine: Pick<Engine, "isTracked" | "trackedScopeBase" | "stopRun" | "isOrphaned">;
  getSession: (id: string) => unknown;
  isConnected: (id: string) => boolean;
  abortSpawnedRun?: AbortFn;
  warn?: (msg: string) => void;
}

export const ORPHAN_STOP_RESULT = "_(stopped by user after the server lost track of this run)_";

const REAPER_REJECT =
  "run is not tracked by this server but was started by it; the stale-run reaper will finalize it";

/** Real path of a dir, falling back to the resolved path (key / scope compare only). */
function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function aggregateStatus(statuses: RunStatus[]): RunStatus {
  if (statuses.some((s) => s === "error")) return "error";
  if (statuses.length > 0 && statuses.every((s) => s === "stopped")) return "stopped";
  return "done";
}

export function createStopPipeline(deps: StopPipelineDeps): (req: StopRequest) => Promise<StopResult> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const inFlight = new Map<string, Promise<StopResult>>();

  /** Share one in-flight attempt per (scope, run). Inserted synchronously. */
  function dedupe(key: string, run: () => Promise<StopResult>): Promise<StopResult> {
    const hit = inFlight.get(key);
    if (hit) return hit;
    const p = run().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  /** D2: only a connected, stamped, in-scope session may be signalled. */
  function targetSession(req: StopRequest, rec: RunRecord): string | null {
    const sid = rec.sessionId;
    if (!sid) return null;
    if (!deps.isConnected(sid)) return null;
    const s = deps.getSession(sid) as
      | { cwd?: string; automationRun?: { runId?: string; scope?: string } }
      | undefined;
    const stamp = s?.automationRun;
    if (!stamp || stamp.runId !== req.runId || stamp.scope !== req.scope) return null;
    if (typeof s?.cwd !== "string") return null;
    try {
      if (fs.realpathSync(s.cwd) !== fs.realpathSync(req.scopeBase)) return null;
    } catch {
      return null; // fail closed
    }
    return sid;
  }

  async function killOrphan(req: StopRequest, rec: RunRecord): Promise<StopOutcome> {
    if (!rec.sessionId) return "not-found";
    const sid = targetSession(req, rec);
    if (!sid || !deps.abortSpawnedRun) return "unconfirmed";
    let outcome: StopOutcome = "unconfirmed";
    try {
      await deps.abortSpawnedRun({
        sessionId: sid,
        onResult: (r) => {
          outcome = r.outcome === "confirmed-dead" ? "killed" : "unconfirmed";
        },
      });
    } catch (e) {
      warn(`[automation] orphan abort failed for ${req.runId}: ${e instanceof Error ? e.message : String(e)}`);
      return "unconfirmed";
    }
    return outcome;
  }

  /** Finalize an orphan parent once none of its children is still running. */
  function finalizeParentIfDone(scopeBase: string, parentRunId: string): boolean {
    const parent = readRun(scopeBase, parentRunId);
    if (!parent || parent.status !== "running") return false;
    const kids = readChildRuns(scopeBase, parent);
    if (kids.some((k) => k.status === "running")) return false;
    return finishParentRunIfRunning(
      scopeBase,
      parentRunId,
      {
        status: aggregateStatus(kids.map((k) => k.status)),
        findings: kids.reduce((n, k) => n + (k.findings ?? 0), 0),
      },
      { prune: false },
    );
  }

  /** Orphan leaf (flat or child). `cascade` = called from the parent path. */
  async function stopOrphanLeaf(req: StopRequest, rec: RunRecord, cascade: boolean): Promise<StopResult> {
    const outcome = await killOrphan(req, rec);
    const won = finishRunIfRunning(
      req.scopeBase,
      req.runId,
      { status: "stopped", error: reasonFor(outcome), result: ORPHAN_STOP_RESULT },
      { prune: false },
    );
    if (!cascade && rec.parentRunId) finalizeParentIfDone(req.scopeBase, rec.parentRunId);
    return { ok: true, outcome, ...(won ? {} : { alreadyFinalized: true }) };
  }

  /** One child of an orphan parent: live Stop when tracked, else the orphan path (deduped). */
  function stopChild(req: StopRequest, child: RunRecord): Promise<StopResult> {
    const childReq = { ...req, runId: child.runId };
    if (deps.engine.isTracked(child.runId)) {
      // Same scope rule as a top-level tracked Stop: never live-stop another scope's run.
      const childBase = deps.engine.trackedScopeBase(child.runId);
      if (!childBase || realOrResolved(childBase) !== realOrResolved(req.scopeBase)) {
        return Promise.resolve({ ok: true, outcome: "unconfirmed" as const });
      }
      return deps.engine
        .stopRun(child.runId)
        .then((o) => (o ? { ok: true, outcome: o } : { ok: true, outcome: "not-found" as const }));
    }
    return dedupe(`${realOrResolved(req.scopeBase)}\0${child.runId}`, () => stopOrphanLeaf(childReq, child, true));
  }

  async function stopOrphanParent(req: StopRequest, parent: RunRecord): Promise<StopResult> {
    const running = readChildRuns(req.scopeBase, parent).filter((k) => k.status === "running");
    // Promise.all inserts every child's dedupe entry synchronously, so a
    // concurrent Stop of one child joins this attempt instead of racing it.
    const results = await Promise.all(running.map((k) => stopChild(req, k)));
    const outcome = combineOutcomes(results.map((r) => r.outcome ?? "unconfirmed"));
    const won = finalizeParentIfDone(req.scopeBase, req.runId);
    return { ok: true, outcome, ...(won ? {} : { alreadyFinalized: true }) };
  }

  return async function stopRun(req: StopRequest): Promise<StopResult> {
    const { engine } = deps;
    // 1. Tracked: live Stop, but only inside the admitted scope.
    if (engine.isTracked(req.runId)) {
      const base = engine.trackedScopeBase(req.runId);
      if (!base || realOrResolved(base) !== realOrResolved(req.scopeBase)) {
        return { ok: false, error: `run "${req.runId}" does not belong to this scope` };
      }
      const outcome = await engine.stopRun(req.runId);
      return outcome
        ? { ok: true, outcome }
        : { ok: false, error: `run "${req.runId}" not running or already finished` };
    }
    // 2. Untracked: the on-disk record decides.
    const rec = readRun(req.scopeBase, req.runId);
    if (!rec) return { ok: false, error: `run "${req.runId}" not found` };
    if (rec.status !== "running") {
      return { ok: false, error: `run "${req.runId}" not running or already finished` };
    }
    if (!engine.isOrphaned(rec)) return { ok: false, error: REAPER_REJECT };
    // 3. Orphan: dedupe per (scope, run), then parent cascade or leaf.
    const key = `${realOrResolved(req.scopeBase)}\0${req.runId}`;
    return dedupe(key, () => (rec.children ? stopOrphanParent(req, rec) : stopOrphanLeaf(req, rec, false)));
  };
}
