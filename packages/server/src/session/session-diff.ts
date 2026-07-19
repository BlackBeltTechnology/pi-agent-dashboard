/**
 * Session diff extraction — scans session events for file changes
 * and optionally enriches with git diffs.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, sep as pathSep, relative, resolve } from "node:path";
import type { EditOperation, FileChangeEvent, FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { djb2, type SessionDiffCache } from "./session-diff-cache.js";

const MAX_MESSAGE_LENGTH = 120;

/** Byte cap above which a tool-detected new file gets no synthetic text diff. */
export const SYNTHETIC_DIFF_MAX_BYTES = 256 * 1024;
/**
 * Byte cap on a tracked file's batched content diff. A tracked change whose
 * unified-diff chunk exceeds this is listed with numstat counts but no text
 * `gitDiff` (analogous to `SYNTHETIC_DIFF_MAX_BYTES` for new files). Guards
 * against feeding a multi-hundred-MB blob's diff to the client. See change:
 * fix-session-diff-eventloop-block.
 */
export const TRACKED_DIFF_MAX_BYTES = 5 * 1024 * 1024;
/** Hard cap on the produced changed-file list (Write/Edit entries take precedence). */
export const MAX_FILES = 200;
/** Slack (ms) absorbing fs/event clock jitter when matching mtime to a Bash window. */
const MTIME_SLACK_MS = 1000;

const WRITE_EDIT_TOOLS = new Set(["write", "edit"]);

/** Extensions treated as binary without reading the file. */
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff",
  ".pdf", ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt",
  ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm", ".class", ".o", ".a",
]);

/**
 * Extract file change events from session events.
 * Scans tool_execution_start events for Write/Edit tools,
 * groups by file path, and includes preceding assistant message as context.
 */
export function extractFileChanges(events: DashboardEvent[], cwd: string): FileDiffEntry[] {
  const fileMap = new Map<string, FileChangeEvent[]>();
  let lastAssistantMessage: string | undefined;

  for (const event of events) {
    // Track most recent assistant message for context
    if (event.eventType === "message_end") {
      const msg = event.data.message as any;
      if (msg?.role === "assistant") {
        const content = Array.isArray(msg.content)
          ? msg.content
              .filter((c: any) => c?.type === "text")
              .map((c: any) => c.text)
              .join("")
          : typeof msg.content === "string" ? msg.content : "";
        if (content) {
          lastAssistantMessage = content.length > MAX_MESSAGE_LENGTH
            ? content.slice(0, MAX_MESSAGE_LENGTH) + "..."
            : content;
        }
      }
    }

    if (event.eventType !== "tool_execution_start") continue;

    const toolName = (event.data.toolName as string || "").toLowerCase();
    if (!WRITE_EDIT_TOOLS.has(toolName)) continue;

    const args = event.data.args as Record<string, unknown> | undefined;
    if (!args) continue;

    const rawPath = (args.path || args.file_path) as string | undefined;
    if (!rawPath) continue;

    // In-cwd → relative posix key (enriched). Out-of-cwd → absolute key,
    // carried payload-only (no fs/git enrichment). See change:
    // opt-in-out-of-cwd-session-diffs.
    const filePath = resolvePathKey(rawPath, cwd).key;

    const toolCallId = event.data.toolCallId as string | undefined;
    const changeEvent: FileChangeEvent = {
      type: toolName === "write" ? "write" : "edit",
      timestamp: event.timestamp,
      message: lastAssistantMessage,
      ...(toolCallId ? { toolCallId } : {}),
    };

    // Detect in-memory truncation (memory-event-store caps strings at ~4 KB
    // with a `…[truncated]` marker and collapses `edits` arrays >20 to the
    // string `"[array truncated]"`). Flag it so the client lazy-fetches the
    // full payload from the JSONL. See change: opt-in-out-of-cwd-session-diffs.
    if (toolName === "write") {
      const c = args.content;
      changeEvent.content = typeof c === "string" ? c : undefined;
      if (typeof c === "string" && c.endsWith("…[truncated]")) changeEvent.truncated = true;
    } else {
      const e = args.edits;
      if (Array.isArray(e)) changeEvent.edits = e as EditOperation[];
      else if (e === "[array truncated]") changeEvent.truncated = true;
    }

    const existing = fileMap.get(filePath);
    if (existing) {
      existing.push(changeEvent);
    } else {
      fileMap.set(filePath, [changeEvent]);
    }
  }

  // Build result, sorted by path, changes sorted by timestamp
  const result: FileDiffEntry[] = [];
  for (const [path, changes] of fileMap) {
    changes.sort((a, b) => a.timestamp - b.timestamp);
    result.push({ path, changes });
  }
  result.sort((a, b) => a.path.localeCompare(b.path));

  return result;
}

