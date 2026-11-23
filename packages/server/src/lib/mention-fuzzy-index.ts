/**
 * Tracked-file index behind fuzzy mention recovery (design D5 of rich-chat-links).
 *
 * One index per git root (`git rev-parse --show-toplevel`), built from `git ls-files -z` — TRACKED
 * files only, so ignored / generated paths and secrets never become candidates. The build is bounded
 * on every axis, because a batch of 200 mentions may trigger it:
 *   - `execFile` with a 3 s timeout (plus our own timer, so a stub that never answers cannot hang us)
 *     and a 64 MiB output buffer;
 *   - at most 200,000 entries (above the cap the root is skipped and logged);
 *   - single-flight per root, and a 60 s TTL. A SKIPPED root is remembered for the TTL too, so a
 *     failing repo costs one spawn per minute, not one per mention.
 * Every failure degrades to `{ status: "skipped" }` with ONE log line and never throws: the exact
 * resolution result is always still returned by the caller.
 *
 * This module only answers "which tracked paths match"; containment and the per-mention stat budget
 * (25) are enforced by the resolver, which also decides on-disk existence.
 *
 * See change: rich-chat-links (D5).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export const MAX_ENTRIES = 200_000;
export const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
export const GIT_TIMEOUT_MS = 3000;
export const TTL_MS = 60_000;
/** Roots (and root lookups) kept per cache; least recently used is evicted beyond this. */
export const MAX_CACHED_ROOTS = 16;
/**
 * `git` runs inside a repo we do not trust, and a repo's own config can name a program to run
 * (`core.fsmonitor`). Command-line `-c` outranks every config file, so these always win; the
 * untracked cache is off because it is only used by status-style scans we never need.
 */
const GIT_HARDENING_ARGS = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"] as const;
/** Matches handed to the resolver per lookup (its per-mention stat budget). */
export const MAX_MATCHES = 25;

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

export type SkipReason =
  | "not-eligible"
  | "not-a-repo"
  | "rev-parse-failed"
  | "ls-files-failed"
  | "too-large"
  | "buffer"
  | "timeout";

export type FuzzyLookup =
  | { status: "skipped"; reason: SkipReason }
  | {
      status: "ok";
      root: string;
      /** Number of tracked files matching the mention (may exceed `matches.length`). */
      total: number;
      /** Absolute paths of the first {@link MAX_MATCHES} matches, in `git ls-files` order. */
      matches: string[];
      /** True when the root index was served from cache rather than built for this call. */
      cached: boolean;
      /** Build time of the root index in ms (only when built by/for this call). */
      buildMs?: number;
    };

export interface MentionFuzzyIndex {
  lookup(cwd: string, mention: string): Promise<FuzzyLookup>;
  /** Drop every cached index and root lookup (tests, cold-path measurement). */
  clear(): void;
}

export interface MentionFuzzyIndexDeps {
  execFile?: ExecFileLike;
  now?: () => number;
  log?: (line: string) => void;
}

const defaultExecFile: ExecFileLike = async (file, args, opts) => {
  const { stdout } = await execFileAsync(file, args, { ...opts, encoding: "utf8" });
  return { stdout: String(stdout) };
};

type Timed<T> = { at: number; value: T };
type RootResult = { root: string } | { skip: SkipReason };
type BuildResult = { skip: SkipReason } | { byBase: Map<string, string[]>; buildMs: number };

function reasonOf(err: unknown, otherwise: SkipReason): SkipReason {
  const e = err as { code?: unknown; killed?: unknown; message?: unknown } | null;
  if (e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(String(e?.message ?? ""))) return "buffer";
  if (e?.killed === true) return "timeout";
  return otherwise;
}

/** Normalise a mention to a root-relative suffix, or `undefined` when fuzzy must not run for it. */
function eligibleSuffix(mention: string): string | undefined {
  if (mention.startsWith("/") || mention.startsWith("~") || mention.includes("\\") || mention.includes("\0")) {
    return undefined;
  }
  const trimmed = mention.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed.split("/").some((seg) => seg === ".." || seg === "" || seg === ".")) return undefined;
  return trimmed;
}

