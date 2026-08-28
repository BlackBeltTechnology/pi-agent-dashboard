// Query-time trust verdicts (arm A of add-kb-trust-verdicts-and-search-guard).
//
// A DOX row is an assertion about a source file that decays silently. `kb dox
// lint` can detect that offline, but the agent never runs it before acting —
// at retrieval time every hit looks equally authoritative. This module labels
// each search hit with the worst-of verdict over its DOX-row subject set:
// FRESH (exists, hash matches ack) / STALE (exists, hash differs) / MOVED
// (absent, git rename found) / GONE (absent, no rename) / UNVERIFIED (exists,
// no acked hash — the honest first-deployment default).
//
// Design constraints (see the change's design.md):
//   D1  — verdicts LABEL, never reorder. Ordering is byte-identical on/off.
//   D2  — hash is truth; a persisted stat baseline only SKIPS the read.
//   D3  — MOVED resolves via one batched `git diff --name-status -M` per
//         enrichment; non-git / ambiguous / undetectable degrade to GONE.
//   D4  — read-only. Verdicts report; repair stays in `kb dox lint/triage`.
//   D5  — content coverage is a separate opt-in field, capped, binary-skipped.
//   D10 — this stage lives OUTSIDE the store: a pure async post-search
//         enricher. `store.search()` stays sync and untouched.
//   D11 — subjects are a SET (cap 8, row order), aggregated worst-of + counts.
//   D12 — UNVERIFIED is a label, not an error.
//   D13 — hashing is bounded: >1 MiB (1048576, exact boundary) or binary is
//         never hashed; matching stat baseline → stat-only FRESH, else
//         UNVERIFIED.
//
// Adapted from Heimdall's kb_search_verify.py (MIT), minus its path-mining
// heuristic (our chunks carry real paths), its uncalibrated threshold (we have
// golden sets), and its index-mutating handle_stale (D4).
import { execFileSync } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns the batched git rename scan, no pi-dashboard-shared dep)
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { chunkMarkdown } from "./chunker.js";
import { resolveRowPath } from "./dox.js";
import { parseRows } from "./dox-triage.js";
import { type AckRecord, readStaleness } from "./staleness.js";
import type { HitVerdict, KbHit, VerdictCounts, VerdictLabel } from "./types.js";

/** Subjects checked per hit, in DOX row order (design D11). */
export const SUBJECT_CAP = 8;
/** Files above this exact boundary are never hashed (design D13). */
export const HASH_CAP_BYTES = 1048576; // 1 MiB
/** Coverage reads are capped separately and skip binaries (design D5). */
export const COVERAGE_CAP_BYTES = 262144; // 256 KB

/** Worst-of order for aggregation: a hit carries its WORST subject's label. */
const WORST: Record<VerdictLabel, number> = { GONE: 0, MOVED: 1, STALE: 2, UNVERIFIED: 3, FRESH: 4 };

/** Injectable fs surface — lets tests count reads, fake stat results, and
 *  inject EACCES without touching the disk. Defaults to node:fs. */
export interface VerdictFs {
  /** `null` = absent. A thrown error = unreadable (labelled UNVERIFIED). */
  stat(p: string): { size: number; mtimeMs: number } | null;
  /** Capped content read (≤ cap bytes). Throws on error (EACCES etc.). */
  read(p: string, cap: number): Buffer;
}

const nodeFs: VerdictFs = {
  stat(p: string): { size: number; mtimeMs: number } | null {
    let s;
    try {
      s = statSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e; // EACCES etc. → unreadable, not absent
    }
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null;
  },
  read(p: string, cap: number): Buffer {
    const fd = openSync(p, "r");
    try {
      const size = Math.min(fstatSync(fd).size, cap);
      const buf = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        const n = readSync(fd, buf, read, size - read, read);
        if (n <= 0) break;
        read += n;
      }
      return buf.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  },
};

export interface EnrichCtx {
  cwd: string;
  /** Master switch. Default ON; false returns hits untouched (D1 comparison). */
  verdicts?: boolean;
  /** Acknowledged records keyed cwd-relative. Default: the sidecar at
   *  `<cwd>/.pi/dashboard/kb/dox-staleness.json` (v1/v2 tolerant). */
  acks?: Record<string, AckRecord>;
  /** Chunk-body loader — store hits carry NO body (`KbHit` is deliberately
   *  slim, slim-kb-search-output), so the caller supplies one, typically
   *  `(h) => store.getChunkById(h.root, h.chunkId)?.body`. A hit may also
   *  carry an inline `body` (synthetic/test hits); it wins when present. */
  loadBody?(hit: KbHit): string | null | undefined;
  fs?: VerdictFs;
  /** Injectable git runner (tests: spawn failure → GONE). Default execFileSync. */
  git?(args: string[], cwd: string): string;
  /** Opt-in content coverage (design D5) — undefined/absent = OFF. */
  coverage?: { query: string };
}