/**
 * Resolve a Write/Edit raw path to its changed-file key.
 *
 * In-cwd → a cwd-relative posix key (`outOfCwd: false`), the enriched key
 * space shared with git-status detection. Out-of-cwd → the absolute path
 * itself (`outOfCwd: true`), carried payload-only and NEVER passed to git/fs
 * enrichment (the read channel the doubt-review closed). `isAbsolute(key)`
 * reliably re-derives `outOfCwd` downstream (in-cwd keys are always relative).
 * See change: opt-in-out-of-cwd-session-diffs.
 */
export function resolvePathKey(rawPath: string, cwd: string): { key: string; outOfCwd: boolean } {
  const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  const rel = relative(cwd, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { key: absPath, outOfCwd: true };
  }
  // Normalize to posix separators (shared with git-diff headers / client URLs).
  const key = pathSep === "/" ? rel : rel.split(pathSep).join("/");
  return { key, outOfCwd: false };
}

/**
 * Normalize a file path relative to cwd.
 * Returns null if the path is outside cwd.
 */
function normalizePath(rawPath: string, cwd: string): string | null {
  const { key, outOfCwd } = resolvePathKey(rawPath, cwd);
  return outOfCwd ? null : key;
}

// ── Detection: git-status porcelain parser ──────────────────────────────

/**
 * C-unquote a porcelain path. git wraps paths with special chars in double
 * quotes and backslash-escapes them (e.g. `"dir with\ttab/f.txt"`). Plain
 * (unquoted) paths pass through unchanged.
 */
function unquotePorcelainPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = inner[++i];
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case '"': out += '"'; break;
      case "\\": out += "\\"; break;
      default: out += next ?? ""; break;
    }
  }
  return out;
}

/**
 * Paths never worth surfacing as session-created files even when a repo's
 * `.gitignore` fails to exclude them: `node_modules/` deps + `.git/` internals.
 * Guards against a flood of build/cache junk (e.g. jiti cache) swamping the
 * Files panel and evicting real files via the MAX_FILES cap. See change:
 * detect-tool-created-files.
 */
function isNoisePath(key: string): boolean {
  return /(^|\/)(node_modules|\.git)\//.test(key);
}

export interface PorcelainDetection {
  /** Normalized (cwd-relative, posix), in-cwd paths of new/modified files. */
  paths: Set<string>;
  /** Subset of `paths` that git reports as untracked (`??`). */
  untracked: Set<string>;
}

/**
 * Dedicated `git status --porcelain` parser (NOT `getDirtyFiles` `slice(3)`):
 * C-unquotes paths, resolves rename/copy `R/C old -> new` to the NEW path,
 * skips deletions (out of scope), then resolves each to abs and runs the SAME
 * `normalizePath(abs, cwd)` as Write/Edit — guaranteeing one shared key space
 * and cwd containment (out-of-cwd entries dropped).
 */
export function parsePorcelain(raw: string, cwd: string): PorcelainDetection {
  const paths = new Set<string>();
  const untracked = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    // Skip pure deletions (feature is tool-*created* files).
    if (xy === "D " || xy === " D") continue;
    // Rename / copy: `old -> new` (either side may be C-quoted). Take NEW.
    if (xy[0] === "R" || xy[0] === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) rest = rest.slice(arrow + 4);
    }
    const unquoted = unquotePorcelainPath(rest.trim());
    if (!unquoted) continue;
    const key = normalizePath(unquoted, cwd);
    if (!key) continue; // out-of-cwd — dropped (v1 scope)
    if (isNoisePath(key)) continue; // node_modules / .git noise
    paths.add(key);
    if (xy === "??") untracked.add(key);
  }
  return { paths, untracked };
}

