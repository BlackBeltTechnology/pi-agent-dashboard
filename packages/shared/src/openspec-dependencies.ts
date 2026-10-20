/**
 * OpenSpec change-to-change dependencies: per-change `dependencies.yaml`
 * parser + safe reader, proposal / spec-delta scanners, and the pure graph
 * computation (merge, resolution, validation, waves).
 *
 * The graph is deterministic: identical repository content yields byte-identical
 * output regardless of line endings, directory order or host OS. Nothing here
 * writes to disk; the only I/O is `readDependenciesFile` (bounded, symlink-safe).
 *
 * See change: add-openspec-change-dependencies.
 */

import { constants as fsConstants } from "node:fs";
import * as fsp from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  ChangeDependencies,
  DependencyEdge,
  DependencyEdgeSource,
  DependencyIssue,
} from "./types.js";

/** OpenSpec's change-id grammar (not the dashboard's stricter slug rule). */
export const KEBAB_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEPENDENCIES_FILE = "dependencies.yaml";
/** Hard read cap; the reader reads at most `MAX_DEPENDENCIES_BYTES + 1`. */
export const MAX_DEPENDENCIES_BYTES = 64 * 1024;
export const MAX_REASON_CHARS = 500;
const MAX_INFERRED_REASON_CHARS = 200;

// ── Declared file ───────────────────────────────────────────────────

export interface DeclaredBlocker {
  change: string;
  reason?: string;
}

/** The file's own lists (what the editor edits; reasons preserved). */
export interface DeclaredDependencies {
  blockedBy: DeclaredBlocker[];
  notBlockedBy: string[];
  related: string[];
}

export type ParseResult = { ok: true; value: DeclaredDependencies } | { ok: false; error: string };

const EMPTY_DECLARED = (): DeclaredDependencies => ({ blockedBy: [], notBlockedBy: [], related: [] });
const ALLOWED_KEYS = new Set(["blocked_by", "not_blocked_by", "related"]);

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function nameList(key: string, v: unknown): { names: string[] } | { error: string } {
  if (isEmptyValue(v)) return { names: [] };
  if (!Array.isArray(v)) return { error: `\`${key}\` must be a list` };
  const names: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !KEBAB_ID_REGEX.test(item)) {
      return { error: `\`${key}\` has an invalid change name: ${JSON.stringify(item)}` };
    }
    if (!names.includes(item)) names.push(item);
  }
  return { names };
}

/**
 * Parse the text of a `dependencies.yaml`. `failsafe` schema (every scalar is
 * a string, so `123` stays a name), aliases rejected. Never throws.
 */
export function parseDependenciesFile(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(text, { schema: "failsafe", maxAliasCount: 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return fail(`unparseable YAML: ${msg}`);
  }
  if (isEmptyValue(doc)) return { ok: true, value: EMPTY_DECLARED() };
  if (typeof doc !== "object" || Array.isArray(doc)) return fail("top level must be a mapping");
  const obj = doc as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return fail(`unknown top-level key \`${key}\``);
  }
  const value = EMPTY_DECLARED();

  const rawBlocked = obj.blocked_by;
  if (!isEmptyValue(rawBlocked)) {
    if (!Array.isArray(rawBlocked)) return fail("`blocked_by` must be a list");
    for (const item of rawBlocked) {
      let change: unknown;
      let reason: unknown;
      if (typeof item === "string") {
        change = item;
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        for (const k of Object.keys(rec)) {
          if (k !== "change" && k !== "reason") return fail(`\`blocked_by\` entry has unknown key \`${k}\``);
        }
        change = rec.change;
        reason = rec.reason;
      } else {
        return fail("`blocked_by` entries must be a name or { change, reason? }");
      }
      if (typeof change !== "string" || !KEBAB_ID_REGEX.test(change)) {
        return fail(`\`blocked_by\` has an invalid change name: ${JSON.stringify(change)}`);
      }
      if (reason !== undefined && reason !== null) {
        if (typeof reason !== "string") return fail("`reason` must be a string");
        if (reason.length > MAX_REASON_CHARS) return fail(`\`reason\` exceeds ${MAX_REASON_CHARS} characters`);
      }
      if (value.blockedBy.some((b) => b.change === change)) continue;
      value.blockedBy.push(typeof reason === "string" && reason !== "" ? { change, reason } : { change });
    }
  }
  for (const [key, target] of [
    ["not_blocked_by", "notBlockedBy"],
    ["related", "related"],
  ] as const) {
    const r = nameList(key, obj[key]);
    if ("error" in r) return fail(r.error);
    value[target] = r.names;
  }
  return { ok: true, value };
}

