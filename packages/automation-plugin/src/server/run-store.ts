/**
 * Run/triage store: persists run results under
 * `<scope>/.pi/automation/runs/<runId>/result.md`, auto-archives empty
 * runs, and prunes to keep the last N runs per automation (oldest-first).
 *
 * A run record is a directory `runs/<date>-<name>/` containing:
 *   - result.md   — findings (the run's output capture)
 *   - run.json    — { runId, name, status, startedAt, endedAt, archived, sessionId, error }
 *
 * See change: add-automation-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import type { RunRecord, RunStatus } from "../shared/automation-types.js";

export const DEFAULT_RETENTION = 100;

/**
 * Findings count heuristic: number of top-level markdown bullet lines in
 * `result.md` (lines starting with `- ` or `* ` at column 0). `0` when the
 * text is empty. See change: automation-ui-mockup-parity.
 */
export function countFindings(result: string): number {
  let n = 0;
  for (const line of result.split("\n")) {
    if (/^[-*] +\S/.test(line)) n++;
  }
  return n;
}

export function runsRootFor(scopeBase: string): string {
  return path.join(scopeBase, ".pi", "automation", "runs");
}

// Process-lifetime monotonic counter guaranteeing run-id uniqueness even for
// runs fired in the same millisecond (concurrency: parallel).
let _runSeq = 0;

/**
 * Unique store key for one run occurrence at `at`:
 * `YYYY-MM-DD-HHMMSS-<name>-<seq>`. The date prefix keeps the run dir sortable
 * + human-readable; the time + seq suffix guarantees uniqueness across
 * multiple runs of the same automation on the same day (e.g. a 1-minute cron)
 * and across concurrent parallel runs. See change: add-automation-plugin.
 */
export function makeRunId(name: string, at: Date = new Date()): string {
  const iso = at.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, ""); // HHMMSS
  const seq = (_runSeq = (_runSeq + 1) % 100000).toString().padStart(5, "0");
  return `${date}-${time}-${name}-${seq}`;
}

function runDir(scopeBase: string, runId: string): string {
  return path.join(runsRootFor(scopeBase), runId);
}

function readRecord(dir: string): RunRecord | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "run.json"), "utf-8");
    return JSON.parse(raw) as RunRecord;
  } catch {
    return null;
  }
}

/**
 * Resolve the on-disk directory holding `runId`'s `run.json`, whether it is a
 * top-level record (parent or legacy flat) or a nested child under its parent.
 * Returns `null` when no such record exists.
 *
 * The fan-out layout is exactly two deep by construction, so a child is found
 * one level down (`runs/<parentRunId>/<runId>/run.json`). This is the single
 * primitive every store consumer routes through so a child run id is
 * addressable without the caller supplying the parent id.
 * See change: add-automation-concurrent-spawn.
 */
export function resolveRunDir(scopeBase: string, runId: string): string | null {
  const top = runDir(scopeBase, runId);
  if (fs.existsSync(path.join(top, "run.json"))) return top;
  const root = runsRootFor(scopeBase);
  let parents: string[];
  try {
    parents = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const p of parents) {
    const childDir = path.join(root, p, runId);
    if (fs.existsSync(path.join(childDir, "run.json"))) return childDir;
  }
  return null;
}

/** Write a record into an explicit directory (atomic rename). */
function writeRecordAt(dir: string, rec: RunRecord): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "run.json.tmp");
  fs.writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  fs.renameSync(tmp, path.join(dir, "run.json"));
}

function writeRecord(scopeBase: string, rec: RunRecord): void {
  writeRecordAt(runDir(scopeBase, rec.runId), rec);
}

/** Create a `running` (legacy flat) run record. Returns the record. Retained
 *  for the reaper's pre-existing-orphan simulation + back-compat tests; new
 *  fires use `startParentRun`/`startChildRun`. */
export function startRun(
  scopeBase: string,
  name: string,
  opts: { runId?: string; sessionId?: string; at?: Date } = {},
): RunRecord {
  const runId = opts.runId ?? makeRunId(name, opts.at);
  const rec: RunRecord = {
    runId,
    name,
    status: "running",
    dir: runDir(scopeBase, runId),
    startedAt: (opts.at ?? new Date()).getTime(),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  };
  writeRecord(scopeBase, rec);
  return rec;
}

/**
 * Create a `running` PARENT occurrence record at `runs/<parentRunId>/run.json`
 * with an empty `children` array. The parent owns no session + no `result.md`;
 * its `findings` are summed across children at finalization.
 * See change: add-automation-concurrent-spawn.
 */
export function startParentRun(
  scopeBase: string,
  name: string,
  opts: { runId?: string; at?: Date; warning?: string } = {},
): RunRecord {
  const runId = opts.runId ?? makeRunId(name, opts.at);
  const rec: RunRecord = {
    runId,
    name,
    status: "running",
    dir: runDir(scopeBase, runId),
    startedAt: (opts.at ?? new Date()).getTime(),
    children: [],
    ...(opts.warning ? { warning: opts.warning } : {}),
  };
  writeRecord(scopeBase, rec);
  return rec;
}

/**
 * Create a `running` CHILD record at `runs/<parentRunId>/<childRunId>/run.json`
 * and append the child id to the parent's `children` array.
 * See change: add-automation-concurrent-spawn.
 */