// ── Attribution: Bash output-token scan ────────────────────────────────

/** Quote-aware shell-ish tokenizer (single + double quotes). Best-effort. */
function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (has || cur) { tokens.push(cur); cur = ""; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

/**
 * Scan a single Bash command for output-target candidate paths:
 * redirects (`>`, `>>`, `>file`), `-o <p>` / `-o=<p>`,
 * `--output <p>` / `--output=<p>`, and `tee <p>`.
 * Returns RAW candidate strings (pre-normalization).
 */
export function bashOutputCandidates(cmd: string): string[] {
  const tokens = tokenizeCommand(cmd);
  const out: string[] = [];
  let teeActive = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Redirect operators, possibly with the target glued on (`>file`).
    const redir = tok.match(/^\d*(>>|>)(.*)$/);
    if (redir) {
      if (redir[2]) out.push(redir[2]);
      else if (tokens[i + 1]) out.push(tokens[++i]);
      continue;
    }
    if (tok === "-o" || tok === "--output") {
      if (tokens[i + 1]) out.push(tokens[++i]);
      continue;
    }
    const eq = tok.match(/^(?:--output|-o)=(.+)$/);
    if (eq) { out.push(eq[1]); continue; }
    if (tok === "tee") { teeActive = true; continue; }
    if (teeActive) {
      if (tok.startsWith("-")) continue; // tee flag (e.g. -a)
      out.push(tok);
      teeActive = false;
    }
  }
  return out;
}

interface Attribution {
  command: string; // redacted, capped
  timestamp: number;
}

/**
 * Build a normalized-path → attribution map from Bash `tool_execution_start`
 * events. Only in-cwd candidates are keyed (out-of-cwd normalize to null and
 * are never probed). Last-writer-wins by timestamp. Values are redacted +
 * length-capped so `/api/session-diff` never leaks secret shapes.
 */
export function parseBashArtifacts(
  events: DashboardEvent[],
  cwd: string,
): Map<string, Attribution> {
  const map = new Map<string, Attribution>();
  for (const event of events) {
    if (event.eventType !== "tool_execution_start") continue;
    if ((event.data.toolName as string || "").toLowerCase() !== "bash") continue;
    const args = event.data.args as Record<string, unknown> | undefined;
    const cmd = args?.command as string | undefined;
    if (!cmd) continue;
    const redacted = redactCommand(cmd);
    for (const raw of bashOutputCandidates(cmd)) {
      const key = normalizePath(raw, cwd);
      if (!key) continue; // out-of-cwd — never keyed, never probed
      const prev = map.get(key);
      if (!prev || event.timestamp >= prev.timestamp) {
        map.set(key, { command: redacted, timestamp: event.timestamp });
      }
    }
  }
  return map;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /\bgh[posru]_[A-Za-z0-9]+/g,
  /\bsk-[A-Za-z0-9._-]+/g,
  /--pass(?:word)?[= ]\S+/gi,
  /password=\S+/gi,
  /-u\s+\S+:\S+/g,
  /AWS_SECRET\S*=\S+/gi,
  /-p\s*\S{6,}/g,
];

