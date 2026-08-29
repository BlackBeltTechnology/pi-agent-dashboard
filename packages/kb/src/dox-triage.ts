// Stale-row triage: judge a DOX row against the REAL git diff since it was
// last acknowledged, instead of guessing.
//
// `kb dox lint` marks a row "stale" when the sha256 of its file differs from the
// acknowledged hash. That only means BYTES CHANGED — it is not evidence the row
// text is wrong. The two obvious responses are both bad: bulk re-acking launders
// genuine drift, and a symbol-presence heuristic produces false positives (it
// will flag a row that correctly documents a symbol as *removed*).
//
// This module recovers real evidence. The acknowledged hash identifies a past
// state of the file, so walking the file's history for the commit whose blob
// hashes to that value pinpoints what a human last signed off on. `git diff`
// from there is exactly what the row has never been reconciled against — small
// enough to hand to a cheap model, specific enough to judge.
import { execFileSync } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns the git history walk, no pi-dashboard-shared dep)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type AckRecord, type StalenessFile, STALENESS_VERSION, readStaleness, stalenessVersionOnDisk } from "./staleness.js";
import { type DoxIssue, resolveRowPath } from "./dox.js";

export const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/;
/** History window scanned for a blob matching the acked hash. */
export const DEFAULT_DEPTH = 60;
/** Per-item diff budget. Keeps a @fast subagent's context small and cheap. */
export const DIFF_CAP = 6000;

export interface DoxRow {
  line: number;
  path: string;
  purpose: string;
}

export function parseRows(md: string): DoxRow[] {
  const rows: DoxRow[] = [];
  md.split("\n").forEach((line, i) => {
    const m = line.match(ROW_RE);
    if (!m) return;
    if (/^-+$/.test(m[1])) return;
    rows.push({ line: i, path: m[1], purpose: m[2] });
  });
  return rows;
}

/** Replace one row's purpose cell. Byte-identical elsewhere; no-op if absent. */
export function replaceRowPurpose(md: string, rowPath: string, newPurpose: string): string {
  let hit = false;
  const out = md.split("\n").map((line) => {
    if (hit) return line;
    const m = line.match(ROW_RE);
    if (!m || m[1] !== rowPath) return line;
    hit = true;
    return `| \`${m[1]}\` | ${newPurpose} |`;
  });
  return hit ? out.join("\n") : md;
}

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export interface Baseline {
  found: boolean;
  commit: string | null;
  diff: string;
  reason: string | null;
}

