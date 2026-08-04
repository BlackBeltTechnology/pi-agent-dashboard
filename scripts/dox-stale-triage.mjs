#!/usr/bin/env node
// Triage `kb dox lint` STALE rows using the real git diff since the row was last
// acknowledged — not a symbol-presence guess.
//
// Why: the staleness map records a sha256 of file CONTENT, so "stale" only means
// "bytes changed since someone last acked this row". That is not evidence the row
// text is wrong. This script recovers the commit whose blob matches the acked
// hash, emits the diff since that point, and hands each (row, diff) pair to a
// cheap @fast subagent that decides KEEP or REWRITE. Bulk re-acking without
// reading a diff silently launders real drift; a symbol heuristic produces false
// positives (see fix-stale-kb-dox-rows skill Pitfalls).
//
// Usage:
//   node scripts/dox-stale-triage.mjs --json            # emit work items for subagents
//   node scripts/dox-stale-triage.mjs --json --limit 20
//   node scripts/dox-stale-triage.mjs --apply <decisions.json> [--write]
//   node scripts/dox-stale-triage.mjs --ack <paths.json>   # re-ack KEEP decisions
//
// decisions.json: [{ "agentsFile": "...", "target": "...", "verdict": "KEEP"|"REWRITE",
//                    "purpose": "<new row text, REWRITE only>" }]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

export const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/;
const DEFAULT_DEPTH = 60;
/** Diff budget per work item. Keeps a @fast subagent's context small and cheap. */
const DIFF_CAP = 6000;

export function parseRows(md) {
  const rows = [];
  for (const [i, line] of md.split("\n").entries()) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    if (/^-+$/.test(m[1])) continue;
    rows.push({ line: i, path: m[1], purpose: m[2] });
  }
  return rows;
}