export function startChildRun(
  scopeBase: string,
  parentRunId: string,
  name: string,
  opts: { runId?: string; sessionId?: string; actionLabel?: string; at?: Date } = {},
): RunRecord {
  const childRunId = opts.runId ?? makeRunId(name, opts.at);
  const childDir = path.join(runDir(scopeBase, parentRunId), childRunId);
  const rec: RunRecord = {
    runId: childRunId,
    name,
    status: "running",
    dir: childDir,
    startedAt: (opts.at ?? new Date()).getTime(),
    parentRunId,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.actionLabel ? { actionLabel: opts.actionLabel } : {}),
  };
  writeRecordAt(childDir, rec);
  // Append to the parent's children list.
  const parentDir = runDir(scopeBase, parentRunId);
  const parent = readRecord(parentDir);
  if (parent) {
    const children = parent.children ?? [];
    if (!children.includes(childRunId)) children.push(childRunId);
    writeRecordAt(parentDir, { ...parent, children });
  }
  return rec;
}

/** Persist a child's (or flat run's) `sessionId` on its on-disk record. */
export function setSessionId(scopeBase: string, runId: string, sessionId: string): void {
  const dir = resolveRunDir(scopeBase, runId);
  if (!dir) return;
  const rec = readRecord(dir);
  if (!rec) return;
  writeRecordAt(dir, { ...rec, sessionId });
}

/**
 * Finish a run: write `result.md`, set terminal status, auto-archive when
 * the findings are empty, then prune to retention.
 */
export function finishRun(
  scopeBase: string,
  runId: string,
  opts: { status: RunStatus; result?: string; error?: string; retention?: number; at?: Date },
): RunRecord | null {
  const dir = resolveRunDir(scopeBase, runId);
  if (!dir) return null;
  const existing = readRecord(dir);
  if (!existing) return null;

  const result = (opts.result ?? "").trim();
  fs.writeFileSync(path.join(dir, "result.md"), result + (result ? "\n" : ""));

  const archived = result.length === 0;
  const findings = archived ? 0 : countFindings(result);
  const rec: RunRecord = {
    ...existing,
    status: opts.status,
    endedAt: (opts.at ?? new Date()).getTime(),
    findings,
    ...(archived ? { archived: true } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  };
  writeRecordAt(dir, rec);

  pruneRuns(scopeBase, existing.name, opts.retention ?? DEFAULT_RETENTION);
  return rec;
}

/**
 * Finalize a PARENT occurrence record directly (no `result.md`, no
 * auto-archive): set terminal status, `endedAt`, summed `findings`, and an
 * optional `warning`, then prune to retention. The parent's findings are a sum
 * over children, not derived from a result file. See change:
 * add-automation-concurrent-spawn.
 */
export function finishParentRun(
  scopeBase: string,
  parentRunId: string,
  opts: { status: RunStatus; findings: number; warning?: string; error?: string; retention?: number; at?: Date },
): RunRecord | null {
  const dir = runDir(scopeBase, parentRunId);
  const existing = readRecord(dir);
  if (!existing) return null;
  const rec: RunRecord = {
    ...existing,
    status: opts.status,
    endedAt: (opts.at ?? new Date()).getTime(),
    findings: opts.findings,
    ...(opts.warning ? { warning: opts.warning } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  };
  writeRecordAt(dir, rec);
  pruneRuns(scopeBase, existing.name, opts.retention ?? DEFAULT_RETENTION);
  return rec;
}

/** Read the child records of a parent (in `children` order; missing skipped). */
export function readChildRuns(scopeBase: string, parent: RunRecord): RunRecord[] {
  const out: RunRecord[] = [];
  for (const childId of parent.children ?? []) {
    const childDir = path.join(runDir(scopeBase, parent.runId), childId);
    const rec = readRecord(childDir);
    if (rec) out.push(rec);
  }
  return out;
}

/** List run records for one automation, oldest-first by startedAt. */
export function listRuns(scopeBase: string, name?: string): RunRecord[] {
  const root = runsRootFor(scopeBase);
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  const recs: RunRecord[] = [];
  for (const d of dirs) {
    const rec = readRecord(path.join(root, d));
    if (!rec) continue; // not a run dir (e.g. a stray file)
    if (name && rec.name !== name) continue;
    recs.push(rec);
  }
  recs.sort((a, b) => a.startedAt - b.startedAt);
  return recs;
}

/**
 * List `running` run records across a scope whose age (`now - startedAt`)
 * exceeds `maxAgeMs`. Backstop input for the stale-run reaper. See change:
 * finalize-automation-run-on-session-death.
 */
export function listStaleRunningRuns(
  scopeBase: string,
  maxAgeMs: number,
  now: number = Date.now(),
): RunRecord[] {
  const stale: RunRecord[] = [];
  for (const rec of listRuns(scopeBase)) {
    if (rec.children) {
      // Parent occurrence: never reaped directly — it finalizes via the child
      // counter. Enumerate its children so a stale child is swept.
      for (const child of readChildRuns(scopeBase, rec)) {
        if (child.status === "running" && now - child.startedAt > maxAgeMs) stale.push(child);
      }
      continue;
    }
    // Legacy flat record.
    if (rec.status === "running" && now - rec.startedAt > maxAgeMs) stale.push(rec);
  }
  return stale;
}

/**
 * Prune the run store for one automation to keep at most `retention` runs,
 * deleting the oldest-first overflow. Returns the count pruned.
 */
export function pruneRuns(scopeBase: string, name: string, retention = DEFAULT_RETENTION): number {
  // Prunable = terminal top-level records only. A still-`running` occurrence is
  // live (its children may be mid-flight); deleting it would resurrect a
  // half-written dir on the next child write. See change:
  // add-automation-concurrent-spawn.
  const prunable = listRuns(scopeBase, name).filter((r) => r.status !== "running"); // oldest-first
  const overflow = prunable.length - retention;
  if (overflow <= 0) return 0;
  let pruned = 0;
  for (let i = 0; i < overflow; i++) {
    const rec = prunable[i]!;
    try {
      fs.rmSync(rec.dir, { recursive: true, force: true });
      pruned++;
    } catch {
      /* best-effort */
    }
  }
  return pruned;
}
