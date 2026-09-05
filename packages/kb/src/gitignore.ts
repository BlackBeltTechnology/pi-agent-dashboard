// gitignore-honouring walk filter for the kb dox walks + indexer (design D3,
// fix-dox-lint-blind-rows). Best-effort git semantics, case-SENSITIVE:
// bare names, `dir/`, `*.ext`, mid-name globs, `**` (leading/mid/trailing),
// bare `*` + file negations, `!` negation (dir + content + root-level file
// forms), leading-slash anchors. Last-match-wins within a file; a deeper
// `.gitignore` overrides a shallower one. The pattern stack is seeded by an
// up-walk from the walk start to the repo root (`.git` boundary or the project
// cwd), so root-anchored patterns apply from nested walk roots.
// NOT implemented (design Non-Goals): the tracked-file override and character
// classes — brackets are matched literally; an UNbalanced-bracket line is
// skipped without throwing (X2).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export interface GitignoreMatcher {
  /** File candidate: gitignore verdict for a walk-root-relative path. */
  isIgnored(relPath: string): boolean;
  /** Directory candidate: does a pattern match this directory itself? */
  isIgnoredDir(relPath: string): boolean;
  /** True when a `.gitignore` exists at or below this dir — hard-pruning the
   *  dir would blind a deeper negation (design D3 conservative pruning). */
  hasDeeperGitignore(relPath: string): boolean;
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

/** Pure single-pattern test (base = ""): does this gitignore line match the
 *  path? Negation flips the loader's verdict, not the match itself. */
export function patternMatches(rawPattern: string, relPath: string, opts: { dir?: boolean } = {}): boolean {
  const pat = compile(rawPattern);
  if (!pat) return false;
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
  if (dirMode) {
    // A directory candidate matches when the pattern matches the dir path
    // itself (dirOnly or not — a bare name ignores the dir AND its contents).
    return pat.re.test(rel);
  }
  if (pat.dirOnly) return ancestorsOf(rel).some((a) => pat.re!.test(a));
  if (pat.re.test(rel)) return true;
  // Unanchored name also ignores the contents of a matching directory.
  if (!pat.anchored) return ancestorsOf(rel).some((a) => pat.re!.test(a));
  return false;
}

export function loadGitignoreMatcher(walkRoot: string, opts: GitignoreMatcherOptions = {}): GitignoreMatcher {
  const boundary = opts.cwd;
  const sets: { baseAbs: string; patterns: Pattern[] }[] = [];
  const nestedBases: string[] = []; // walk-root-relative dirs holding a .gitignore

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
  //    them, so their patterns could never apply.
  const scan = (dir: string) => {
    const rel = relative(walkRoot, dir).split(sep).join("/");
    if (rel && opts.prune?.(rel)) return;
    if (existsSync(join(dir, ".gitignore"))) {
      parseFile(join(dir, ".gitignore"));
      nestedBases.push(rel);
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && e.name !== ".git") scan(join(dir, e.name));
    }
  };
  scan(walkRoot);

  const verdictFor = (rel: string, dirMode: boolean): boolean => {
    const abs = join(walkRoot, rel);
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
    isIgnored: (rel) => verdictFor(rel, false),
    isIgnoredDir: (rel) => verdictFor(rel, true),
    hasDeeperGitignore: (rel) => nestedBases.some((b) => b === rel || b.startsWith(`${rel}/`)),
  };
}