/** Redact known secret shapes and length-cap a command for `producedBy`. */
export function redactCommand(cmd: string): string {
  let out = cmd.trim();
  for (const re of SECRET_PATTERNS) out = out.replace(re, "‹redacted›");
  if (out.length > MAX_MESSAGE_LENGTH) out = `${out.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
  return out;
}

// ── Ownership: Bash execution windows ─────────────────────────────────

export interface BashWindow { start: number; end: number; }

/**
 * Pair Bash `tool_execution_start` with its `tool_execution_end` (by
 * toolCallId) into `[start, end]` windows. A start with no end (still running
 * / dropped) yields `[start, now]`.
 */
export function extractBashWindows(events: DashboardEvent[], now = Date.now()): BashWindow[] {
  const starts = new Map<string, number>();
  const windows: BashWindow[] = [];
  for (const event of events) {
    const toolName = (event.data.toolName as string || "").toLowerCase();
    const id = event.data.toolCallId as string | undefined;
    if (event.eventType === "tool_execution_start" && toolName === "bash" && id) {
      starts.set(id, event.timestamp);
    } else if (event.eventType === "tool_execution_end" && toolName === "bash" && id) {
      const start = starts.get(id);
      if (start !== undefined) {
        windows.push({ start, end: event.timestamp });
        starts.delete(id);
      }
    }
  }
  // Unclosed windows → [start, now].
  for (const start of starts.values()) windows.push({ start, end: now });
  return windows;
}

/** True if `mtimeMs` falls inside any Bash window (± slack). */
function mtimeInWindow(mtimeMs: number, windows: BashWindow[]): boolean {
  return windows.some(
    (w) => mtimeMs >= w.start - MTIME_SLACK_MS && mtimeMs <= w.end + MTIME_SLACK_MS,
  );
}

/** Safe statSync mtime; undefined on any error. */
function safeMtime(absPath: string): number | undefined {
  try {
    return statSync(absPath).mtimeMs;
  } catch {
    return undefined;
  }
}

/** True if the file is binary by extension or NUL-sniff (first 8 KB). */
export function isBinaryFile(absPath: string): boolean {
  if (BINARY_EXTS.has(extname(absPath).toLowerCase())) return true;
  try {
    const buf = readFileSync(absPath);
    const scan = buf.subarray(0, 8192);
    return scan.includes(0);
  } catch {
    return false;
  }
}

/**
 * Parse `git diff --numstat --relative HEAD` into a per-path line-count map.
 * Format per line: `<adds>\t<dels>\t<path>`. Binary rows report `-` for the
 * counts → that path is omitted (never emits a non-numeric value). This is a
 * NEW parser distinct from `parseShortstat` (which parses `--shortstat`
 * summary lines, a different format). See change: add-change-summary-table.
 */
export async function gitNumstat(
  cwd: string,
): Promise<Map<string, { additions: number; deletions: number }>> {
  const map = new Map<string, { additions: number; deletions: number }>();
  let raw: string;
  try {
    raw = await git.numstatOrAsync({ cwd });
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addStr, delStr] = parts;
    // Binary / unmergeable rows report `-` — omit rather than emit NaN.
    if (addStr === "-" || delStr === "-") continue;
    const additions = Number.parseInt(addStr, 10);
    const deletions = Number.parseInt(delStr, 10);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    // Path may itself contain tabs only under -z; here it is the tail join.
    const path = parts.slice(2).join("\t");
    map.set(path, { additions, deletions });
  }
  return map;
}

/**
 * Split a batched `git diff --relative HEAD` patch into a `Map<path, chunk>`.
 * Chunks split on the `diff --git ` header boundary (only ever a header at
 * column 0 — content lines are prefixed by ` `/`+`/`-`). Each chunk's NEW path
 * is derived from `+++ b/<path>` (preferred), else `rename to <path>`, else the
 * header's `b/<path>` token — mirroring the cwd-relative posix keys used by
 * `gitNumstat` and `parsePorcelain` (rename → NEW path). See change:
 * fix-session-diff-eventloop-block.
 */
export function splitBatchedDiff(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const chunk of raw.split(/(?=^diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const path = batchedDiffNewPath(chunk);
    if (path) map.set(path, chunk.replace(/\n+$/, ""));
  }
  return map;
}

/** Derive the NEW path a batched-diff chunk describes (see `splitBatchedDiff`). */
function batchedDiffNewPath(chunk: string): string | undefined {
  const lines = chunk.split("\n");
  let renameTo: string | undefined;
  for (const line of lines) {
    if (line.startsWith("+++ b/")) return line.slice(6).replace(/\t.*$/, "") || undefined;
    if (line.startsWith("rename to ")) renameTo = line.slice(10).trim();
  }
  if (renameTo) return renameTo;
  const m = lines[0]?.match(/^diff --git a\/(.+) b\/(.+)$/);
  return m ? m[2] : undefined;
}

/** A batched-diff chunk git rendered as "Binary files … differ" (no text hunk). */
function isBinaryDiffChunk(chunk: string): boolean {
  return /^Binary files .* differ$/m.test(chunk);
}

/**
 * True when a tracked file's batched-diff chunk is safe to render as text:
 * non-empty, under the size cap, and not a binary marker. Over-cap / binary
 * chunks are surfaced with numstat counts only (no `gitDiff`). See change:
 * fix-session-diff-eventloop-block.
 */
export function isRenderableTrackedDiff(chunk: string): boolean {
  if (chunk.length > TRACKED_DIFF_MAX_BYTES) return false;
  if (isBinaryDiffChunk(chunk)) return false;
  return chunk.trim().length > 0;
}

/**
 * Enrich file entries with git diff output (async, event-loop-safe).
 * Runs ONE batched `git diff --relative HEAD` over the worktree (split per
 * file), plus one `git diff --numstat --relative HEAD` for per-file / aggregate
 * line counts — both via `runAsync` (no `spawnSync` on the request path).
 * Tracked chunks over `TRACKED_DIFF_MAX_BYTES` or binary are listed with counts
 * but no `gitDiff`. Untracked new files keep the synthetic `readFileSync` path.
 * Returns gracefully on any git errors. See change:
 * fix-session-diff-eventloop-block.
 */
/**
 * Shared git enrichment context: the result of the (async) git spawns run ONCE
 * for a request — the whole-worktree numstat map, the ONE batched content-diff
 * map, and the untracked set. `buildSessionDiff` builds this once and enriches
 * BOTH owned + other file lists from it, so the batched `git diff` / numstat run
 * once per request, not once per list. See change: fix-session-diff-eventloop-block.
 */
interface GitEnrichmentContext {
  isGitRepo: boolean;
  numstatMap: Map<string, { additions: number; deletions: number }>;
  diffMap: Map<string, string>;
  untracked: Set<string>;
}

/** Run the async git spawns ONCE, producing a reusable `GitEnrichmentContext`. */
export async function buildGitEnrichmentContext(
  cwd: string,
  opts?: { untracked?: Set<string> },
): Promise<GitEnrichmentContext> {
  const empty: GitEnrichmentContext = {
    isGitRepo: false,
    numstatMap: new Map(),
    diffMap: new Map(),
    untracked: new Set(),
  };
  if (!(await git.isGitRepoOrAsync({ cwd }))) return empty;
  const numstatMap = await gitNumstat(cwd);
  // ONE batched content diff for the whole worktree (was O(files) spawns).
  const diffMap = splitBatchedDiff(await git.diffAllOr({ cwd }));
  // Untracked set: threaded from bulk porcelain when provided, else one async
  // porcelain probe (never a per-file sync `git status`).
  const untracked =
    opts?.untracked ?? parsePorcelain(await git.statusPorcelainOrAsync({ cwd }), cwd).untracked;
  return { isGitRepo: true, numstatMap, diffMap, untracked };
}

/**
 * Enrich a file list from a pre-built `GitEnrichmentContext` (pure/sync — no git
 * spawns). Totals are computed over THIS list only (owned totals stay owned).
 */
export function enrichFilesWithContext(
  cwd: string,
  files: FileDiffEntry[],
  ctx: GitEnrichmentContext,
): { enrichedFiles: FileDiffEntry[]; totalAdditions?: number; totalDeletions?: number } {
  if (!ctx.isGitRepo) return { enrichedFiles: files };
  const { numstatMap, diffMap, untracked } = ctx;
  let totalAdditions = 0;
  let totalDeletions = 0;
  let anyCounts = false;

  const enriched = files.map((file) => {
    const counts = numstatMap.get(file.path);
    if (counts) {
      totalAdditions += counts.additions;
      totalDeletions += counts.deletions;
      anyCounts = true;
    }
    const withCounts: FileDiffEntry = counts
      ? { ...file, additions: counts.additions, deletions: counts.deletions }
      : file;
    try {
      // Tracked change → look up its section of the ONE batched diff.
      const chunk = diffMap.get(file.path);
      if (chunk !== undefined) {
        return isRenderableTrackedDiff(chunk) ? { ...withCounts, gitDiff: chunk.trim() } : withCounts;
      }

      // Not in the batched diff → untracked (new) file. `git diff HEAD` never
      // lists untracked files, so keep the synthetic `readFileSync` path.
      const isUntracked = untracked.has(file.path);

      if (isUntracked) {
        // Untracked or newly added — generate synthetic diff.
        const absPath = resolve(cwd, file.path);
        if (!existsSync(absPath)) {
          return withCounts;
        }
        // Binary + size safety BEFORE any utf-8 read (Decision 4). A generated
        // PNG / oversized file is listed with no text gitDiff (rendered via the
        // image/preview dispatch). Extension check first avoids reading binaries.
        try {
          if (statSync(absPath).size > SYNTHETIC_DIFF_MAX_BYTES) return withCounts;
        } catch {
          return withCounts;
        }
        if (isBinaryFile(absPath)) return withCounts;
        // Read via fs.readFileSync rather than `cat` for cross-platform
        // support (Windows has no `cat`). See change: fix-windows-server-parity.
        const content = readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        const diffLines = [
          `diff --git a/${file.path} b/${file.path}`,
          "new file mode 100644",
          `--- /dev/null`,
          `+++ b/${file.path}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((l) => `+${l}`),
        ];
        return { ...withCounts, gitDiff: diffLines.join("\n") };
      }

      return withCounts;
    } catch {
      return withCounts;
    }
  });

  return {
    enrichedFiles: enriched,
    totalAdditions: anyCounts ? totalAdditions : undefined,
    totalDeletions: anyCounts ? totalDeletions : undefined,
  };
}