interface Subject {
  abs: string;
  rel: string; // cwd-relative key (acks, git, render)
}

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/** Git's own binary sniff: a NUL byte in the leading chunk. Only bytes already
 *  read are sniffed; a stat-short-circuited subject is never sniffed. */
function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function insideRoot(abs: string, cwd: string): boolean {
  return abs === cwd || abs.startsWith(cwd + sep);
}

/** The hit's section body. Precedence: inline `body` (synthetic/test hits) →
 *  caller loader → DISK (the default for store hits). Disk is the honest
 *  default: the store's body can lag the file (debounced reindex), and the
 *  question is what the row says NOW. Also structural: the chunks table is an
 *  FTS5 virtual table, so every `getChunkById` is a full scan — reading the
 *  small markdown file is orders of magnitude cheaper than any store fetch. */
function bodyOf(hit: KbHit, ctx: EnrichCtx): string {
  const inline = (hit as KbHit & { body?: unknown }).body;
  if (typeof inline === "string") return inline;
  if (ctx.loadBody) {
    try {
      const loaded = ctx.loadBody(hit);
      if (loaded != null) return loaded;
    } catch {
      return ""; // a loader failure must not break enrichment
    }
  }
  return bodyFromDisk(hit, ctx.cwd);
}

/** Extract the hit's section from the source markdown on disk by re-chunking
 *  the file and matching its breadcrumb. Best-effort: any failure → "" (no
 *  subjects → null verdict — never a wrong one). */
function bodyFromDisk(hit: KbHit, cwd: string): string {
  try {
    const abs = resolve(cwd, hit.root, hit.path);
    if (!existsSync(abs)) return "";
    const parsed = chunkMarkdown({ root: hit.root, path: hit.path, text: readFileSync(abs, "utf8") });
    return parsed.chunks.find((c) => c.headingPath === hit.headingPath)?.body ?? "";
  } catch {
    return "";
  }
}

/** The DOX-section gate, mirroring lint's own `inDox` rule (dox.ts): only
 *  headings starting with `DOX` hold file-index rows. Without this, prose
 *  tables (Subagent Routing, gate tables) would resolve their first cells to
 *  non-existent files and report spurious `GONE` verdicts. */
function isDoxSection(headingPath: string): boolean {
  const leaf = headingPath.split(" > ").pop() ?? headingPath;
  return /^DOX\b/.test(leaf.trim());
}

/** Resolve the hit's resolvable DOX-row subject set: the source files its
 *  section's rows document, in row order, capped at SUBJECT_CAP. A row whose
 *  path anchors outside the indexed cwd yields NO subject — never a guess,
 *  never a read outside the root. `bodyCache` memoizes disk reads across the
 *  page (a 10-hit page often draws on one AGENTS.md). */
function sectionSubjects(hit: KbHit, ctx: EnrichCtx, bodyCache: Map<string, string>): Subject[] {
  if (!isDoxSection(hit.headingPath)) return [];
  const cacheKey = `${hit.root}/${hit.path}/${hit.headingPath}`;
  let body = bodyCache.get(cacheKey);
  if (body === undefined) {
    body = bodyOf(hit, ctx);
    bodyCache.set(cacheKey, body);
  }
  const agentsAbs = resolve(ctx.cwd, hit.root, hit.path);
  const agentsDir = dirname(agentsAbs);
  const out: Subject[] = [];
  for (const row of parseRows(body)) {
    const abs = resolveRowPath(agentsDir, ctx.cwd, row.path);
    if (!insideRoot(abs, ctx.cwd)) continue;
    out.push({ abs, rel: relative(ctx.cwd, abs) });
  }
  return out;
}

/** One batched rename scan per repo per enrichment (design D3). `git mv`
 *  (staged) and working-tree renames are visible to `git diff HEAD -M`; a
 *  committed-then-clean rename, a non-git dir, and a git failure all degrade
 *  to "no rename" → GONE (accepted, D3). An old path mapping to TWO different
 *  successors is ambiguous → GONE, never a guess. Values are cwd-relative. */