/** Serialize declared lists through the YAML serializer (never string concatenation). */
export function serializeDependencies(d: DeclaredDependencies): string {
  return stringifyYaml({
    blocked_by: d.blockedBy.map((b) => (b.reason ? { change: b.change, reason: b.reason } : { change: b.change })),
    not_blocked_by: d.notBlockedBy,
    related: d.related,
  });
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

export type ReadResult =
  | { kind: "absent" }
  | { kind: "invalid"; error: string; stat?: FileStat }
  | { kind: "ok"; value: DeclaredDependencies; stat: FileStat };

type ReaderFs = Pick<typeof fsp, "lstat" | "open">;

/**
 * Read + parse a `dependencies.yaml` under the read rules: only a regular,
 * non-symlink file is opened; at most 64 KiB + 1 byte is read. A symlink, a
 * non-regular file (FIFO, device) or an oversize file is `invalid` and is
 * never read through. `fsImpl` is a test seam.
 */
export async function readDependenciesFile(file: string, fsImpl: ReaderFs = fsp): Promise<ReadResult> {
  let st: Awaited<ReturnType<ReaderFs["lstat"]>>;
  try {
    st = await fsImpl.lstat(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    return { kind: "invalid", error: `unreadable: ${code ?? "error"}` };
  }
  const stat: FileStat = { mtimeMs: st.mtimeMs, size: st.size };
  if (st.isSymbolicLink()) return { kind: "invalid", error: "is a symlink", stat };
  if (!st.isFile()) return { kind: "invalid", error: "is not a regular file", stat };
  if (st.size > MAX_DEPENDENCIES_BYTES) {
    return { kind: "invalid", error: `exceeds ${MAX_DEPENDENCIES_BYTES} bytes`, stat };
  }
  let text: string;
  let openedStat: FileStat = stat;
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
    const handle = await fsImpl.open(file, fsConstants.O_RDONLY | noFollow);
    try {
      const hs = await handle.stat();
      if (!hs.isFile()) return { kind: "invalid", error: "is not a regular file", stat };
      openedStat = { mtimeMs: hs.mtimeMs, size: hs.size };
      const buf = Buffer.alloc(MAX_DEPENDENCIES_BYTES + 1);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      if (bytesRead > MAX_DEPENDENCIES_BYTES) {
        return { kind: "invalid", error: `exceeds ${MAX_DEPENDENCIES_BYTES} bytes`, stat: openedStat };
      }
      text = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { kind: "invalid", error: `unreadable: ${code ?? "error"}`, stat };
  }
  const parsed = parseDependenciesFile(text);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error, stat: openedStat };
  return { kind: "ok", value: parsed.value, stat: openedStat };
}

// ── Proposal and delta scanners (per-file, cacheable) ───────────────

export interface LabelledToken {
  token: string;
  /** The label line: `\r` removed, whitespace collapsed, ≤ 200 chars. */
  line: string;
}

/** Per-file scan of a `proposal.md`: independent of any other file. */
export interface ProposalScan {
  /** Tokens under `Blocked by` / `Depends on` / `Builds on`. */
  blockedBy: LabelledToken[];
  /** Tokens under `Blocks`. */
  blocks: LabelledToken[];
  /** Backticked change-id-shaped tokens outside labelled regions and fences. */
  mentions: string[];
}

export interface DeltaScan {
  /** Has `## ADDED Requirements`. */
  added: boolean;
  /** Has `## MODIFIED|REMOVED|RENAMED Requirements`. */
  modifies: boolean;
  /** Has at least one of the four headers. */
  anyHeader: boolean;
}

/** Collapse whitespace runs, drop `\r`, truncate. */
export function normalizeText(s: string, max: number): string {
  const t = s.replace(/\r/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_MARKER_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const BOLD = String.raw`(?:\*\*|__)`;
/**
 * Label grammar: optional list marker, optional bold, label, optional
 * parenthetical, then `:` (inside or outside the bold) or a backticked token.
 * `Blocks on:` is not a label — nothing after `Blocks` may be a word.
 */
const LABEL_RE = new RegExp(
  String.raw`^\s*(?:[-*+]\s+|\d+[.)]\s+)?${BOLD}?(blocked by|depends on|builds on|blocks)(?:[ \t]*\([^)\n]*\))?` +
    String.raw`(?:[ \t]*:${BOLD}?|[ \t]*${BOLD}[ \t]*:?|(?=[ \t]+\`))`,
  "i",
);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function backtickTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    if (KEBAB_ID_REGEX.test(t)) out.push(t);
  }
  return out;
}

function lineClosesFence(line: string, fence: string): boolean {
  const m = FENCE_RE.exec(line);
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
}

/** Scan a proposal for labelled dependency lines and prose mentions. */
export function scanProposal(text: string): ProposalScan {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const labelled = new Map<number, true>();
  const blockedBy: LabelledToken[] = [];
  const blocks: LabelledToken[] = [];
  const seen = { b: new Set<string>(), k: new Set<string>() };

  let fence: string | null = null;
  const inFence: boolean[] = lines.map((l) => {
    if (fence) {
      const closes = lineClosesFence(l, fence);
      if (closes) fence = null;
      return true;
    }
    const m = FENCE_RE.exec(l);
    if (m) {
      fence = m[1];
      return true;
    }
    return false;
  });

  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] || labelled.has(i)) continue;
    const m = LABEL_RE.exec(lines[i]);
    if (!m) continue;
    const kind = m[1].toLowerCase() === "blocks" ? "blocks" : "blockedBy";
    const indent = indentOf(lines[i]);
    const tokens = backtickTokens(lines[i].slice(m[0].length));
    labelled.set(i, true);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (inFence[j] || l.trim() === "" || HEADING_RE.test(l)) break;
      if (indentOf(l) <= indent && (LIST_MARKER_RE.test(l) || LABEL_RE.test(l))) break;
      labelled.set(j, true);
      tokens.push(...backtickTokens(l));
    }
    const line = normalizeText(lines[i], MAX_INFERRED_REASON_CHARS);
    const target = kind === "blocks" ? blocks : blockedBy;
    const seenSet = kind === "blocks" ? seen.k : seen.b;
    for (const token of tokens) {
      if (seenSet.has(token)) continue;
      seenSet.add(token);
      target.push({ token, line });
    }
  }

  const mentions = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] || labelled.has(i)) continue;
    for (const t of backtickTokens(lines[i])) mentions.add(t);
  }
  return { blockedBy, blocks, mentions: [...mentions].sort() };
}