export async function enrichWithGitDiff(
  cwd: string,
  files: FileDiffEntry[],
  opts?: { untracked?: Set<string> },
): Promise<{
  enrichedFiles: FileDiffEntry[];
  isGitRepo: boolean;
  totalAdditions?: number;
  totalDeletions?: number;
}> {
  const ctx = await buildGitEnrichmentContext(cwd, opts);
  const { enrichedFiles, totalAdditions, totalDeletions } = enrichFilesWithContext(cwd, files, ctx);
  return { enrichedFiles, isGitRepo: ctx.isGitRepo, totalAdditions, totalDeletions };
}

// ── Unified dispatcher ──────────────────────────────────────────────────

export interface VcsEnrichmentResult {
  enrichedFiles: FileDiffEntry[];
  isGitRepo: boolean;
  vcsKind?: "git";
  diffBase?: string;
  baseLabel?: string;
  totalAdditions?: number;
  totalDeletions?: number;
}

/**
 * Dispatcher over git diff enrichment. Wraps `enrichWithGitDiff` and
 * annotates the response with `vcsKind`/`diffBase`/`baseLabel` (optional
 * fields older clients ignore).
 */
export async function enrichWithVcsDiff(
  cwd: string,
  files: FileDiffEntry[],
): Promise<VcsEnrichmentResult> {
  const result = await enrichWithGitDiff(cwd, files);
  return {
    ...result,
    vcsKind: result.isGitRepo ? "git" : undefined,
    diffBase: result.isGitRepo ? "HEAD" : undefined,
    baseLabel: result.isGitRepo ? "HEAD" : undefined,
  };
}

