/**
 * Pure helpers for the `openspec status --all --json` poll path.
 *
 * No filesystem and no process spawning here — the module is safe to import
 * from the poll worker and from browser-adjacent code. It owns:
 *   - envelope classification (unsupported CLI / whole-call failure / success),
 *   - sanitization of per-change error text before it is broadcast,
 *   - OpenSpec's task-line counting rule,
 *   - the per-CLI-installation "`--all` unsupported" cache,
 *   - CLI-path → server-path mapping and tracked-path extras for the gate.
 *
 * See change: use-openspec-status-all.
 */
import path from "node:path";

// ── Raw CLI result ──────────────────────────────────────────────────────────

/** Raw result of one `openspec status --all --json` call, whatever the exit code. */
export interface StatusAllRaw {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /**
   * Spawn-level failure (not-found / timeout / spawn-failure / aborted /
   * output-too-large): there is no trustworthy stdout. The value is a short
   * machine-readable cause, never forwarded to clients.
   */
  failure?: string;
}

export interface StatusAllArtifact {
  id: string;
  outputPath?: string;
  status: string;
  requires?: string[];
}

export interface StatusAllArtifactPaths {
  outputPath?: string;
  resolvedOutputPath?: string;
  existingOutputPaths?: string[];
}

export interface StatusAllEntry {
  changeName: string;
  schemaName?: string;
  changeRoot?: string;
  artifactPaths?: Record<string, StatusAllArtifactPaths>;
  isComplete?: boolean;
  artifacts?: StatusAllArtifact[];
  status?: Array<{ severity?: string; code?: string; message?: string }>;
}

export type StatusAllClassification =
  | { kind: "unsupported" }
  | { kind: "failed"; reason: string }
  | { kind: "ok"; root: { path: string; source?: string }; entries: StatusAllEntry[] };

/**
 * Parse JSON from stdout; returns null on parse failure.
 *
 * Tolerates a non-JSON PREAMBLE. `openspec` prints a one-off telemetry notice
 * on its first run under a given HOME, ahead of the JSON body — strict parsing
 * turned that into "no changes", so a fresh HOME (new container, new user, CI)
 * silently produced an empty OpenSpec panel on the first poll.
 * See test: platform/__tests__/openspec-json-preamble.test.ts.
 * (Lives here, not in `platform/openspec.ts`, so this module stays free of runner/fs imports.)
 */
export function parseJsonOrNull(out: string): unknown | null {
  const trimmed = out.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Retry from the first JSON opener. Only a leading preamble is recovered;
    // trailing junk still fails, and output with no opener stays null.
    const start = trimmed.search(/[[{]/);
    if (start <= 0) return null;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return null;
    }
  }
}

// ── Classification ──────────────────────────────────────────────────────────

