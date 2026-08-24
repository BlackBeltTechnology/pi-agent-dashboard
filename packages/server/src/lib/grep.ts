/**
 * Content search engine for `GET /api/grep`. Prefers `ripgrep` (fast, honours
 * `.gitignore`, native regexp); falls back to a bounded in-process scan when
 * `rg` is absent. Both return ranked `{ path, line, col, snippet }[]` with caps
 * on files, bytes per file, and total matches to bound response size.
 *
 * See change: split-editor-workspace.
 */

import { execFile } from "node:child_process"; // ban:child_process-ok rg spawn; needs promisify({stdout,stderr}) shape
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Best-effort `.gitignore` pruning for the JS fallback. Mirrors the bridge
// `searchFiles` matcher (`packages/extension/src/command-handler.ts`) — kept
// inline rather than shared because the worktree resolves the shared package
// to the main checkout. See change: split-editor-workspace.
function gitignoreToRegex(pattern: string): RegExp | null {
  let p = pattern.trim();
  if (!p || p.startsWith("#") || p.startsWith("!")) return null;
  const anchored = p.startsWith("/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return null;
  const esc = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  const hasSlash = p.includes("/");
  try {
    const body = anchored || hasSlash ? `^${esc}(/|$)` : `(^|/)${esc}(/|$)`;
    return new RegExp(body, "i");
  } catch {
    return null;
  }
}

function loadGitignoreMatcher(cwd: string): (relPath: string) => boolean {
  let regexes: RegExp[] = [];
  try {
    const raw = readFileSync(join(cwd, ".gitignore"), "utf-8");
    regexes = raw
      .split(/\r?\n/)
      .map((l) => gitignoreToRegex(l))
      .filter((r): r is RegExp => r !== null);
  } catch {
    return () => false;
  }
  return (relPath: string) => regexes.some((re) => re.test(relPath));
}

export interface GrepMatch {
  /** Path relative to the search cwd (slash-normalised). */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match start. */
  col: number;
  /** Trimmed, length-capped line text. */
  snippet: string;
}

export interface GrepOptions {
  regex?: boolean;
  maxMatches?: number;
  maxFiles?: number;
  maxFileBytes?: number;
}

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "__pycache__", ".venv"]);
// Internal default; no importer outside this module.
// See change: fix-spawn-correlation-ttl-coupling (knip ratchet).
const DEFAULT_MAX_MATCHES = 500;
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const SNIPPET_MAX = 240;
const MAX_DEPTH = 24;
// Cap the per-line input fed to a user-supplied regexp so a pathological
// pattern (catastrophic backtracking / ReDoS) on a very long line — e.g. a
// minified bundle — cannot stall the event loop. The endpoint is reachable
// over a tunnel, so this bounds worst-case work per line. rg (the primary
// path) uses a linear engine and is unaffected.
const REGEX_LINE_CAP = 2000;
const RG_TIMEOUT_MS = 10_000;
const RG_MAX_BUFFER = 16 * 1024 * 1024;

const trimSnippet = (text: string): string => text.trim().slice(0, SNIPPET_MAX);

/**
 * Parse `rg --json` NDJSON stdout into matches. Only `type: "match"` records
 * contribute; malformed lines are skipped. `col`/`line` are normalised to
 * 1-based. Paths are made cwd-relative + slash-normalised.
 */
interface RgRecord {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    submatches?: Array<{ start?: number }>;
    lines?: { text?: string };
  };
}

export function parseRipgrepJson(stdout: string, cwd: string): GrepMatch[] {
  const out: GrepMatch[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let rec: RgRecord;
    try {
      rec = JSON.parse(line) as RgRecord;
    } catch {
      continue;
    }
    if (rec.type !== "match" || !rec.data) continue;
    const d = rec.data;
    const text: string = d.path?.text ?? "";
    if (!text) continue;
    const relPath = relative(cwd, text).replace(/\\/g, "/") || text;
    const lineNo: number = typeof d.line_number === "number" ? d.line_number : 0;
    // rg submatch `start` is a 0-based byte offset into the line.
    const start: number = d.submatches?.[0]?.start ?? 0;
    const lineText: string = d.lines?.text ?? "";
    out.push({ path: relPath, line: lineNo, col: start + 1, snippet: trimSnippet(lineText) });
  }
  return out;
}