// ── Full session-diff orchestrator (detect + attribute + own + compose) ─────

export interface SessionDiffResult {
  files: FileDiffEntry[];
  otherChanges: FileDiffEntry[];
  isGitRepo: boolean;
  vcsKind?: "git";
  diffBase?: string;
  baseLabel?: string;
  totalAdditions?: number;
  totalDeletions?: number;
}

async function safeIsGitRepo(cwd: string): Promise<boolean> {
  try {
    return await git.isGitRepoOrAsync({ cwd });
  } catch {
    return false;
  }
}

/**
 * Build the full changed-file list for `/api/session-diff`:
 *   1. Write/Edit events (`extractFileChanges`).
 *   2. Detect on-disk files: git-status porcelain (git) OR Bash-token +
 *      in-cwd existsSync (non-git).
 *   3. Attribute detected files to the Bash command that produced them.
 *   4. Compose with precedence — mixed when both, no synthetic ghost event.
 *   5. Session-ownership gate — owned → `files`, else → `otherChanges`.
 *   6. Cap at MAX_FILES (Write/Edit precedence), then enrich (binary-safe).
 *
 * Async + event-loop-safe: every git spawn on this path is non-blocking
 * (`runAsync`). `opts` lets a caller thread already-fetched `gitRepo` /
 * `porcelainRaw` (e.g. from the cache-key computation) so they are not
 * re-spawned. See change: fix-session-diff-eventloop-block.
 */