const DELTA_HEADER_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;

/** Scan a delta `spec.md` for requirement section headers (outside fences). */
export function scanDelta(text: string): DeltaScan {
  let added = false;
  let modifies = false;
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (fence) {
      if (lineClosesFence(line, fence)) fence = null;
      continue;
    }
    const f = FENCE_RE.exec(line);
    if (f) {
      fence = f[1];
      continue;
    }
    const m = DELTA_HEADER_RE.exec(line);
    if (!m) continue;
    if (m[1].toUpperCase() === "ADDED") added = true;
    else modifies = true;
  }
  return { added, modifies, anyHeader: added || modifies };
}

const ARCHIVE_DIR_RE = /^\d{4}-\d{2}-\d{2}-(.+)$/;

/** `archive/<YYYY-MM-DD>-<name>` directory name → `<name>`; `null` when it does not match. */
export function archivedChangeName(dirName: string): string | null {
  const m = ARCHIVE_DIR_RE.exec(dirName);
  return m ? m[1] : null;
}

// ── Graph ───────────────────────────────────────────────────────────

export type DeclaredState =
  | { state: "absent" }
  | { state: "invalid"; error: string }
  | { state: "ok"; value: DeclaredDependencies };

/** Everything the graph needs to know about one active change. */
export interface ChangeInputs {
  name: string;
  declared: DeclaredState;
  proposal: ProposalScan | null;
  /** Capability id (spec path relative to `specs/`) → delta scan. */
  deltas: Record<string, DeltaScan>;
}

