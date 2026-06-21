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

export function runsRootFor(scopeBase: string): string {
  return path.join(scopeBase, ".pi", "automation", "runs");
}

/** `2026-06-19-<name>` store key for an occurrence at `at`. */
export function makeRunId(name: string, at: Date = new Date()): string {
  const date = at.toISOString().slice(0, 10); // YYYY-MM-DD
  return `${date}-${name}`;
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

function writeRecord(scopeBase: string, rec: RunRecord): void {
  const dir = runDir(scopeBase, rec.runId);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "run.json.tmp");
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, path.join(dir, "run.json"));
}

/** Create a `running` run record. Returns the record. */
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
 * Finish a run: write `result.md`, set terminal status, auto-archive when
 * the findings are empty, then prune to retention.
 */
export function finishRun(
  scopeBase: string,
  runId: string,
  opts: { status: RunStatus; result?: string; error?: string; retention?: number; at?: Date },
): RunRecord | null {
  const dir = runDir(scopeBase, runId);
  const existing = readRecord(dir);
  if (!existing) return null;

  const result = (opts.result ?? "").trim();
  fs.writeFileSync(path.join(dir, "result.md"), result + (result ? "\n" : ""));

  const archived = result.length === 0;
  const rec: RunRecord = {
    ...existing,
    status: opts.status,
    endedAt: (opts.at ?? new Date()).getTime(),
    ...(archived ? { archived: true } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  };
  writeRecord(scopeBase, rec);

  pruneRuns(scopeBase, existing.name, opts.retention ?? DEFAULT_RETENTION);
  return rec;
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
    if (!rec) continue;
    if (name && rec.name !== name) continue;
    recs.push(rec);
  }
  recs.sort((a, b) => a.startedAt - b.startedAt);
  return recs;
}

/**
 * Prune the run store for one automation to keep at most `retention` runs,
 * deleting the oldest-first overflow. Returns the count pruned.
 */
export function pruneRuns(scopeBase: string, name: string, retention = DEFAULT_RETENTION): number {
  const recs = listRuns(scopeBase, name); // oldest-first
  const overflow = recs.length - retention;
  if (overflow <= 0) return 0;
  let pruned = 0;
  for (let i = 0; i < overflow; i++) {
    const rec = recs[i]!;
    try {
      fs.rmSync(rec.dir, { recursive: true, force: true });
      pruned++;
    } catch {
      /* best-effort */
    }
  }
  return pruned;
}