export function resolveBaseline(opts: {
  cwd: string;
  file: string;
  ackedSha: string;
  depth?: number;
}): Baseline {
  const { cwd, file, ackedSha, depth = DEFAULT_DEPTH } = opts;
  let commits: string[] = [];
  try {
    commits = git(cwd, ["rev-list", `-n${depth}`, "HEAD", "--", file]).trim().split("\n").filter(Boolean);
  } catch {
    return { found: false, commit: null, diff: "", reason: "no-history" };
  }
  if (!commits.length) return { found: false, commit: null, diff: "", reason: "untracked" };

  for (const c of commits) {
    let blob: Buffer;
    try {
      blob = execFileSync("git", ["show", `${c}:${file}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      continue;
    }
    if (sha256(blob) !== ackedSha) continue;
    let diff = "";
    try {
      // `<commit> --` (NOT `<commit>..HEAD`): staleness is hashed from the WORKING
      // TREE, so the diff must span uncommitted edits too. Using ..HEAD reports an
      // empty diff for a row made stale purely by unstaged work, which would then
      // be judged "unchanged" on no evidence at all.
      diff = git(cwd, ["diff", c, "--", file]);
    } catch {
      diff = "";
    }
    return {
      found: true,
      commit: c,
      diff: diff.length > DIFF_CAP ? `${diff.slice(0, DIFF_CAP)}\n…[diff truncated]` : diff,
      reason: null,
    };
  }
  // Acked state predates the window, or was acked from an uncommitted tree.
  // Say so rather than diffing against an arbitrary commit.
  return { found: false, commit: null, diff: "", reason: `no-match-in-last-${depth}` };
}

export interface WorkItem {
  agentsFile: string;
  row: string;
  target: string;
  purpose: string;
  baseline: string | null;
  baselineFound: boolean;
  reason: string | null;
  diff: string;
}

export function buildWorkItems(opts: {
  cwd: string;
  issues: DoxIssue[];
  staleness: Record<string, AckRecord>;
  depth?: number;
  limit?: number;
}): WorkItem[] {
  const { cwd, issues, staleness, depth = DEFAULT_DEPTH, limit = Number.POSITIVE_INFINITY } = opts;
  const items: WorkItem[] = [];
  for (const iss of issues) {
    if (iss.kind !== "stale" || !iss.path) continue;
    if (items.length >= limit) break;
    const agentsAbs = join(cwd, iss.agentsFile);
    if (!existsSync(agentsAbs)) continue;
    // Reuse the lint's own resolver so triage and lint never disagree about
    // which file a row points at (incl. the repo-root fallback for config rows).
    const abs = resolveRowPath(dirname(agentsAbs), cwd, iss.path);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const target = relative(cwd, abs);
    const row = parseRows(readFileSync(agentsAbs, "utf8")).find((r) => r.path === iss.path);
    if (!row) continue;
    const acked = staleness[target] ?? staleness[iss.path];
    const base = acked?.sha256
      ? resolveBaseline({ cwd, file: target, ackedSha: acked.sha256, depth })
      : { found: false, commit: null, diff: "", reason: "not-acked" };
    items.push({
      agentsFile: iss.agentsFile,
      row: iss.path,
      target,
      purpose: row.purpose,
      baseline: base.commit,
      baselineFound: base.found,
      reason: base.reason,
      diff: base.diff,
    });
  }
  return items;
}

export interface Decision {
  agentsFile: string;
  row: string;
  verdict: "KEEP" | "REWRITE";
  purpose?: string;
  note?: string;
}

export interface ApplyResult {
  rewritten: number;
  kept: number;
  skipped: string[];
}

export function applyDecisions(opts: {
  cwd: string;
  decisions: Decision[];
  write?: boolean;
}): ApplyResult {
  const { cwd, decisions, write = false } = opts;
  const res: ApplyResult = { rewritten: 0, kept: 0, skipped: [] };
  for (const d of decisions) {
    if (d.verdict !== "REWRITE" || !d.purpose) {
      res.kept++;
      continue;
    }
    const p = join(cwd, d.agentsFile);
    if (!existsSync(p)) {
      res.skipped.push(`${d.agentsFile} (missing)`);
      continue;
    }
    const before = readFileSync(p, "utf8");
    const after = replaceRowPurpose(before, d.row, d.purpose);
    if (after === before) {
      res.skipped.push(`${d.agentsFile} :: ${d.row} (row not found)`);
      continue;
    }
    if (write) writeFileSync(p, after, "utf8");
    res.rewritten++;
  }
  return res;
}


/** Re-acknowledge rows: record each target's sha256 + stat baseline (v2). */
export function ackTargets(opts: { cwd: string; targets: string[]; stalenessFile: string }): number {
  const { cwd, targets, stalenessFile } = opts;
  // Fail closed: a sidecar from a NEWER version carries records this code
  // cannot see — rewriting it as v2 would silently delete them.
  const onDisk = stalenessVersionOnDisk(stalenessFile);
  if (onDisk != null && onDisk > STALENESS_VERSION) {
    throw new Error(`dox-staleness.json is version ${onDisk} (> supported ${STALENESS_VERSION}); refusing to overwrite — upgrade the kb package first`);
  }
  const map = readStaleness(stalenessFile);
  let n = 0;
  for (const t of targets) {
    const p = join(cwd, t);
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    const st = statSync(p);
    map[t] = { sha256: sha256(readFileSync(p)), size: st.size, mtimeMs: st.mtimeMs };
    n++;
  }
  const file: StalenessFile = { version: STALENESS_VERSION, files: map };
  writeFileSync(stalenessFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return n;
}
