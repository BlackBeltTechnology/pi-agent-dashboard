/**
 * Lazy server-side resolution of a file mention against the real filesystem.
 *
 * The client tokenizer detects mentions (cheap, synchronous, offline-safe) but
 * has no filesystem; resolution moves here, on the server, performed on click.
 *
 * Security posture (design D2/D7):
 *  - `cwd` is untrusted request input — the ENDPOINT gates it against the
 *    known-session set BEFORE calling this resolver. This function assumes the
 *    caller already trusts `cwd`.
 *  - Containment (`decidePassive` → `isAllowed` / grants, then `containmentAllows`) runs BEFORE any `fs.stat`, anchored on
 *    `cwd` + a FIXED, server-derived `<os.homedir()>/.pi` allowlist. git-common
 *    -root widening is supplied by `isAllowed`'s layer ② (symlink-safe realpath),
 *    so a plain (logical) git-root anchor is deliberately NOT added here.
 *  - `os.homedir()` is read at CALL time (not module load) so a test can fake
 *    `$HOME`; the `~/.pi` anchor can never be widened by request input.
 *
 * A leading `~/` expands to the home directory; `~user/` is NOT expanded. A
 * contained mention that does not exist returns null (never an error). A mention that FAILS
 * containment is never statted and returns `{ resolved, kind, outside: true }` (the normalized
 * candidate): that discloses nothing about existence, and lets the client open the editor pane
 * where the read gate decides (design D1).
 *
 * Tagged pipeline (change: rich-chat-links, design D3): `resolveMentionTagged` runs
 *   0. re-rooted candidate (worktree parity; same containment, else continue with the original)
 *   1. producing tool's directory (opt-in `recover` + `toolCwd`; dir AND joined path must pass containment,
 *      an out-of-scope dir is skipped silently — never `gated`)
 *   2. exact (`~/` | absolute | cwd-relative); a containment failure on the user's own mention is `gated`
 *   3. fuzzy over tracked files (opt-in `recover`; `mention-fuzzy-index.ts`, at most 25 stats per mention)
 * and tags the outcome `found | recovered | ambiguous | missing | gated`. `resolveFileMention` stays the
 * exact-only legacy shape on top of it.
 *
 * See change: server-side-file-mention-resolution, fix-file-link-editor-routing, rich-chat-links,
 * spec `tool-output-linkification`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { containmentAllows } from "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
import { grantedSubjects } from "../access/access-grants.js";
import { decidePassive } from "../access/containment-gate.js";
import { dashboardStateRefuses } from "./dashboard-state-guard.js";
import { getMentionFuzzyIndex, type MentionFuzzyIndex } from "./mention-fuzzy-index.js";
import { safeRealpath, within } from "./path-containment.js";

type MentionKind = "abs" | "tilde" | "relative";

export interface ResolvedMention {
  resolved: string;
  kind: MentionKind;
  /**
   * True iff the candidate FAILED containment (never statted, so independent of existence). The open route's
   * own gate (grant / prompt / 403 / 404) stays the sole authority for reading it.
   */
  outside?: true;
}

export type Containment = "contained" | "granted-missing" | "outside";

type MentionState = "found" | "recovered" | "ambiguous" | "missing" | "gated";

/** Result of the tagged pipeline. `resolved` is `null` for `ambiguous` and `missing`. */
export interface TaggedMention {
  state: MentionState;
  resolved: string | null;
  kind?: MentionKind | "fuzzy";
  /** Present when recovery (not the plain exact lookup) produced the answer. */
  via?: "tool-dir" | "fuzzy";
  /** `ambiguous` only: up to 10 on-disk paths (tool-dir candidate first). */
  candidates?: string[];
  /** `gated` only (containment failed; never statted). */
  outside?: true;
}

export interface ResolveMentionOptions {
  cwd: string;
  /** Admitted canonical cwd, when it differs from `cwd`: an additional containment anchor. */
  canonCwd?: string;
  /** Producing tool's working directory (untrusted; relative to `cwd` or absolute). Honoured only with `recover`. */
  toolCwd?: string;
  /** Worktree re-rooted spelling of `mention` (untrusted). Tried first; falls through when it does not resolve. */
  reRooted?: string;
  /** Opt into the tool directory and the fuzzy fallback. */
  recover?: boolean;
  /** Test seam; defaults to the process-wide index. */
  fuzzyIndex?: MentionFuzzyIndex;
  /** Optional tally of `fs.stat` calls (request observability, design D14); shared across a batch. */
  counters?: { stats: number };
  /**
   * Optional per-request containment memo, keyed by candidate path. Shared across the items of ONE batch request
   * (same anchors), so a repeated tool directory or candidate is judged once. Never outlives the request.
   */
  containmentMemo?: Map<string, Promise<Containment>>;
}

