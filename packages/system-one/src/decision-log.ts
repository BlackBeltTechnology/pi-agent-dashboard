/**
 * Decision log (spec: system-one-adapter, "Decision log without state text";
 * design D9). One JSONL file per process per UTC day:
 * `~/.pi/agent/system-one/decisions/<YYYY-MM-DD>.<pid>.jsonl` (0600). Lines
 * carry distributions, attempts, model, mode and a SHA-256 of the state —
 * never state, instructions or keys. Failures are swallowed. Files older than
 * 30 days are removed on library load. See change: add-system-one-registry.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { decisionsDir } from "./paths.js";
import type { Answers, Attempt, Mode } from "./types.js";

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
const NAME_DAY = /^(\d{4}-\d{2}-\d{2})\./;

export interface DecisionLine {
  consumerId: string;
  attempts: Attempt[];
  model: string | null;
  mode: Mode | null;
  answers: Answers | null;
  reason?: string;
}

let madeDir = "";

export function logDecision(line: DecisionLine, state: string): void {
  try {
    const dir = decisionsDir();
    if (madeDir !== dir) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      madeDir = dir;
    }
    const day = new Date().toISOString().slice(0, 10);
    const stateSha256 = createHash("sha256").update(state).digest("hex");
    const record = { ts: new Date().toISOString(), ...line, stateSha256 };
    appendFileSync(join(dir, `${day}.${process.pid}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    // never fail predict on a log write
  }
}

/** Whole UTC days between the file's day (from its name, else its mtime) and `now`. */
function ageDays(name: string, path: string, now: number): number {
  const m = NAME_DAY.exec(name);
  const fileDay = m ? Date.parse(`${m[1]}T00:00:00Z`) : Math.floor(statSync(path).mtimeMs / DAY_MS) * DAY_MS;
  return Math.floor((Math.floor(now / DAY_MS) * DAY_MS - fileDay) / DAY_MS);
}

export function pruneDecisionLogs(now = Date.now()): void {
  try {
    const dir = decisionsDir();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const p = join(dir, name);
      try {
        if (ageDays(name, p, now) > RETENTION_DAYS) rmSync(p, { force: true });
      } catch {
        // raced with another process
      }
    }
  } catch {
    // no dir yet
  }
}

pruneDecisionLogs();