/** Commander's wording for an unknown option on an older CLI. */
const UNSUPPORTED_RE = /unknown option ['"]?--all/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Classify one raw `status --all` result. Order matters: the unsupported-CLI
 * test runs first (it only fires when there is NO JSON body), then the
 * whole-call failure checks, otherwise success.
 */
export function classifyStatusAll(raw: StatusAllRaw): StatusAllClassification {
  if (raw.failure) return { kind: "failed", reason: raw.failure };

  const parsed = parseJsonOrNull(raw.stdout);
  const hasJson = isObject(parsed);

  if (!hasJson) {
    if (UNSUPPORTED_RE.test(raw.stderr) || UNSUPPORTED_RE.test(raw.stdout)) {
      return { kind: "unsupported" };
    }
    return { kind: "failed", reason: "no-json" };
  }

  const top = parsed;
  if (Array.isArray(top.status) && top.status.some((s) => isObject(s) && s.severity === "error")) {
    return { kind: "failed", reason: "top-level-error" };
  }
  const root = top.root;
  if (root === null) return { kind: "failed", reason: "root-null" };
  if (!isObject(root) || typeof root.path !== "string") return { kind: "failed", reason: "root-missing" };
  if (root.source === "implicit") return { kind: "failed", reason: "root-implicit" };
  if (!Array.isArray(top.changes)) return { kind: "failed", reason: "changes-missing" };

  const entries = top.changes.filter(
    (e): e is StatusAllEntry => isObject(e) && typeof e.changeName === "string",
  );
  return {
    kind: "ok",
    root: { path: root.path, ...(typeof root.source === "string" ? { source: root.source } : {}) },
    entries,
  };
}

// ── Sanitization ────────────────────────────────────────────────────────────

export const ERROR_MESSAGE_MAX = 500;
export const ERROR_CODE_MAX = 64;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  // Never end on a lone high surrogate (would break JSON/UTF-8 round-trips).
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/**
 * Sanitize a CLI-provided error before caching/broadcasting: control
 * characters stripped, `message` collapsed onto one line of ≤ 500 chars,
 * `code` ≤ 64 chars. Line breaks become a single space so words do not fuse.
 */
export function sanitizeChangeError(code: unknown, message: unknown): { code: string; message: string } {
  const c = String(code ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "");
  const m = String(message ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return { code: truncate(c, ERROR_CODE_MAX), message: truncate(m, ERROR_MESSAGE_MAX) };
}

/**
 * The per-change error for an entry carrying no `artifacts`, or `null` when
 * the entry is a healthy one. An entry with neither `artifacts` nor `status`
 * maps to `unknown-entry`.
 */
export function entryError(entry: StatusAllEntry): { code: string; message: string } | null {
  if (Array.isArray(entry.artifacts)) return null;
  const list = Array.isArray(entry.status) ? entry.status : [];
  const first = list.find((s) => s && s.severity === "error") ?? list[0];
  if (!first) return sanitizeChangeError("unknown-entry", "Unrecognised entry in openspec status output");
  return sanitizeChangeError(first.code ?? "change_error", first.message ?? "");
}

// ── Task counting (OpenSpec's rule) ─────────────────────────────────────────

/** Verbatim copy of OpenSpec's `TASK_LINE_PATTERN` (utils/task-progress.js). */
const TASK_LINE_PATTERN = /^\s*[-*]\s*\[([\sxX])\]\s*(.*)/;

/** Mirrors OpenSpec's `countTasksFromContent`: every matching line counts. */
export function countTasksFromContent(content: string): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const line of content.split("\n")) {
    const m = TASK_LINE_PATTERN.exec(line);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === "x") completed++;
  }
  return { total, completed };
}

export function taskListStatus(total: number, completed: number): "no-tasks" | "in-progress" | "complete" {
  if (total === 0) return "no-tasks";
  return completed === total ? "complete" : "in-progress";
}

/**
 * Pick the tracked-tasks artifact the way OpenSpec's `findTrackedTasksArtifact`
 * does: by `apply.tracks` (artifact whose `outputPath` equals it; none
 * matching ⇒ none), else the artifact with id `tasks`.
 */
export function selectTrackedArtifact(
  artifacts: StatusAllArtifact[] | undefined,
  applyTracks: string | undefined,
): StatusAllArtifact | undefined {
  const list = artifacts ?? [];
  if (applyTracks != null) return list.find((a) => a.outputPath === applyTracks);
  return list.find((a) => a.id === "tasks");
}

// ── Canonical artifact order ────────────────────────────────────────────────

const CANONICAL_ARTIFACT_ORDER = ["proposal", "design", "specs", "tasks"] as const;