interface Ctx {
  anchors: string[];
  counters?: { stats: number };
  memo?: Map<string, Promise<Containment>>;
}

/** Maximum candidates reported for an ambiguous mention. */
export const MAX_CANDIDATES = 10;

/** Server-derived `~/.pi` containment anchor. Read at call time (fake-HOME safe). */
function homePiAnchor(): string {
  return path.join(os.homedir(), ".pi");
}

function anchorsFor(cwd: string, canonCwd: string | undefined): string[] {
  return canonCwd !== undefined && canonCwd !== cwd ? [cwd, canonCwd, homePiAnchor()] : [cwd, homePiAnchor()];
}

/** `~/…` → home, absolute → verbatim, otherwise cwd-relative; normalised so `..` is collapsed BEFORE containment. */
function candidateOf(mention: string, cwd: string): { candidate: string; kind: MentionKind } {
  if (mention.startsWith("~/")) return { candidate: path.resolve(path.join(os.homedir(), mention.slice(2))), kind: "tilde" };
  if (path.isAbsolute(mention)) return { candidate: path.resolve(mention), kind: "abs" };
  // A bare `~user/…` reaches here (not `~/`) and is joined to cwd verbatim — it is NEVER expanded to another user's home.
  return { candidate: path.resolve(cwd, mention), kind: "relative" };
}


/**
 * Containment BEFORE stat (design D2). Anchors: cwd + fixed `~/.pi`; git-root widening comes from layer ② of
 * `isAllowed` (via `decidePassive`). Consumes grants; returns no body, so it can never originate a grant (D12).
 * A path under a grant that does not exist is "granted-missing" (like a missing in-cwd file): the grant layer
 * needs a real file, so the nearest existing ancestor is judged. Only already-granted subjects can answer that
 * way, so an ungranted path stays existence-independent.
 */
async function classifyFresh(candidate: string, anchors: string[]): Promise<Containment> {
  if (containmentAllows(await decidePassive(candidate, anchors, { allowGrant: true }), candidate)) return "contained";
  if (!(await dashboardStateRefuses(candidate))) {
    const real = await safeRealpath(candidate);
    if (grantedSubjects().some((subject) => within(real, subject))) return "granted-missing";
  }
  return "outside";
}

function classify(candidate: string, ctx: Ctx): Promise<Containment> {
  if (!ctx.memo) return classifyFresh(candidate, ctx.anchors);
  let hit = ctx.memo.get(candidate);
  if (!hit) {
    hit = classifyFresh(candidate, ctx.anchors);
    ctx.memo.set(candidate, hit);
  }
  return hit;
}