export interface GraphInputs {
  changes: ChangeInputs[];
  /** Names of archived changes (exact `<date>-<name>` directories, name part only). */
  archived: string[];
  /** Capability ids that have a main spec `openspec/specs/<cap>/spec.md`. */
  mainSpecs: string[];
}

const PRIORITY: Record<DependencyEdgeSource, number> = {
  declared: 3,
  "inferred-text": 2,
  "inferred-capability": 1,
};

interface Candidate {
  blocked: string;
  blocker: string;
  source: DependencyEdgeSource;
  reason?: string;
  satisfied: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortIssues(issues: DependencyIssue[]): DependencyIssue[] {
  return issues.sort((x, y) => cmp(x.code, y.code) || cmp(x.message, y.message));
}

type Adj = Map<string, string[]>;

/** Tarjan SCC over `adj` (node → successors); returns only non-trivial components. */
function nonTrivialSccs(nodes: string[], adj: Adj): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const popComponent = (root: string): string[] => {
    const comp: string[] = [];
    let w: string;
    do {
      w = stack.pop() as string;
      onStack.delete(w);
      comp.push(w);
    } while (w !== root);
    return comp;
  };
  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
      }
    }
    if (low.get(v) !== idx.get(v)) return;
    const comp = popComponent(v);
    if (comp.length > 1) out.push(comp.sort(cmp));
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

/** Reverse adjacency (successor → predecessors) restricted to `members`. */
function reverseWithin(members: Set<string>, adj: Adj): Adj {
  const rev: Adj = new Map();
  for (const v of members) for (const w of adj.get(v) ?? []) if (members.has(w)) push(rev, w, v);
  return rev;
}

/** BFS distance of every node to `target` along `adj` edges (`target` = 0). */
function distancesTo(target: string, rev: Adj): Map<string, number> {
  const dist = new Map<string, number>([[target, 0]]);
  const queue = [target];
  for (let q = 0; q < queue.length; q++) {
    const here = dist.get(queue[q]) as number;
    for (const p of rev.get(queue[q]) ?? []) {
      if (dist.has(p)) continue;
      dist.set(p, here + 1);
      queue.push(p);
    }
  }
  return dist;
}

/** Shortest cycle through the SCC's smallest member; lexicographically smallest on ties. */
function canonicalCycle(members: string[], adj: Adj): string[] {
  const set = new Set(members);
  const start = members[0];
  const dist = distancesTo(start, reverseWithin(set, adj));
  const successors = (v: string) => (adj.get(v) ?? []).filter((w) => set.has(w) && dist.has(w));
  // cycle length: shortest way back to `start` through one of its successors
  let remaining = Math.min(...successors(start).map((w) => (dist.get(w) as number) + 1));
  const path = [start];
  let cur = start;
  while (remaining > 0) {
    cur = successors(cur)
      .filter((w) => dist.get(w) === remaining - 1)
      .sort(cmp)[0];
    path.push(cur);
    remaining--;
  }
  return path;
}

