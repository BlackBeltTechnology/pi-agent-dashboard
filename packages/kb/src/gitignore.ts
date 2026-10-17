// gitignore-honouring walk filter for the kb dox walks + indexer
// (fix-dox-lint-blind-rows, fix-kb-gitignore-excluded-parent). Best-effort git
// semantics, case-SENSITIVE: bare names, `dir/`, `*.ext`, mid-name globs, `**`
// (leading/mid/trailing), bare `*` + file negations, `!` negation, leading-slash
// anchors. Last-match-wins within a file; a deeper `.gitignore` overrides a
// shallower one. EXCLUDED-PARENT RULE (gitignore(5)): a path is ignored when any
// ancestor directory is ignored — including ancestors above the walk root — and
// no negation can re-include it; a `.gitignore` inside an excluded dir is never
// read. File patterns match the file path only (a dir-only pattern never matches
// a file). The pattern stack is seeded by an up-walk from the walk start to the
// repo root (`.git` boundary or the project cwd), so root-anchored patterns apply
// from nested walk roots.
// NOT implemented (design Non-Goals): the tracked-file override and character
// classes — brackets are matched literally; an UNbalanced-bracket line is
// skipped without throwing (X2).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export interface GitignoreMatcher {
  /** File candidate: gitignore verdict for a walk-root-relative path. */
  isIgnored(relPath: string): boolean;
  /** Directory candidate: is this directory excluded (itself or via an
   *  excluded ancestor)? Walks prune on this alone. */
  isIgnoredDir(relPath: string): boolean;
}

export interface GitignoreMatcherOptions {
  /** Project boundary for the up-walk (usually the cwd the walk serves). The
   *  up-walk stops at a `.git` dir, at `cwd`, or when it would leave the cwd
   *  subtree. Omit to stop at `.git` / fs root only. */
  cwd?: string;
  /** Dirs never descended when collecting nested `.gitignore` files (the
   *  walk's own exclude test, e.g. dox.ts DEFAULT_EXCLUDE). */
  prune?: (relFromWalkRoot: string) => boolean;
}

interface Pattern {
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp | null; // null = malformed line, skipped (X2)
}

/** Pure single-pattern test (base = ""): would a `.gitignore` holding only this
 *  line exclude the path? True when any ancestor dir matches (excluded-parent
 *  rule) or the path itself matches. Negation flips the loader's verdict, not
 *  the match itself. */
export function patternMatches(rawPattern: string, relPath: string, opts: { dir?: boolean } = {}): boolean {
  const pat = compile(rawPattern);
  if (!pat) return false;
  if (ancestorsOf(relPath).some((a) => matches(pat, a, true))) return true;
  return matches(pat, relPath, opts.dir === true);
}

function compile(raw: string): Pattern | null {
  const p0 = raw.replace(/\s+$/, ""); // git trims trailing (unescaped) whitespace
  if (p0 === "" || p0.startsWith("#")) return null;
  let p = p0;
  const negated = p.startsWith("!");
  if (negated) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.replace(/\/+$/, "");
  let anchored: boolean;
  if (p.startsWith("/")) {
    anchored = true;
    p = p.slice(1);
  } else if (p.startsWith("**/")) {
    p = p.slice(3); // `**/foo` matches at any depth ≡ unanchored `foo`
    anchored = false;
  } else {
    anchored = p.includes("/");
  }
  if (p === "" || p === "!") return null;
  // Unbalanced brackets = malformed line (git skips it); balanced brackets are
  // matched literally (no character-class support — pass-through escaping).
  for (const seg of p.split("/")) {
    const open = (seg.match(/\[/g) ?? []).length;
    const close = (seg.match(/\]/g) ?? []).length;
    if (open !== close) return null;
  }
  const segs = p.split("/");
  let body: string;
  if (segs.length === 1 && segs[0] === "**") {
    body = ".+";
  } else {
    body = "";
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1;
      const seg = segs[i];
      if (seg === "**") {
        body += isLast ? ".+" : "(?:[^/]+/)*";
        continue;
      }
      body += segRe(seg);
      if (!isLast) body += "/";
    }
  }
  const full = anchored ? body : `(?:[^/]+/)*${body}`;
  let re: RegExp | null = null;
  try {
    re = new RegExp(`^${full}$`);
  } catch {
    re = null;
  }
  return { negated, dirOnly, anchored, re };
}

function segRe(seg: string): string {
  return seg
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "*") // non-special consecutive asterisks ≡ regular *
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
}

function ancestorsOf(rel: string): string[] {
  const out: string[] = [];
  const parts = rel.split("/");
  parts.pop(); // drop the file name
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    out.push(cur);
  }
  return out;
}

function matches(pat: Pattern, rel: string, dirMode: boolean): boolean {
  if (!pat.re) return false;
  // Directory candidate: the pattern matches the dir path itself (dirOnly or
  // not). File candidate: path only — a dir-only pattern never matches a file;
  // directory exclusion is owned by the excluded-parent rule in `verdictFor`.
  if (dirMode) return pat.re.test(rel);
  return pat.dirOnly ? false : pat.re.test(rel);
}

/** Shared core of the sync and async loaders: seeds the pattern stack, and
 *  exposes the ONE per-directory descend rule (`step`). Only the driver that
 *  calls `step` differs between the loaders, so they cannot drift.
 *  See change: bound-kb-search-freshness. */