/** `proposal, design, specs, tasks` (those present), then the rest in CLI order. */
export function canonicalArtifactOrder<T extends { id: string }>(artifacts: T[]): T[] {
  const rank = (id: string) => {
    const i = (CANONICAL_ARTIFACT_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? CANONICAL_ARTIFACT_ORDER.length : i;
  };
  // Array.prototype.sort is stable: equal ranks keep CLI order.
  return [...artifacts].sort((a, b) => rank(a.id) - rank(b.id));
}

// ── Unsupported-CLI cache ───────────────────────────────────────────────────

export interface StatusAllSupportCache {
  /**
   * True when `--all` is known not to work for the CLI installation currently
   * resolved to `version` (null = unresolvable package.json). With a null
   * version the verdict is cached for the process but re-evaluated on every
   * force refresh. A changed version clears the verdict (upgrade picked up).
   */
  isKnownUnsupported(version: string | null, force: boolean): boolean;
  markUnsupported(version: string | null): void;
}

export function createStatusAllSupportCache(): StatusAllSupportCache {
  let marked = false;
  let markedVersion: string | null = null;
  return {
    isKnownUnsupported(version, force) {
      if (!marked) return false;
      if (version === null) {
        if (markedVersion !== null) {
          marked = false; // was resolvable, no longer is — re-evaluate
          return false;
        }
        return !force;
      }
      if (version !== markedVersion) {
        marked = false; // upgraded/downgraded — try `--all` again
        return false;
      }
      return true;
    },
    markUnsupported(version) {
      marked = true;
      markedVersion = version;
    },
  };
}

// ── CLI-path → server-path mapping & tracked extras ─────────────────────────

/** Extra tracked paths for one change, already mapped onto the server's `openspec/` dir. */
export interface TrackedExtras {
  /** Files and directories to stat. */
  files: string[];
  /** Directory prefixes of glob outputs; the probe also tracks every directory beneath them. */
  globPrefixes: string[];
  /** Glob/literal outputs as paths relative to the change dir (forward slashes), for the watcher filter. */
  outputs: string[];
}

/**
 * Map a CLI-emitted absolute path onto the server's canonical `openspec/` dir.
 * The CLI path is relativized against `root.path` exactly as emitted; a path
 * that escapes the root, or does not live under `openspec/`, yields `null`.
 */
export function mapCliPath(
  cliPath: string,
  rootPath: string,
  canonicalOpenspecDir: string,
): string | null {
  if (typeof cliPath !== "string" || cliPath.length === 0) return null;
  const rel = path.relative(rootPath, cliPath);
  if (!rel || path.isAbsolute(rel)) return null;
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  if (segments.length < 2 || segments[0] !== "openspec" || segments.includes("..")) return null;
  return path.join(canonicalOpenspecDir, ...segments.slice(1));
}

const GLOB_CHARS = /[*?{]/;

/** Output pattern relative to the change dir (forward slashes), or null when unusable. */
function relativeOutputPattern(ap: StatusAllArtifactPaths, changeRoot: string | undefined): string | null {
  let rel = ap.outputPath;
  if (!rel && ap.resolvedOutputPath && changeRoot) {
    rel = path.relative(changeRoot, ap.resolvedOutputPath);
  }
  if (!rel || path.isAbsolute(rel)) return null;
  const norm = rel.split(/[\\/]+/).filter(Boolean);
  if (norm.length === 0 || norm.includes("..")) return null;
  return norm.join("/");
}

/** Tracked extras of one change entry (see "Cwd-level change-detection gate"). */
export function computeTrackedExtras(
  entry: StatusAllEntry,
  rootPath: string,
  canonicalOpenspecDir: string,
  changeDir: string,
): TrackedExtras {
  const files = new Set<string>();
  const globPrefixes = new Set<string>();
  const outputs = new Set<string>();
  const addWithParent = (p: string) => {
    files.add(p);
    files.add(path.dirname(p));
  };
  for (const ap of Object.values(entry.artifactPaths ?? {})) {
    for (const existing of ap.existingOutputPaths ?? []) {
      const mapped = mapCliPath(existing, rootPath, canonicalOpenspecDir);
      if (mapped) addWithParent(mapped);
    }
    const pattern = relativeOutputPattern(ap, entry.changeRoot);
    if (!pattern) continue;
    outputs.add(pattern);
    const segments = pattern.split("/");
    const globIdx = segments.findIndex((s) => GLOB_CHARS.test(s));
    if (globIdx === -1) {
      addWithParent(path.join(changeDir, ...segments));
    } else {
      const prefix = path.join(changeDir, ...segments.slice(0, globIdx));
      globPrefixes.add(prefix);
      files.add(prefix);
    }
  }
  return { files: [...files], globPrefixes: [...globPrefixes], outputs: [...outputs] };
}

/** Does a change-relative path (forward slashes) match a recorded output pattern? */
export function matchesOutputPattern(relPath: string, pattern: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (!GLOB_CHARS.test(pattern)) return norm === pattern;
  // Minimal glob: `**` spans segments, `*` stays inside one segment.
  const re = pattern
    .split("/")
    .map((seg) => (seg === "**" ? ".*" : seg.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")))
    .join("/")
    .replace(/\/\.\*\//g, "/(?:.*/)?");
  return new RegExp(`^${re}$`).test(norm);
}

// ── Bounded concurrency ─────────────────────────────────────────────────────

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight; order preserved. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