// ── graph stages ────────────────────────────────────────────────────

/** Mutable state shared by the stages of one `computeDependencyGraph` call. */
interface GraphCtx {
  inputs: ChangeInputs[];
  names: string[];
  active: Set<string>;
  archived: Set<string>;
  mainSpecs: Set<string>;
  issues: Map<string, DependencyIssue[]>;
  related: Map<string, Set<string>>;
  notBlocked: Map<string, Set<string>>;
  candidates: Candidate[];
}

const addIssue = (ctx: GraphCtx, name: string, issue: DependencyIssue): void => {
  (ctx.issues.get(name) as DependencyIssue[]).push(issue);
};

const resolveName = (ctx: GraphCtx, n: string): "active" | "archived" | "unknown" =>
  ctx.active.has(n) ? "active" : ctx.archived.has(n) ? "archived" : "unknown";

/** Declared file: invalid → error; else `related`, `not_blocked_by` and one candidate per `blocked_by` entry. */
function collectDeclared(ctx: GraphCtx, c: ChangeInputs): void {
  const x = c.name;
  if (c.declared.state === "invalid") {
    addIssue(ctx, x, { severity: "error", code: "invalid-file", message: c.declared.error });
    return;
  }
  if (c.declared.state !== "ok") return;
  const d = c.declared.value;
  const nbb = new Set(d.notBlockedBy);
  ctx.notBlocked.set(x, nbb);
  for (const r of d.related) if (r !== x && ctx.active.has(r)) (ctx.related.get(x) as Set<string>).add(r);
  for (const b of d.blockedBy) {
    if (b.change === x) {
      addIssue(ctx, x, { severity: "error", code: "self-reference", message: "change lists itself in blocked_by" });
      continue;
    }
    if (nbb.has(b.change)) {
      addIssue(ctx, x, {
        severity: "warning",
        code: "conflicting-entry",
        message: `\`${b.change}\` is in both blocked_by and not_blocked_by; not_blocked_by wins`,
        with: [b.change],
      });
      continue;
    }
    const res = resolveName(ctx, b.change);
    if (res === "unknown") {
      addIssue(ctx, x, {
        severity: "warning",
        code: "unknown-change",
        message: `blocked_by names unknown change \`${b.change}\``,
        with: [b.change],
      });
      continue;
    }
    ctx.candidates.push({
      blocked: x,
      blocker: b.change,
      source: "declared",
      ...(b.reason ? { reason: normalizeText(b.reason, MAX_REASON_CHARS) } : {}),
      satisfied: res === "archived",
    });
  }
}

/** L1: labelled proposal lines → candidates; prose mentions → `related`. */
function collectProposalEdges(ctx: GraphCtx, c: ChangeInputs): void {
  if (!c.proposal) return;
  const x = c.name;
  for (const t of c.proposal.blockedBy) {
    const res = t.token === x ? "unknown" : resolveName(ctx, t.token);
    if (res === "unknown") continue;
    ctx.candidates.push({ blocked: x, blocker: t.token, source: "inferred-text", reason: t.line, satisfied: res === "archived" });
  }
  for (const t of c.proposal.blocks) {
    if (t.token === x || !ctx.active.has(t.token)) continue;
    ctx.candidates.push({ blocked: t.token, blocker: x, source: "inferred-text", reason: t.line, satisfied: false });
  }
  for (const m of c.proposal.mentions) if (m !== x && ctx.active.has(m)) (ctx.related.get(x) as Set<string>).add(m);
}

