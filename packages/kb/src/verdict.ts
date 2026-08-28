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
import { type AckRecord, parseRows, readStaleness } from "./dox-triage.js";
import { resolveRowPath } from "./dox.js";
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
function renameBatch(cwd: string, git: EnrichCtx["git"]): Map<string, string> {
  const map = new Map<string, string>();
  const run = git ?? ((args: string[], c: string) => execFileSync("git", args, { cwd: c, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  let out: string;
  try {
    out = run(["diff", "HEAD", "--name-status", "-M", "-z"], cwd);
  } catch {
    return map; // non-git / no commits / spawn failure → no renames known
  }
  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const status = parts[i++];
    if (!status) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[i++];
      const to = parts[i++];
      if (!from || !to) break;
      const prev = map.get(from);
      if (prev === undefined) map.set(from, to);
      else if (prev !== to) map.set(from, "\0ambiguous"); // two successors → guess-free
    } else {
      i++; // single-path record (A/D/M…)
    }
  }
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

/** Label ONE subject. Order of gates (design D2/D13):
 *  1. existence — absent → MOVED (rename) | GONE. Existence precedes the hash
 *     gate: deleted + never-acked = GONE, never UNVERIFIED.
 *  2. no acked hash → UNVERIFIED (D12 — absence of a hash is not a change).
 *  3. acked stat baseline matches → FRESH with ZERO reads (the read skip).
 *  4. hash fallback (≤1 MiB, binary-skipped): match → FRESH, differ → STALE;
 *     unreadable/oversized/binary where the baseline didn't match → UNVERIFIED. */
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
  for (const hit of hits) {
    if (hit.docType !== "agents") {
      hit.verdict = null; // prose reports no verdict rather than a vacuous one
      continue;
    }
    const bodyCache = pageBodyCache;
    const subjects = sectionSubjects(hit, ctx, bodyCache);
    if (subjects.length === 0) {
      hit.verdict = null;
      continue;
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

    const counts = emptyCounts();
    counts.total = subjects.length;
    counts.checked = checked.length;
    const movedTo: string[] = [];

    const labels: VerdictLabel[] = [];
    for (let i = 0; i < checked.length; i++) {
      const s = checked[i];
      const st = stats[i];
      const relKey = s.rel.split(sep).join("/");
      let label: VerdictLabel;
      if (st === "unreadable") {
        label = "UNVERIFIED"; // cannot verify ≠ changed (D12/X2)
      } else if (st === null) {
        const successor = renames.get(relKey);
        if (successor) {
          label = "MOVED";
          movedTo.push(successor);
        } else {
          label = "GONE"; // deleted + never-acked is GONE too (existence first)
        }
      } else {
        const ack = acks[relKey];
        if (!ack?.sha256) {
          label = "UNVERIFIED"; // exists, unproven — the common first-run case
        } else if (ack.size != null && ack.mtimeMs != null && ack.size === st.size && ack.mtimeMs === st.mtimeMs) {
          label = "FRESH"; // stat-gated read skip (D2): acked stat still true
        } else if (st.size > HASH_CAP_BYTES) {
          label = "UNVERIFIED"; // oversized, baseline didn't match → cannot hash
        } else {
          try {
            const buf = fs.read(s.abs, st.size); // whole file (size ≤ cap)
            label = isBinary(buf) ? "UNVERIFIED" : sha256(buf) === ack.sha256 ? "FRESH" : "STALE";
          } catch {
            label = "UNVERIFIED"; // EACCES during hash — no crash, no partial verdict
          }
        }
      }
      labels.push(label);
      counts[label === "FRESH" ? "fresh" : label === "STALE" ? "stale" : label === "MOVED" ? "moved" : label === "GONE" ? "gone" : "unverified"]++;
    }

    // Aggregate worst-of (GONE > MOVED > STALE > UNVERIFIED > FRESH) + attach.
    const worst = labels.reduce<VerdictLabel>((w, l) => (WORST[l] < WORST[w] ? l : w), "FRESH");
    const verdict: HitVerdict = { label: worst, counts };
    if (movedTo.length) verdict.movedTo = movedTo;
    hit.verdict = verdict;

    // Opt-in coverage (D5): own field, its own capped read, verdict untouched.
    if (ctx.coverage?.query) {
      hit.coverage = coverageScore(checked, fs, ctx.coverage.query);
    }
  }
  return hits;
}

/** Share of distinct query terms present in the (capped) subject bytes. */
function coverageScore(subjects: Subject[], fs: VerdictFs, query: string): number | undefined {
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1))];
  if (!terms.length) return undefined;
  let matched = 0;
  for (const t of terms) {
    for (const s of subjects) {
      try {
        const buf = fs.read(s.abs, COVERAGE_CAP_BYTES);
        if (isBinary(buf)) continue;
        if (buf.toString("utf8").toLowerCase().includes(t)) {
          matched++;
          break;
        }
      } catch {
        continue; // unreadable subject contributes nothing to coverage
      }
    }
  }
  return matched / terms.length;
}