export function createMentionFuzzyIndex(deps: MentionFuzzyIndexDeps = {}): MentionFuzzyIndex {
  const exec = deps.execFile ?? defaultExecFile;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));

  const roots = new Map<string, Timed<RootResult>>();
  const rootsInflight = new Map<string, Promise<RootResult>>();
  const indexes = new Map<string, Timed<BuildResult>>();
  const indexesInflight = new Map<string, Promise<BuildResult>>();

  const fresh = <T>(entry: Timed<T> | undefined): entry is Timed<T> => entry !== undefined && now() - entry.at < TTL_MS;

  /** `git` with our own deadline on top of execFile's, so an unresponsive stub or process cannot hang a request. */
  async function git(args: readonly string[], cwd: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("git timed out"), { killed: true })), GIT_TIMEOUT_MS);
    });
    try {
      const { stdout } = await Promise.race([exec("git", [...GIT_HARDENING_ARGS, ...args], {
          cwd,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        }), deadline]);
      return stdout;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Is there a `.git` entry (dir or worktree/submodule file) on the way up? `lstat`, so no stat budget is spent. */
  async function looksLikeRepo(cwd: string): Promise<boolean> {
    for (let dir = path.resolve(cwd); ; ) {
      try {
        await fs.lstat(path.join(dir, ".git"));
        return true;
      } catch {
        // keep walking
      }
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }

  async function findRoot(cwd: string): Promise<RootResult> {
    if (!(await looksLikeRepo(cwd))) return { skip: "not-a-repo" };
    try {
      const top = (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
      if (!top) throw new Error("empty toplevel");
      return { root: top };
    } catch (err) {
      const skip = reasonOf(err, "rev-parse-failed");
      log(`[mention-fuzzy-index] skipped: git rev-parse failed (${skip})`);
      return { skip };
    }
  }

  async function build(root: string): Promise<BuildResult> {
    const t0 = now();
    let out: string;
    try {
      out = await git(["ls-files", "-z"], root);
    } catch (err) {
      const skip = reasonOf(err, "ls-files-failed");
      log(`[mention-fuzzy-index] skipped: git ls-files failed (${skip})`);
      return { skip };
    }
    if (out.length > MAX_BUFFER_BYTES) {
      log(`[mention-fuzzy-index] skipped: git ls-files output exceeds ${MAX_BUFFER_BYTES} bytes`);
      return { skip: "buffer" };
    }
    const files = out.split("\0");
    if (files[files.length - 1] === "") files.pop();
    if (files.length > MAX_ENTRIES) {
      log(`[mention-fuzzy-index] skipped: ${files.length} tracked files exceed the ${MAX_ENTRIES} entry cap`);
      return { skip: "too-large" };
    }
    const byBase = new Map<string, string[]>();
    for (const rel of files) {
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      const list = byBase.get(base);
      if (list) list.push(rel);
      else byBase.set(base, [rel]);
    }
    return { byBase, buildMs: now() - t0 };
  }

  /** Cache + single-flight around a keyed async producer. */
  function singleFlight<T>(
    key: string,
    cache: Map<string, Timed<T>>,
    inflight: Map<string, Promise<T>>,
    produce: () => Promise<T>,
  ): { cached: T } | { pending: Promise<T> } {
    const hit = cache.get(key);
    if (fresh(hit)) {
      cache.delete(key); // most recently used goes last
      cache.set(key, hit);
      return { cached: hit.value };
    }
    if (hit) cache.delete(key); // expired
    let pending = inflight.get(key);
    if (!pending) {
      pending = produce()
        .then((value) => {
          cache.delete(key);
          cache.set(key, { at: now(), value });
          if (cache.size > MAX_CACHED_ROOTS) cache.delete(cache.keys().next().value as string);
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return { pending };
  }

  return {
    async lookup(cwd, mention) {
      const suffix = eligibleSuffix(mention);
      if (suffix === undefined) return { status: "skipped", reason: "not-eligible" };

      const rootHit = singleFlight(cwd, roots, rootsInflight, () => findRoot(cwd));
      const rootRes = "cached" in rootHit ? rootHit.cached : await rootHit.pending;
      if ("skip" in rootRes) return { status: "skipped", reason: rootRes.skip };

      const idxHit = singleFlight(rootRes.root, indexes, indexesInflight, () => build(rootRes.root));
      const cached = "cached" in idxHit;
      const idx = cached ? idxHit.cached : await idxHit.pending;
      if ("skip" in idx) return { status: "skipped", reason: idx.skip };

      const base = suffix.slice(suffix.lastIndexOf("/") + 1);
      let candidates = idx.byBase.get(base) ?? [];
      if (suffix.includes("/")) candidates = candidates.filter((rel) => rel === suffix || rel.endsWith(`/${suffix}`));
      return {
        status: "ok",
        root: rootRes.root,
        total: candidates.length,
        matches: candidates.slice(0, MAX_MATCHES).map((rel) => path.join(rootRes.root, rel)),
        cached,
        ...(cached ? {} : { buildMs: idx.buildMs }),
      };
    },
    clear() {
      roots.clear();
      indexes.clear();
    },
  };
}

let shared: MentionFuzzyIndex | undefined;
/** Process-wide index used by the routes unless a test injects its own. */
export function getMentionFuzzyIndex(): MentionFuzzyIndex {
  shared ??= createMentionFuzzyIndex();
  return shared;
}
