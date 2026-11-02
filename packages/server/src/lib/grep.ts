/**
 * Content search engine for `GET /api/grep`. Prefers `ripgrep` (fast, honours
 * `.gitignore`, native regexp); falls back to a bounded in-process scan when
 * `rg` is absent. Both return ranked `{ path, line, col, snippet }[]` with caps
 * on files, bytes per file, and total matches to bound response size.
 *
 * The JS fallback scan runs on a `worker_thread` (`grep-worker.ts`) terminated after
 * `RG_TIMEOUT_MS`, so a catastrophic caller regexp cannot stall the server.
 *
 * See change: split-editor-workspace, triage-codeql-alert-debt (#216).
 */

import { execFile } from "node:child_process"; // ban:child_process-ok rg spawn; needs promisify({stdout,stderr}) shape
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { workerExecArgv } from "../attachments/fit-worker-pool.js";
import { isAgentCredentialFileSync, isDashboardStateDirSync } from "./dashboard-state-guard.js";

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
        // Never walk into the dashboard state dir (token, identity key, config): the route also
        // filters its matches, but a secret should not even be read. See change:
        // close-container-loopback-impersonation (D8).
        if (isDashboardStateDirSync(full)) continue;
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      // Never read a pi-agent credential file (by name; a symlink dirent is not a file and is skipped above).
      // See change: close-security-map-high-findings (D1).
      if (isAgentCredentialFileSync(full)) continue;
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

/** Rejection of a fallback scan that outlived its timeout (the route maps it to 504). */
export class GrepTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`search timed out after ${timeoutMs}ms`);
    this.name = "GrepTimeoutError";
  }
}

/** Test seams for the worker-backed scan. */
interface GrepScanOptions {
  /** Scan timeout in ms. Default `RG_TIMEOUT_MS`. */
  scanTimeoutMs?: number;
  /** Worker entry URL override (tests force a failing entry). Default: sibling `grep-worker.ts`. */
  scanWorkerUrl?: string;
}

/** Message the worker posts back: the scan result, or the error it threw. */
export type GrepWorkerReply = { ok: true; matches: GrepMatch[] } | { ok: false; error: string };

/** What the worker receives through `workerData`. */
export interface GrepWorkerRequest {
  cwd: string;
  query: string;
  opts: GrepOptions;
}

function defaultScanWorkerUrl(): string {
  return pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "grep-worker.ts")).href;
}

/**
 * `grepWithJsScan` on a `worker_thread`, terminated after `scanTimeoutMs`. The caller's
 * pattern is compiled and run only inside the worker, so catastrophic backtracking
 * (`(a+)+$`) cannot stall the server's event loop. Rejects with `GrepTimeoutError` on
 * timeout, or with the worker's error (throw on start, crash, early exit). The worker is
 * always terminated before this settles; never leaves a rejection unhandled.
 */
function grepWithJsScanInWorker(
  cwd: string,
  query: string,
  opts: GrepOptions & GrepScanOptions = {},
): Promise<GrepMatch[]> {
  const { scanTimeoutMs = RG_TIMEOUT_MS, scanWorkerUrl, ...scanOpts } = opts;
  const workerUrl = scanWorkerUrl ?? defaultScanWorkerUrl();
  return new Promise<GrepMatch[]>((resolveScan, rejectScan) => {
    let settled = false;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (done: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Fire-and-forget: terminate() rejects only if the worker is already gone.
      if (worker) void worker.terminate().catch(() => {});
      done();
    };
    try {
      const request: GrepWorkerRequest = { cwd, query, opts: scanOpts };
      worker = new Worker(new URL(workerUrl), { workerData: request, execArgv: workerExecArgv(workerUrl) });
    } catch (err) {
      settle(() => rejectScan(err));
      return;
    }
    timer = setTimeout(() => settle(() => rejectScan(new GrepTimeoutError(scanTimeoutMs))), scanTimeoutMs);
    worker.on("message", (reply: GrepWorkerReply) => {
      settle(() => (reply.ok ? resolveScan(reply.matches) : rejectScan(new Error(reply.error))));
    });
    worker.on("error", (err) => settle(() => rejectScan(err)));
    worker.on("exit", (code) => settle(() => rejectScan(new Error(`grep worker exited (code ${code}) without a result`))));
  });
}

/**
 * Run a content search, preferring `rg` when `rgPath` is set, else the worker-backed JS
 * scan. An rg failure degrades to that scan, which is bounded by `scanTimeoutMs`.
 */
export async function runGrep(
  cwd: string,
  query: string,
  opts: GrepOptions & GrepScanOptions & { rgPath?: string | null } = {},
): Promise<GrepMatch[]> {
  const { rgPath, ...grepOpts } = opts;
  if (rgPath) {
    try {
      return await grepWithRipgrep(rgPath, cwd, query, grepOpts);
    } catch {
      // rg failed (spawn / parse / rejected pattern) — degrade to the bounded scan.
      return grepWithJsScanInWorker(cwd, query, grepOpts);
    }
  }
  return grepWithJsScanInWorker(cwd, query, grepOpts);
}