/** Run a content search via `rg`. Resolves `[]` on "no matches" (exit 1). */
export async function grepWithRipgrep(
  rgPath: string,
  cwd: string,
  query: string,
  opts: GrepOptions = {},
): Promise<GrepMatch[]> {
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  // `-e <query>` binds the pattern as a flag value so a query starting with `-`
  // is never misparsed as an rg flag. `--fixed-strings` makes it literal.
  const args = [
    "--json",
    "--line-number",
    "--column",
    ...(opts.regex ? [] : ["--fixed-strings"]),
    "-e",
    query,
    "--",
    ".",
  ];
  try {
    const { stdout } = await execFileAsync(rgPath, args, {
      cwd,
      timeout: RG_TIMEOUT_MS,
      maxBuffer: RG_MAX_BUFFER,
    });
    return parseRipgrepJson(stdout, cwd).slice(0, maxMatches);
  } catch (err: unknown) {
    const e = err as { code?: number | string; stdout?: string };
    // rg exits 1 when there are no matches — not an error.
    if (e && (e.code === 1 || e.code === "1")) {
      return parseRipgrepJson(e.stdout ?? "", cwd).slice(0, maxMatches);
    }
    throw err;
  }
}

/**
 * Bounded in-process content scan (used when `rg` is absent). BFS-walks `cwd`,
 * skipping `IGNORE_DIRS` + `.gitignore`, reading up to `maxFileBytes` per file,
 * and collecting up to `maxMatches` line matches across up to `maxFiles` files.
 * Invalid regexp degrades to a literal substring search.
 */
export function grepWithJsScan(cwd: string, query: string, opts: GrepOptions = {}): GrepMatch[] {
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!query) return [];

  let re: RegExp | null = null;
  if (opts.regex) {
    try {
      re = new RegExp(query, "i");
    } catch {
      re = null; // invalid pattern → literal substring
    }
  }
  const needle = query.toLowerCase();
  const isIgnored = loadGitignoreMatcher(cwd);
  const matches: GrepMatch[] = [];
  let filesScanned = 0;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0 && matches.length < maxMatches && filesScanned < maxFiles) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (matches.length >= maxMatches || filesScanned >= maxFiles) break;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full).replace(/\\/g, "/");
      if (isIgnored(rel)) continue;
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned++;
      let body: string;
      try {
        body = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      if (body.length > maxFileBytes) body = body.slice(0, maxFileBytes);
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) break;
        const lineText = lines[i];
        let col = -1;
        if (re) {
          re.lastIndex = 0;
          const m = re.exec(lineText.length > REGEX_LINE_CAP ? lineText.slice(0, REGEX_LINE_CAP) : lineText);
          if (m) col = m.index;
        } else {
          col = lineText.toLowerCase().indexOf(needle);
        }
        if (col >= 0) {
          matches.push({ path: rel, line: i + 1, col: col + 1, snippet: trimSnippet(lineText) });
        }
      }
    }
  }
  return matches;
}

/** Run a content search, preferring `rg` when `rgPath` is set, else JS scan. */
export async function runGrep(
  cwd: string,
  query: string,
  opts: GrepOptions & { rgPath?: string | null } = {},
): Promise<GrepMatch[]> {
  const { rgPath, ...grepOpts } = opts;
  if (rgPath) {
    try {
      return await grepWithRipgrep(rgPath, cwd, query, grepOpts);
    } catch {
      // rg failed (spawn / parse) — degrade to the JS scan rather than erroring.
      return grepWithJsScan(cwd, query, grepOpts);
    }
  }
  return grepWithJsScan(cwd, query, grepOpts);
}
