/**
 * pi-agent-settings-lock — NODE-ONLY primitive for a lock-coordinated,
 * merge-friendly write of pi's global `settings.json`.
 *
 * Takes the SAME `proper-lockfile` lock pi takes (`<settings.json>.lock`,
 * `realpath:false`, `stale:10_000`); tmp-file + `rename` makes the replace
 * atomic, a failed write leaves the target untouched. Default target is
 * `<agentDir>/settings.json` (`resolvePiAgentDir`, honours
 * `PI_CODING_AGENT_DIR`); `FsDeps.settingsPath` overrides target + lock path.
 *
 * NEVER import from client code (boundary-tested; not in any barrel).
 * Moved from `packages/server/src/pi-agent-settings.ts`.
 * See change: edit-pi-agent-settings (D4, D5); stop-flows-edit-mode-project-writes (D3).
 */
import { createHash, randomBytes } from "node:crypto";
import { promises as fsp, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { resolvePiAgentDir } from "./dashboard-paths.js";
import { PI_MANAGED_SETTINGS_KEYS } from "./pi-settings-keys.js";

const _require = createRequire(import.meta.url);
const _lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");
/** Async fs surface of the locked write path; injectable so failure paths are testable. */
export interface PiSettingsFs {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  stat: (path: string) => Promise<{ mode: number }>;
  lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
  realpath: (path: string) => Promise<string>;
  readlink: (path: string) => Promise<string>;
  mkdir: (path: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

const defaultFs: PiSettingsFs = {
  readFile: (p) => fsp.readFile(p, "utf-8"),
  writeFile: (p, d) => fsp.writeFile(p, d, "utf-8"),
  rename: (a, b) => fsp.rename(a, b),
  chmod: (p, m) => fsp.chmod(p, m),
  stat: (p) => fsp.stat(p),
  lstat: (p) => fsp.lstat(p),
  realpath: (p) => fsp.realpath(p),
  readlink: (p) => fsp.readlink(p),
  mkdir: async (p) => {
    await fsp.mkdir(p, { recursive: true });
  },
  unlink: (p) => fsp.unlink(p),
};

export interface FsDeps {
  /** Override for tests. Defaults to `os.homedir()`. */
  home?: string;
  /** Test seam for `PI_CODING_AGENT_DIR`. */
  agentDirEnv?: string;
  /** Override individual async fs calls (failure-path tests). */
  fs?: Partial<PiSettingsFs>;
  /**
   * Explicit target (and lock) path; bypasses `home`/`agentDirEnv`. Used by
   * callers that must write the exact file another reader resolves (flows
   * plugin → `<homedir>/.pi/agent/settings.json`).
   */
  settingsPath?: string;
}

/** Absolute path of the global pi settings file (UNRESOLVED — also the lock path). */
export function piSettingsPath(deps: FsDeps = {}): string {
  if (deps.settingsPath) return deps.settingsPath;
  return join(resolvePiAgentDir({ homedir: deps.home, agentDirEnv: deps.agentDirEnv }), "settings.json");
}

export function asObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ── Reading + the concurrency token ──────────────────────────────────

/** Snapshot of the settings file. */
export interface PiSettingsState {
  /** Parsed object; `{}` when absent or unparseable. */
  settings: Record<string, unknown>;
  /** Raw text as on disk (BOM kept); `""` when absent. */
  raw: string;
  /** Concurrency token (design D4). */
  etag: string;
  /** Set when the file exists but is not a valid JSON object. */
  parseError?: string;
  /** False when the file does not exist. */
  exists: boolean;
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/** 1-based line/column of a 0-based character offset, clamped into the text. */
function lineColumnAt(text: string, position: number): { line: number; column: number } {
  const upto = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = upto.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

/**
 * Describe a parse failure WITHOUT quoting file content. Node's `SyntaxError`
 * message can embed source text (a truncated file holding an API key would leak
 * it through `parseError`), so only the numeric position survives: the
 * `line L column C` pair when the message carries it, else a position derived
 * from `position N`, else a fixed reason. See change: pi-settings-full-coverage (D5b).
 */
function describeParseFailure(err: unknown, text: string): string {
  const msg = err instanceof Error ? err.message : "";
  const lc = /\(line (\d+) column (\d+)\)/.exec(msg);
  if (lc) return `Invalid JSON at line ${lc[1]}, column ${lc[2]}`;
  const pos = /\bposition (\d+)/.exec(msg);
  if (pos) {
    const { line, column } = lineColumnAt(text, Number(pos[1]));
    return `Invalid JSON at line ${line}, column ${column}`;
  }
  return "Invalid JSON";
}

export function parseText(raw: string): { obj?: Record<string, unknown>; error?: string } {
  const text = stripBom(raw);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) return { error: "settings.json must contain a JSON object" };
    return { obj: parsed };
  } catch (err) {
    return { error: describeParseFailure(err, text) };
  }
}

/**
 * Concurrency token: sha256 of the canonical form (BOM stripped, parsed, the
 * mirrored default keys removed, keys sorted recursively). `"absent"` for no
 * file; sha256 of the raw bytes when unparseable. Sorting makes reformatting
 * and key reordering non-conflicts. See change: edit-pi-agent-settings (D4).
 */
export function computePiSettingsEtag(raw: string | null): string {
  if (raw === null) return "absent";
  const { obj } = parseText(raw);
  if (!obj) return createHash("sha256").update(raw).digest("hex");
  const rest = { ...obj };
  for (const k of PI_MANAGED_SETTINGS_KEYS) delete rest[k];
  return createHash("sha256").update(JSON.stringify(sortKeys(rest))).digest("hex");
}

function buildState(raw: string | null): PiSettingsState {
  if (raw === null) return { settings: {}, raw: "", etag: "absent", exists: false };
  const { obj, error } = parseText(raw);
  return {
    settings: obj ?? {},
    raw,
    etag: computePiSettingsEtag(raw),
    ...(error ? { parseError: error } : {}),
    exists: true,
  };
}

function readRawSync(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Read the global settings file. Never throws on absent/unparseable content. */
export function readPiSettings(deps: FsDeps = {}): PiSettingsState {
  return buildState(readRawSync(piSettingsPath(deps)));
}

// ── Lock-coordinated atomic write (design D5) ────────────────────────

export type LockedStep<T, F> = { fail: F } | { value: T; /** New file text; omit for "no write". */ write?: string };

export type LockedResult<T, F> =
  | { ok: true; value: T; /** Post-write state (or current when nothing was written). */ state: PiSettingsState }
  | { ok: false; error: "busy" }
  | { ok: false; error: "io"; message: string }
  | { ok: false; error: "stale"; state: PiSettingsState }
  | { ok: false; error: "fn"; fail: F };

export interface LockOptions {
  /** Reject with `stale` when the current token differs. */
  baseEtag?: string;
}

const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, minTimeout: 20, maxTimeout: 20 },
} as const;

/** 2-space JSON with a trailing newline — the on-disk format of every write. */
export const formatJson = (obj: unknown): string => `${JSON.stringify(obj, null, 2)}\n`;

async function resolveWriteTarget(path: string, fs: PiSettingsFs): Promise<string> {
  try {
    if (!(await fs.lstat(path)).isSymbolicLink()) return path;
  } catch {
    return path; // absent
  }
  try {
    return await fs.realpath(path);
  } catch {
    // Dangling link: write through to where it points, as pi's writeFileSync does.
    return resolve(dirname(path), await fs.readlink(path));
  }
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Acquire pi's lock on the settings path; `busy` when held past the retry budget. */
async function acquireLock(
  path: string,
  fs: PiSettingsFs,
): Promise<{ release: () => Promise<void> } | { fail: LockedResult<never, never> }> {
  try {
    await fs.mkdir(dirname(path));
    const release = await _lockfile.lock(path, {
      ...LOCK_OPTIONS,
      onCompromised: (err) => {
        console.warn(`[pi-settings] lock compromised (${(err as { code?: string }).code ?? "unknown"})`);
      },
    });
    return { release };
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "ELOCKED") return { fail: { ok: false, error: "busy" } };
    return { fail: { ok: false, error: "io", message: errMessage(err) } };
  }
}

const isEnoent = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

async function readCurrent(path: string, fs: PiSettingsFs): Promise<string | null> {
  try {
    return await fs.readFile(path);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** tmp file in the target's directory + chmod to the target's mode + `rename`. */
async function replaceAtomically(path: string, text: string, existed: boolean, fs: PiSettingsFs): Promise<void> {
  const target = await resolveWriteTarget(path, fs);
  const tmp = join(dirname(target), `.${randomBytes(6).toString("hex")}.settings.tmp`);
  try {
    await fs.writeFile(tmp, text);
    if (existed) {
      try {
        await fs.chmod(tmp, (await fs.stat(target)).mode & 0o7777);
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Run `fn` under the pi settings lock. `fn` is PURE and synchronous (re-read
 * state in, new text out). Not acquired within the retry budget → `busy`;
 * a failing tmp write → `io` with the target untouched.
 */
export async function withPiSettingsLock<T, F = never>(
  fn: (state: PiSettingsState) => LockedStep<T, F>,
  options: LockOptions = {},
  deps: FsDeps = {},
): Promise<LockedResult<T, F>> {
  const fs: PiSettingsFs = { ...defaultFs, ...deps.fs };
  const path = piSettingsPath(deps);

  const lock = await acquireLock(path, fs);
  if ("fail" in lock) return lock.fail;

  try {
    const state = buildState(await readCurrent(path, fs));
    if (options.baseEtag !== undefined && options.baseEtag !== state.etag) {
      return { ok: false, error: "stale", state };
    }
    const step = fn(state);
    if ("fail" in step) return { ok: false, error: "fn", fail: step.fail };
    if (step.write === undefined) return { ok: true, value: step.value, state };
    await replaceAtomically(path, step.write, state.exists, fs);
    return { ok: true, value: step.value, state: buildState(step.write) };
  } catch (err) {
    return { ok: false, error: "io", message: errMessage(err) };
  } finally {
    await lock.release().catch(() => {});
  }
}