export async function buildSessionDiff(
  events: DashboardEvent[],
  cwd: string,
  opts?: { gitRepo?: boolean; porcelainRaw?: string },
): Promise<SessionDiffResult> {
  const gitRepo = opts?.gitRepo ?? (await safeIsGitRepo(cwd));
  const allWriteEdit = extractFileChanges(events, cwd);
  // SECURITY (E3): out-of-cwd Write/Edit entries are keyed by absolute path and
  // carried PAYLOAD-ONLY. They are split out BEFORE enrichment so an out-of-cwd
  // absolute key can never reach `enrichWithGitDiff`'s untracked branch, whose
  // `readFileSync(resolve(cwd, path))` would resolve `resolve(cwd, "/abs")` to
  // the file itself → a disk read of an out-of-cwd path. The doubt-review closed
  // exactly this channel. See change: opt-in-out-of-cwd-session-diffs.
  const writeEdit = allWriteEdit.filter((f) => !isAbsolute(f.path));
  const outOfCwd = allWriteEdit.filter((f) => isAbsolute(f.path));
  const writeEditPaths = new Set(writeEdit.map((f) => f.path));
  const attribution = parseBashArtifacts(events, cwd);
  const windows = extractBashWindows(events);

  // ─ Detection ─
  let detected = new Set<string>();
  let untracked: Set<string> | undefined;
  let detectedVia: "git-status" | "bash-artifact";
  if (gitRepo) {
    const porcelainRaw = opts?.porcelainRaw ?? (await git.statusPorcelainOrAsync({ cwd }));
    const porcelain = parsePorcelain(porcelainRaw, cwd);
    detected = porcelain.paths;
    untracked = porcelain.untracked;
    detectedVia = "git-status";
  } else {
    detectedVia = "bash-artifact";
    for (const key of attribution.keys()) {
      if (isNoisePath(key)) continue; // node_modules / .git noise
      // In-cwd existence probe only (key is already cwd-contained — no oracle).
      if (existsSync(resolve(cwd, key))) detected.add(key);
    }
  }

  // ─ Compose ─
  const entryMap = new Map<string, FileDiffEntry>();
  for (const f of writeEdit) {
    const hasWrite = f.changes.some((c) => c.type === "write");
    const attr = attribution.get(f.path);
    entryMap.set(f.path, {
      ...f,
      origin: detected.has(f.path) ? "mixed" : hasWrite ? "write" : "edit",
      ...(attr ? { producedBy: attr.command } : {}),
      ...(detected.has(f.path) ? { detectedVia } : {}),
    });
  }
  for (const key of detected) {
    if (writeEditPaths.has(key)) continue; // handled above (mixed)
    const attr = attribution.get(key);
    const ts = attr?.timestamp ?? safeMtime(resolve(cwd, key)) ?? Date.now();
    entryMap.set(key, {
      path: key,
      changes: [{ type: "tool", timestamp: ts, ...(attr ? { message: attr.command } : {}) }],
      origin: "tool",
      detectedVia,
      ...(attr ? { producedBy: attr.command } : {}),
    });
  }

  // ─ Ownership gate ─
  const owned: FileDiffEntry[] = [];
  const other: FileDiffEntry[] = [];
  for (const entry of entryMap.values()) {
    const hasRealEvent = writeEditPaths.has(entry.path);
    const attributed = attribution.has(entry.path);
    const inWindow = (() => {
      if (hasRealEvent || attributed) return false; // already owned; skip stat
      const mtime = safeMtime(resolve(cwd, entry.path));
      return mtime !== undefined && mtimeInWindow(mtime, windows);
    })();
    if (hasRealEvent || attributed || inWindow) {
      owned.push({ ...entry, sessionOwned: true, previewable: true });
    } else {
      other.push(entry);
    }
  }

  // ─ Cap (Write/Edit precedence) ─
  owned.sort((a, b) => {
    const aReal = writeEditPaths.has(a.path) ? 0 : 1;
    const bReal = writeEditPaths.has(b.path) ? 0 : 1;
    if (aReal !== bReal) return aReal - bReal;
    return a.path.localeCompare(b.path);
  });
  const cappedOwned = owned.slice(0, MAX_FILES);
  cappedOwned.sort((a, b) => a.path.localeCompare(b.path));

  // ─ Enrich (binary-safe; threaded untracked set) — in-cwd ONLY ─
  // ONE git context (numstat + batched diff) shared across owned + other, so
  // the batched `git diff` / numstat run once per request, not once per list.
  const gitCtx = await buildGitEnrichmentContext(cwd, { untracked });
  const enrichedOwned = enrichFilesWithContext(cwd, cappedOwned, gitCtx);
  const enrichedOther = enrichFilesWithContext(cwd, other, gitCtx);

  // ─ Out-of-cwd (payload-only; never enriched, never read/statted) ─
  const outOfCwdEntries: FileDiffEntry[] = outOfCwd.map((f) => {
    const hasWrite = f.changes.some((c) => c.type === "write");
    return {
      ...f,
      origin: hasWrite ? "write" : "edit",
      sessionOwned: true,
      // The File-content view + relative file-tree assume an in-cwd key; both are
      // gated on `previewable` client-side. Out-of-cwd renders payload-only.
      previewable: false,
    };
  });

  return {
    files: [...enrichedOwned.enrichedFiles, ...outOfCwdEntries],
    otherChanges: enrichedOther.enrichedFiles,
    isGitRepo: gitCtx.isGitRepo,
    vcsKind: gitCtx.isGitRepo ? "git" : undefined,
    diffBase: gitCtx.isGitRepo ? "HEAD" : undefined,
    baseLabel: gitCtx.isGitRepo ? "HEAD" : undefined,
    totalAdditions: enrichedOwned.totalAdditions,
    totalDeletions: enrichedOwned.totalDeletions,
  };
}