/** Replace one row's purpose cell. Byte-identical elsewhere; no-op if absent. */
export function replaceRowPurpose(md, rowPath, newPurpose) {
  const lines = md.split("\n");
  let hit = false;
  const out = lines.map((line) => {
    if (hit) return line;
    const m = line.match(ROW_RE);
    if (!m || m[1] !== rowPath) return line;
    hit = true;
    return `| \`${m[1]}\` | ${newPurpose} |`;
  });
  return hit ? out.join("\n") : md;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

/**
 * Walk the file's history newest→oldest looking for the commit whose blob hashes
 * to `ackedSha`. That commit is the state a human last signed off on, so the diff
 * from there to HEAD is exactly what the row has not been reconciled against.
 */
export function resolveBaseline({ cwd, file, ackedSha, depth = DEFAULT_DEPTH }) {
  let commits = [];
  try {
    commits = git(cwd, ["rev-list", `-n${depth}`, "HEAD", "--", file]).trim().split("\n").filter(Boolean);
  } catch {
    return { found: false, commit: null, diff: "", reason: "no-history" };
  }
  if (!commits.length) return { found: false, commit: null, diff: "", reason: "untracked" };

  for (const c of commits) {
    let blob;
    try {
      blob = execFileSync("git", ["show", `${c}:${file}`], { cwd, maxBuffer: 1024 * 1024 * 64 });
    } catch {
      continue;
    }
    if (sha256(blob) !== ackedSha) continue;
    let diff = "";
    try {
      // `<commit> --` (NOT `<commit>..HEAD`): the staleness hash is taken from the
      // WORKING TREE, so the diff must span uncommitted edits too. Using ..HEAD
      // reports an empty diff for a row made stale purely by unstaged work, which
      // would then be judged KEEP on no evidence.
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
  // Acked state predates the scanned window, or was acked from an uncommitted
  // working tree. Either way there is no trustworthy baseline — say so rather
  // than diffing against an arbitrary commit.
  return { found: false, commit: null, diff: "", reason: `no-match-in-last-${depth}` };
}

function resolveTarget(cwd, agentsFile, rowPath) {
  const dir = dirname(agentsFile);
  const local = dir === "." ? rowPath : join(dir, rowPath);
  if (existsSync(join(cwd, local)) && statSync(join(cwd, local)).isFile()) return local;
  if (existsSync(join(cwd, rowPath)) && statSync(join(cwd, rowPath)).isFile()) return rowPath;
  return null;
}

export function buildWorkItems({ cwd, issues, staleness, depth = DEFAULT_DEPTH, limit = Infinity }) {
  const items = [];
  for (const iss of issues) {
    if (iss.kind !== "stale") continue;
    if (items.length >= limit) break;
    const rowPath = iss.path;
    const target = resolveTarget(cwd, iss.agentsFile, rowPath);
    if (!target) continue;
    const md = readFileSync(join(cwd, iss.agentsFile), "utf8");
    const row = parseRows(md).find((r) => r.path === rowPath);
    if (!row) continue;
    const acked = staleness[target] ?? staleness[rowPath];
    const base = acked ? resolveBaseline({ cwd, file: target, ackedSha: acked, depth }) : { found: false, diff: "", reason: "not-acked" };
    items.push({
      agentsFile: iss.agentsFile,
      row: rowPath,
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

// ── CLI ───────────────────────────────────────────────────────────────────────
function lintIssues(cwd) {
  try {
    const out = execFileSync("npx", ["kb", "dox", "lint", "--json"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 256,
      env: { ...process.env, NODE_OPTIONS: "--experimental-sqlite" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out).issues ?? [];
  } catch (e) {
    // kb dox lint exits non-zero by design when issues exist.
    const out = e.stdout?.toString() ?? "";
    try {
      return JSON.parse(out).issues ?? [];
    } catch {
      return [];
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const flag = (n) => argv.includes(n);
  const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const stalenessPath = join(cwd, ".pi/dashboard/kb/dox-staleness.json");
  const staleness = existsSync(stalenessPath) ? JSON.parse(readFileSync(stalenessPath, "utf8")) : {};

  if (flag("--apply")) {
    const decisions = JSON.parse(readFileSync(val("--apply"), "utf8"));
    const write = flag("--write");
    let rewritten = 0;
    let kept = 0;
    for (const d of decisions) {
      if (d.verdict !== "REWRITE") {
        kept++;
        continue;
      }
      const p = join(cwd, d.agentsFile);
      const before = readFileSync(p, "utf8");
      const after = replaceRowPurpose(before, d.row ?? d.target, d.purpose);
      if (after === before) {
        console.error(`no-op (row not found): ${d.agentsFile} :: ${d.row ?? d.target}`);
        continue;
      }
      if (write) writeFileSync(p, after);
      rewritten++;
      console.log(`${write ? "rewrote" : "would rewrite"}  ${d.agentsFile} :: ${d.row ?? d.target}`);
    }
    console.log(`\n${write ? "applied" : "dry-run"}: ${rewritten} rewritten, ${kept} kept`);
    if (!write) console.log("re-run with --write to apply");
    return;
  }

  if (flag("--ack")) {
    const targets = JSON.parse(readFileSync(val("--ack"), "utf8"));
    let n = 0;
    for (const t of targets) {
      const p = join(cwd, t);
      if (!existsSync(p) || !statSync(p).isFile()) continue;
      staleness[t] = sha256(readFileSync(p));
      n++;
    }
    writeFileSync(stalenessPath, `${JSON.stringify(staleness, null, 2)}\n`);
    console.log(`re-acked ${n} entries`);
    return;
  }

  const items = buildWorkItems({
    cwd,
    issues: lintIssues(cwd),
    staleness,
    limit: val("--limit") ? Number(val("--limit")) : Infinity,
  });
  if (flag("--json")) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  console.log(`stale rows: ${items.length}`);
  const noBase = items.filter((i) => !i.baselineFound);
  console.log(`  with a recoverable diff : ${items.length - noBase.length}`);
  console.log(`  no baseline (needs eyes): ${noBase.length}`);
  for (const i of items.slice(0, 20)) {
    console.log(`  ${i.baselineFound ? "diff" : "????"}  ${i.agentsFile} :: ${i.row}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