async function exists(p: string, counters?: { stats: number }): Promise<boolean> {
  if (counters) counters.stats++;
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Contained AND on disk; the only way a candidate other than the user's own mention gets stat-ed. */
async function containedAndPresent(candidate: string, ctx: Ctx): Promise<boolean> {
  return (await classify(candidate, ctx)) === "contained" && (await exists(candidate, ctx.counters));
}

/** Step 1: the producing tool's directory. Dir and joined path must both be contained; otherwise skipped silently. */
async function toolDirCandidate(mention: string, toolCwd: string, cwd: string, ctx: Ctx): Promise<string | null> {
  const dir = path.resolve(cwd, toolCwd);
  if ((await classify(dir, ctx)) !== "contained") return null;
  const joined = path.resolve(dir, mention);
  return (await containedAndPresent(joined, ctx)) ? joined : null;
}

/** Step 3: fuzzy fallback over tracked files. Stat budget: the index hands over at most 25 matches. */
async function fuzzy(mention: string, cwd: string, index: MentionFuzzyIndex, ctx: Ctx): Promise<TaggedMention> {
  const missing: TaggedMention = { state: "missing", resolved: null };
  let look: Awaited<ReturnType<MentionFuzzyIndex["lookup"]>>;
  try {
    look = await index.lookup(cwd, mention);
  } catch {
    return missing;
  }
  if (look.status !== "ok" || look.total === 0) return missing;

  if (look.total === 1) {
    const only = look.matches[0];
    return (await containedAndPresent(only, ctx))
      ? { state: "recovered", resolved: only, kind: "fuzzy", via: "fuzzy" }
      : missing;
  }
  // Several tracked matches: never auto-select, even when exactly one is on disk. Checked in chunks of
  // MAX_CANDIDATES (concurrent within a chunk) until enough are on disk; at most MAX_MATCHES stats overall.
  const onDisk: string[] = [];
  for (let i = 0; i < look.matches.length && onDisk.length < MAX_CANDIDATES; i += MAX_CANDIDATES) {
    const chunk = look.matches.slice(i, i + MAX_CANDIDATES);
    const present = await Promise.all(chunk.map((match) => containedAndPresent(match, ctx)));
    chunk.forEach((match, j) => {
      if (present[j] && onDisk.length < MAX_CANDIDATES) onDisk.push(match);
    });
  }
  return onDisk.length > 0 ? { state: "ambiguous", resolved: null, candidates: onDisk } : missing;
}

/**
 * Resolve `mention` through the tagged pipeline. Never throws for a bad mention; `cwd` must already be admitted.
 * Without `recover`, the result is exactly the exact-only lookup (`found | gated | missing`).
 */
export async function resolveMentionTagged(mention: string, opts: ResolveMentionOptions): Promise<TaggedMention> {
  const { cwd, canonCwd, toolCwd, reRooted, recover = false } = opts;
  const missing: TaggedMention = { state: "missing", resolved: null };
  if (!mention) return missing;
  const ctx: Ctx = { anchors: anchorsFor(cwd, canonCwd), counters: opts.counters, memo: opts.containmentMemo };

  // 0. Worktree re-root: same containment as the mention; an out-of-scope / absent copy falls through silently.
  if (reRooted) {
    const rr = candidateOf(reRooted, cwd);
    if (await containedAndPresent(rr.candidate, ctx)) return { state: "found", resolved: rr.candidate, kind: rr.kind };
  }

  const exact = candidateOf(mention, cwd);

  // 1. Producing tool's directory (relative mentions only) and
  // 2. exact, evaluated side by side. A containment failure on the user's own mention is `gated`: no stat,
  //    independent of existence.
  const [toolHit, containment] = await Promise.all([
    recover && toolCwd && exact.kind === "relative" ? toolDirCandidate(mention, toolCwd, cwd, ctx) : null,
    classify(exact.candidate, ctx),
  ]);
  const exactHit = containment === "contained" && (await exists(exact.candidate, ctx.counters));

  if (toolHit && exactHit) {
    const [a, b] = await Promise.all([safeRealpath(toolHit), safeRealpath(exact.candidate)]);
    if (a === b) return { state: "found", resolved: exact.candidate, kind: exact.kind };
    return { state: "ambiguous", resolved: null, candidates: [toolHit, exact.candidate] };
  }
  if (toolHit) return { state: "found", resolved: toolHit, kind: "relative", via: "tool-dir" };
  if (exactHit) return { state: "found", resolved: exact.candidate, kind: exact.kind };
  if (containment === "outside") return { state: "gated", resolved: exact.candidate, kind: exact.kind, outside: true };

  // 3. Fuzzy fallback (opt-in).
  if (recover) return fuzzy(mention, cwd, opts.fuzzyIndex ?? getMentionFuzzyIndex(), ctx);
  return missing;
}

/**
 * Resolve `mention` to an existing in-scope absolute path, an `outside` candidate (containment failed, no stat), or null. `canonCwd` (the admitted
 * canonical cwd, when it differs from `cwd`) is an additional containment anchor.
 *
 * Candidate + kind:
 *   - leading `~/`         → `<homedir>/…`      kind `tilde`
 *   - absolute             → verbatim           kind `abs`
 *   - otherwise            → `resolve(cwd, …)`   kind `relative`
 * The candidate is normalized (`..` collapsed) BEFORE containment, so a tilde
 * traversal (`~/../../etc/passwd`) is rejected by the gate, not statted.
 */
export async function resolveFileMention(
  mention: string,
  { cwd, canonCwd }: { cwd: string; canonCwd?: string },
): Promise<ResolvedMention | null> {
  const r = await resolveMentionTagged(mention, { cwd, canonCwd });
  if (r.state === "gated") return { resolved: r.resolved as string, kind: r.kind as MentionKind, outside: true };
  if (r.state === "found") return { resolved: r.resolved as string, kind: r.kind as MentionKind };
  return null;
}