function createLoader(walkRoot: string, opts: GitignoreMatcherOptions): { step: (dir: string) => string[]; matcher: GitignoreMatcher } {
  const boundary = opts.cwd;
  const sets: { baseAbs: string; patterns: Pattern[] }[] = [];

  const parseFile = (abs: string) => {
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      return;
    }
    const patterns: Pattern[] = [];
    for (const line of text.split("\n")) {
      const pat = compile(line);
      if (pat) patterns.push(pat);
    }
    if (patterns.length) sets.push({ baseAbs: dirname(abs), patterns });
  };

  // 1. Seed: up-walk from the walk start collecting ancestor .gitignore files,
  //    shallow-most first (stack order = later/deeper overrides earlier).
  const up: string[] = [];
  for (let d = walkRoot; ; d = dirname(d)) {
    up.push(d);
    if (existsSync(join(d, ".git"))) break; // repo root reached
    if (boundary && d === boundary) break; // project boundary reached
    if (boundary && !d.startsWith(boundary + sep)) break; // left the project subtree
    const parent = dirname(d);
    if (parent === d) break; // fs root
  }
  for (const d of up.reverse()) {
    if (d === walkRoot) continue; // walk root's own file comes from the descend phase
    if (existsSync(join(d, ".gitignore"))) parseFile(join(d, ".gitignore"));
  }

  // 2. Descend: nested .gitignore files under the walk root (pre-order =
  //    shallow before deep). Pruned dirs are skipped — the walk never visits
  //    them, so their patterns could never apply. `step` handles ONE directory
  //    and returns the child directories to descend, in sorted order.
  const step = (dir: string): string[] => {
    const rel = relative(walkRoot, dir).split(sep).join("/");
    if (rel && opts.prune?.(rel)) return [];
    if (existsSync(join(dir, ".gitignore"))) {
      parseFile(join(dir, ".gitignore"));
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const children: string[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name === ".git") continue;
      const child = join(dir, e.name);
      // Git never reads a .gitignore inside an excluded dir: test the child
      // BEFORE descending so its own file is never parsed. Perf only — verdicts
      // below an excluded dir short-circuit on the ancestor anyway. Sibling
      // subtrees never affect each other's verdict (their sets sit below it).
      if (dirIgnored(child)) continue;
      children.push(child);
    }
    return children;
  };

  // verdictFor / dirIgnored are declared BEFORE `scan(walkRoot)` runs: `scan`
  // consults them, and a `const` read before its declaration throws a
  // ReferenceError (TDZ) that tsc does not flag.
  const dirMemo = new Map<string, boolean>();
  // Can any loaded set hold a pattern for `abs` (or an ancestor of it)?
  const covered = (abs: string): boolean =>
    sets.some((s) => abs === s.baseAbs || abs.startsWith(s.baseAbs + sep));
  const dirIgnored = (abs: string): boolean => {
    const hit = dirMemo.get(abs);
    if (hit !== undefined) return hit;
    const v = verdictAbs(abs, true);
    dirMemo.set(abs, v);
    return v;
  };
  // Excluded-parent rule first (shallow → deep via memoized recursion), then
  // last-match-wins over the sets based strictly above `abs`.
  const verdictAbs = (abs: string, dirMode: boolean): boolean => {
    const parent = dirname(abs);
    if (parent !== abs && covered(parent) && dirIgnored(parent)) return true;
    let verdict = false;
    for (const set of sets) {
      const baseRel = relative(set.baseAbs, abs);
      if (!baseRel || baseRel.startsWith("..")) continue;
      const p = baseRel.split(sep).join("/");
      for (const pat of set.patterns) {
        if (matches(pat, p, dirMode)) verdict = !pat.negated;
      }
    }
    return verdict;
  };
  return {
    step,
    matcher: {
      isIgnored: (rel) => verdictAbs(join(walkRoot, rel), false),
      isIgnoredDir: (rel) => dirIgnored(join(walkRoot, rel)),
    },
  };
}

export function loadGitignoreMatcher(walkRoot: string, opts: GitignoreMatcherOptions = {}): GitignoreMatcher {
  const { step, matcher } = createLoader(walkRoot, opts);
  const scan = (dir: string) => {
    for (const child of step(dir)) scan(child);
  };
  scan(walkRoot);
  return matcher;
}

export interface YieldingLoaderOptions extends GitignoreMatcherOptions {
  /** Directories processed between yields (indexer's `WALK_YIELD_EVERY`). */
  yieldEvery: number;
  /** The yield itself (indexer's `yieldToEventLoop`; injectable for tests). */
  yieldFn: () => Promise<void>;
}

/** Yielding sibling of `loadGitignoreMatcher`: identical pattern order (explicit
 *  pre-order stack over the shared `step`), but awaits `yieldFn` every
 *  `yieldEvery` directories so a deep tree never pins the event loop. A single
 *  huge directory listing stays one blocking call (design R10). */
export async function loadGitignoreMatcherYielding(walkRoot: string, opts: YieldingLoaderOptions): Promise<GitignoreMatcher> {
  const { step, matcher } = createLoader(walkRoot, opts);
  const stack = [walkRoot];
  let visited = 0;
  while (stack.length) {
    const children = step(stack.pop() as string);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    if (++visited % opts.yieldEvery === 0) await opts.yieldFn();
  }
  return matcher;
}