/** L2 for one capability: a sole birther blocks every other change with a delta header; several birthers warn. */
function collectCapabilityBirth(ctx: GraphCtx, cap: string, touching: ChangeInputs[]): void {
  const birthers = touching.filter((c) => c.deltas[cap].added && !c.deltas[cap].modifies);
  if (birthers.length >= 2) {
    for (const b of birthers) {
      const others = birthers.filter((o) => o !== b).map((o) => o.name);
      addIssue(ctx, b.name, {
        severity: "warning",
        code: "duplicate-capability",
        message: `capability \`${cap}\` is also added by ${others.map((o) => `\`${o}\``).join(", ")}; declare the order`,
        with: others,
      });
    }
    return;
  }
  if (birthers.length !== 1) return;
  const birth = birthers[0];
  for (const c of touching) {
    if (c === birth || !c.deltas[cap].anyHeader) continue;
    ctx.candidates.push({ blocked: c.name, blocker: birth.name, source: "inferred-capability", reason: cap, satisfied: false });
  }
}

/** L2 + L3 over every capability touched by a delta; returns the undirected `overlaps`. */
function collectCapabilityEdges(ctx: GraphCtx): Map<string, Set<string>> {
  const byCap = new Map<string, ChangeInputs[]>();
  for (const c of ctx.inputs) for (const cap of Object.keys(c.deltas)) push(byCap, cap, c);
  const overlaps = new Map<string, Set<string>>(ctx.names.map((n) => [n, new Set()]));
  for (const cap of [...byCap.keys()].sort(cmp)) {
    const touching = byCap.get(cap) as ChangeInputs[];
    for (const a of touching) for (const b of touching) if (a !== b) (overlaps.get(a.name) as Set<string>).add(b.name);
    if (!ctx.mainSpecs.has(cap)) collectCapabilityBirth(ctx, cap, touching);
  }
  return overlaps;
}

/** One edge per ordered (blocked, blocker) pair: highest priority wins; `not_blocked_by` suppresses. */
function mergeEdges(ctx: GraphCtx): Map<string, Map<string, Candidate>> {
  const edges = new Map<string, Map<string, Candidate>>(ctx.names.map((n) => [n, new Map()]));
  for (const cand of ctx.candidates) {
    if (ctx.notBlocked.get(cand.blocked)?.has(cand.blocker)) continue;
    const row = edges.get(cand.blocked);
    if (!row) continue;
    const cur = row.get(cand.blocker);
    if (!cur || PRIORITY[cand.source] > PRIORITY[cur.source]) row.set(cand.blocker, cand);
  }
  return edges;
}

/** Open edges among active changes (node → blockers), all sources and declared-only. */
function openAdjacency(ctx: GraphCtx, edges: Map<string, Map<string, Candidate>>): { open: Adj; declared: Adj } {
  const open: Adj = new Map();
  const declared: Adj = new Map();
  for (const n of ctx.names) {
    const o: string[] = [];
    const d: string[] = [];
    for (const [blocker, e] of [...(edges.get(n) as Map<string, Candidate>)].sort((a, b) => cmp(a[0], b[0]))) {
      if (e.satisfied || !ctx.active.has(blocker)) continue;
      o.push(blocker);
      if (e.source === "declared") d.push(blocker);
    }
    open.set(n, o);
    declared.set(n, d);
  }
  return { open, declared };
}

/** Cycles: declared-only SCCs are errors, remaining members of full-graph SCCs are warnings. */
function reportCycles(ctx: GraphCtx, adj: { open: Adj; declared: Adj }): Set<string> {
  const members = new Set<string>();
  const report = (comp: string[], graph: Adj, severity: "error" | "warning") => {
    const path = canonicalCycle(comp, graph);
    for (const m of comp) {
      members.add(m);
      addIssue(ctx, m, { severity, code: "cycle", message: `dependency cycle: ${path.join(" → ")}`, path });
    }
  };
  const errorMembers = new Set<string>();
  for (const comp of nonTrivialSccs(ctx.names, adj.declared)) {
    report(comp, adj.declared, "error");
    for (const m of comp) errorMembers.add(m);
  }
  for (const comp of nonTrivialSccs(ctx.names, adj.open)) {
    const rest = comp.filter((m) => !errorMembers.has(m));
    if (rest.length > 0) report(rest, adj.open, "warning");
  }
  return members;
}

/** Changes with an open path to a cycle member (the members themselves excluded). */
function downstreamOfCycles(cycleMembers: Set<string>, rev: Adj): Set<string> {
  const seen = new Set<string>(cycleMembers);
  const downstream = new Set<string>();
  const stack = [...cycleMembers];
  while (stack.length > 0) {
    for (const dep of rev.get(stack.pop() as string) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      downstream.add(dep);
      stack.push(dep);
    }
  }
  return downstream;
}

/** Kahn layering over `eligible` nodes; wave 1 has no open blockers. */
function assignWaves(eligible: string[], openAdj: Adj, rev: Adj): Map<string, number> {
  const wave = new Map<string, number>();
  const indeg = new Map<string, number>(eligible.map((n) => [n, (openAdj.get(n) ?? []).length]));
  let layer = eligible.filter((n) => indeg.get(n) === 0);
  for (let w = 1; layer.length > 0; w++) {
    const next: string[] = [];
    for (const n of layer) {
      wave.set(n, w);
      for (const dep of rev.get(n) ?? []) {
        if (!indeg.has(dep)) continue;
        const left = (indeg.get(dep) as number) - 1;
        indeg.set(dep, left);
        if (left === 0) next.push(dep);
      }
    }
    layer = next.sort(cmp);
  }
  return wave;
}

export function computeDependencyGraph(input: GraphInputs): Record<string, ChangeDependencies> {
  const inputs = [...input.changes].sort((a, b) => cmp(a.name, b.name));
  const names = inputs.map((c) => c.name);
  const ctx: GraphCtx = {
    inputs,
    names,
    active: new Set(names),
    archived: new Set(input.archived),
    mainSpecs: new Set(input.mainSpecs),
    issues: new Map(names.map((n) => [n, []])),
    related: new Map(names.map((n) => [n, new Set<string>()])),
    notBlocked: new Map(names.map((n) => [n, new Set<string>()])),
    candidates: [],
  };

  for (const c of inputs) {
    collectDeclared(ctx, c);
    collectProposalEdges(ctx, c);
  }
  const overlaps = collectCapabilityEdges(ctx);
  const edges = mergeEdges(ctx);
  const adj = openAdjacency(ctx, edges);

  const cycleMembers = reportCycles(ctx, adj);
  const rev: Adj = new Map();
  for (const [n, blockers] of adj.open) for (const b of blockers) push(rev, b, n);
  const downstream = downstreamOfCycles(cycleMembers, rev);
  for (const n of [...downstream].sort(cmp)) {
    addIssue(ctx, n, { severity: "warning", code: "blocked-by-cycle", message: "blocked by a change that is part of a dependency cycle" });
  }
  const wave = assignWaves(names.filter((n) => !cycleMembers.has(n) && !downstream.has(n)), adj.open, rev);

  const out: Record<string, ChangeDependencies> = {};
  for (const c of inputs) {
    const n = c.name;
    const blockedBy: DependencyEdge[] = [...(edges.get(n) as Map<string, Candidate>)]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([blocker, e]) => ({
        change: blocker,
        source: e.source,
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        state: e.satisfied ? ("satisfied" as const) : ("open" as const),
      }));
    out[n] = {
      hasFile: c.declared.state !== "absent",
      blockedBy,
      blocks: (rev.get(n) ?? []).slice().sort(cmp),
      related: [...(ctx.related.get(n) as Set<string>)].sort(cmp),
      overlaps: [...(overlaps.get(n) as Set<string>)].sort(cmp),
      wave: wave.get(n) ?? null,
      issues: sortIssues(ctx.issues.get(n) as DependencyIssue[]),
    };
  }
  return out;
}