/**
 * Cache + single-flight wrapper over `buildSessionDiff` for the request path.
 *
 * Computes a cheap cache key up front — `sessionId : HEAD-sha : djb2(porcelain)`
 * — via two non-blocking git spawns, then defers to the `cache`: a fresh
 * entry within TTL returns immediately; concurrent identical requests coalesce
 * onto one in-flight computation. A HEAD sha or dirty-signature change yields a
 * new key → recompute (never serves a stale diff). The fetched `gitRepo` /
 * `porcelainRaw` are threaded into `buildSessionDiff` so detection does not
 * re-spawn them. See change: fix-session-diff-eventloop-block.
 */
export async function buildSessionDiffCached(
  sessionId: string,
  events: DashboardEvent[],
  cwd: string,
  cache: SessionDiffCache<SessionDiffResult>,
): Promise<SessionDiffResult> {
  const gitRepo = await safeIsGitRepo(cwd);
  const headSha = gitRepo ? await git.headShaOrAsync({ cwd }) : undefined;
  const porcelainRaw = gitRepo ? await git.statusPorcelainOrAsync({ cwd }) : "";
  const key = `${sessionId}:${headSha ?? "nogit"}:${djb2(porcelainRaw)}`;
  return cache.run(key, () => buildSessionDiff(events, cwd, { gitRepo, porcelainRaw }));
}