/** Apply ONE `-z` name-status record starting at `i`; returns the next index.
 *  R/C records carry two paths, others one. */
function applyRenameRecord(map: Map<string, string>, parts: string[], status: string, i: number): number {
  if (!(status.startsWith("R") || status.startsWith("C"))) return i + 1;
  const from = parts[i];
  const to = parts[i + 1];
  if (!from || !to) return parts.length;
  const prev = map.get(from);
  if (prev === undefined) map.set(from, to);
  else if (prev !== to) map.set(from, "\0ambiguous"); // two successors → guess-free
  return i + 2;
}

function parseRenameRecords(out: string, map: Map<string, string>): void {
  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const status = parts[i++];
    if (!status) break;
    i = applyRenameRecord(map, parts, status, i);
  }
}

/** Shorthand git runner for the rename scan (injectable via ctx.git). */
function runGit(cwd: string, git: EnrichCtx["git"], args: string[]): string {
  const run = git ?? ((a: string[], c: string) => execFileSync("git", a, { cwd: c, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  return run(args, cwd);
}

function renameBatch(cwd: string, git: EnrichCtx["git"]): Map<string, string> {
  const map = new Map<string, string>();
  let out: string;
  try {
    out = runGit(cwd, git, ["diff", "HEAD", "--name-status", "-M", "-z"]);
  } catch {
    return map; // non-git / no commits / spawn failure → no renames known
  }
  parseRenameRecords(out, map);
  map.forEach((to, from) => {
    if (to === "\0ambiguous") map.delete(from);
  });
  return map;
}

function emptyCounts(): VerdictCounts {
  return { fresh: 0, stale: 0, moved: 0, gone: 0, unverified: 0, checked: 0, total: 0 };
}

function defaultAcks(cwd: string): Record<string, AckRecord> {
  try {
    return readStaleness(resolve(cwd, ".pi", "dashboard", "kb", "dox-staleness.json"));
  } catch {
    return {};
  }
}

/** The stat/ack/hash ladder for ONE subject (design D2/D13). Callers have
 *  already resolved existence: `st` is a stat here. Order of gates:
 *  1. no acked hash -> UNVERIFIED (D12 - absence of a hash is not a change).
 *  2. acked stat baseline matches -> FRESH with ZERO reads (the read skip).
 *  3. hash fallback (<=1 MiB, binary-skipped): match -> FRESH, differ -> STALE;
 *     unreadable/oversized/binary where the baseline didn't match -> UNVERIFIED. */
function labelExistingSubject(
  abs: string,
  st: { size: number; mtimeMs: number },
  ack: AckRecord | undefined,
  fs: VerdictFs,
): VerdictLabel {
  if (!ack?.sha256) return "UNVERIFIED"; // exists, unproven - the common first-run case
  if (ack.size != null && ack.mtimeMs != null && ack.size === st.size && ack.mtimeMs === st.mtimeMs) {
    return "FRESH"; // stat-gated read skip (D2): acked stat still true
  }
  if (st.size > HASH_CAP_BYTES) return "UNVERIFIED"; // oversized, baseline didn't match -> cannot hash
  try {
    const buf = fs.read(abs, st.size); // whole file (size <= cap)
    if (isBinary(buf)) return "UNVERIFIED"; // binary is never hashed
    return sha256(buf) === ack.sha256 ? "FRESH" : "STALE";
  } catch {
    return "UNVERIFIED"; // EACCES during hash - no crash, no partial verdict (X2)
  }
}

/** Per-label count key, replacing a five-way ternary in the hot loop. */
const COUNT_KEY: Record<VerdictLabel, "fresh" | "stale" | "moved" | "gone" | "unverified"> = {
  FRESH: "fresh",
  STALE: "stale",
  MOVED: "moved",
  GONE: "gone",
  UNVERIFIED: "unverified",
};

/** An absent subject: MOVED when the batched rename scan found exactly one
 *  successor (recorded into movedTo), else GONE (existence first — deleted +
 *  never-acked is GONE too). */
function absentLabel(rel: string, renames: Map<string, string>, movedTo: string[]): VerdictLabel {
  const successor = renames.get(rel.split(sep).join("/"));
  if (successor) {
    movedTo.push(successor);
    return "MOVED";
  }
  return "GONE";
}

/** Compute one hit's verdict over its checked subjects. */
function verdictForHit(
  checked: Subject[],
  total: number,
  stats: Array<{ size: number; mtimeMs: number } | null | "unreadable">,
  renames: Map<string, string>,
  acks: Record<string, AckRecord>,
  fs: VerdictFs,
): HitVerdict {
  const counts = emptyCounts();
  counts.total = total;
  counts.checked = checked.length;
  const movedTo: string[] = [];
  const labels: VerdictLabel[] = [];

  for (let i = 0; i < checked.length; i++) {
    const s = checked[i];
    const st = stats[i];
    const relKey = s.rel.split(sep).join("/");
    let label: VerdictLabel;
    if (st === "unreadable") {
      label = "UNVERIFIED"; // cannot verify is not "changed" (D12/X2)
    } else if (st === null) {
      label = absentLabel(s.rel, renames, movedTo);
    } else {
      label = labelExistingSubject(s.abs, st, acks[relKey], fs);
    }
    labels.push(label);
    counts[COUNT_KEY[label]]++;
  }

  // Aggregate worst-of (GONE > MOVED > STALE > UNVERIFIED > FRESH) + attach.
  const worst = labels.reduce<VerdictLabel>((w, l) => (WORST[l] < WORST[w] ? l : w), "FRESH");
  const verdict: HitVerdict = { label: worst, counts };
  if (movedTo.length) verdict.movedTo = movedTo;
  return verdict;
}

/** Enrich ONE hit in place. Not eligible (non-agents / zero resolvable rows)
 *  → `verdict: null` — the honest "no verdict", never a vacuous label. */
function enrichOne(
  hit: KbHit,
  ctx: EnrichCtx,
  fs: VerdictFs,
  acks: Record<string, AckRecord>,
  bodyCache: Map<string, string>,
): void {
  if (hit.docType !== "agents") {
    hit.verdict = null; // prose reports no verdict rather than a vacuous one
    return;
  }
  const subjects = sectionSubjects(hit, ctx, bodyCache);
  if (subjects.length === 0) {
    hit.verdict = null;
    return;
  }
  const checked = subjects.slice(0, SUBJECT_CAP);
  const stats: Array<{ size: number; mtimeMs: number } | null | "unreadable"> = [];
  for (const s of checked) {
    try {
      stats.push(fs.stat(s.abs));
    } catch {
      stats.push("unreadable");
    }
  }
  // ONE batched rename scan per enrichment, only when something is absent.
  const renames = stats.some((s) => s === null) ? renameBatch(ctx.cwd, ctx.git) : new Map<string, string>();
  hit.verdict = verdictForHit(checked, subjects.length, stats, renames, acks, fs);
  // Opt-in coverage (D5): own field, its own capped read, verdict untouched.
  if (ctx.coverage?.query) hit.coverage = coverageScore(checked, fs, ctx.coverage.query);
}

/** Enrich a page of hits with trust verdicts (and optional coverage). Pure
 *  async post-search stage: reads subjects + the ack sidecar, runs at most ONE
 *  git rename scan per repo, writes NOTHING (D4). Hits not eligible for a
 *  verdict (disabled enrichment, non-`agents` doc type, zero resolvable rows)
 *  carry `verdict: null` — the honest "no verdict", never a vacuous label. */
export async function enrichHits(hits: KbHit[], ctx: EnrichCtx): Promise<KbHit[]> {
  if (ctx.verdicts === false) return hits; // D1: identical to never enriching
  const fs = ctx.fs ?? nodeFs;
  const acks = ctx.acks ?? defaultAcks(ctx.cwd);
  const pageBodyCache = new Map<string, string>(); // per-page disk-body memo

  // Pass 1 — resolve subjects + stat, per eligible hit.
  for (const hit of hits) enrichOne(hit, ctx, fs, acks, pageBodyCache);
  return hits;
}

/** Share of distinct query terms present in the (capped) subject bytes. */
function coverageScore(subjects: Subject[], fs: VerdictFs, query: string): number | undefined {
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1))];
  if (!terms.length) return undefined;
  let matched = 0;
  for (const t of terms) if (termCovered(t, subjects, fs)) matched++;
  return matched / terms.length;
}

/** Does ONE term appear in ANY (capped) subject's bytes? */
function termCovered(term: string, subjects: Subject[], fs: VerdictFs): boolean {
  for (const s of subjects) {
    try {
      const buf = fs.read(s.abs, COVERAGE_CAP_BYTES);
      if (isBinary(buf)) continue;
      if (buf.toString("utf8").toLowerCase().includes(term)) return true;
    } catch {
      continue; // unreadable subject contributes nothing to coverage
    }
  }
  return false;
}
