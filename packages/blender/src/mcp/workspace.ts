/**
 * Workspace confinement, input staging and all-or-nothing output commits (design D5).
 *
 * Every path is relative and must resolve — after following symlinks — inside the root. An output that
 * does not exist yet is confined through its nearest existing ancestor. Outputs are written only after
 * every key is confined and every limit is met; any failure leaves the workspace as it was (replaced
 * files are restored, created directories removed). The commit mirrors craft-apps' `commitOutputs`
 * (extraction into a shared module is an out-of-scope follow-up).
 *
 * See change: add-blender-wasm-mcp (design D5, tasks 4.1, 4.2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ToolError } from "../errors.js";

export const MAX_INPUT_FILES = 64;
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;
export const MAX_CODE_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const MIB = 1024 * 1024;

export interface Limits {
  inputBytes: number;
  outputBytes: number;
}

/** Limits from `BLENDER_WASM_MAX_{INPUT,OUTPUT}_MB`: the environment may only lower them, never raise. */
export function resolveLimits(env: NodeJS.ProcessEnv): Limits {
  const lower = (name: string, cap: number): number => {
    const mb = Number.parseFloat(env[name] ?? "");
    return Number.isFinite(mb) && mb > 0 ? Math.min(cap, Math.floor(mb * MIB)) : cap;
  };
  return { inputBytes: lower("BLENDER_WASM_MAX_INPUT_MB", MAX_INPUT_BYTES), outputBytes: lower("BLENDER_WASM_MAX_OUTPUT_MB", MAX_OUTPUT_BYTES) };
}

/** Realpath of the root; throws a plain `Error` (the server prints it and exits 1) when it is missing or not a directory. */
export function resolveRoot(cwd: string, rootArg: string | undefined): string {
  const candidate = path.resolve(cwd, rootArg ?? ".");
  let real: string;
  try {
    real = fs.realpathSync(candidate);
    if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
  } catch (e) {
    throw new Error(`--root ${candidate}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such directory" : (e as Error).message}`);
  }
  return real;
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Normalise a client path to a safe POSIX relative path, or throw `path-outside-root` / `invalid-arguments`. */
export function normaliseRelative(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) throw new ToolError("invalid-arguments", "path must be a non-empty string");
  if (raw.includes("\0")) throw new ToolError("invalid-arguments", "path contains a NUL byte");
  const slashed = raw.replaceAll("\\", "/");
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    throw new ToolError("path-outside-root", `${raw}: absolute paths are not allowed; use a path relative to the root`);
  }
  const norm = path.posix.normalize(slashed);
  if (norm === ".." || norm.startsWith("../")) throw new ToolError("path-outside-root", `${raw}: escapes the root`);
  return norm === "." ? "" : norm.replace(/\/$/, "");
}

/** Realpath of the nearest existing ancestor-or-self of `abs`, plus whether `abs` itself exists. */
function nearestExisting(abs: string): { real: string; exists: boolean } {
  let current = abs;
  for (;;) {
    try {
      return { real: fs.realpathSync(current), exists: current === abs };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      current = parent;
    }
  }
}

/** Confine `rel` for reading: it must exist and resolve inside `root`. Returns the real path. */
export function confineExisting(root: string, rel: string): { rel: string; real: string } {
  const norm = normaliseRelative(rel);
  const abs = path.resolve(root, norm);
  if (!inside(root, abs)) throw new ToolError("path-outside-root", `${rel}: escapes the root`);
  const { real, exists } = nearestExisting(abs);
  if (!inside(root, real)) throw new ToolError("path-outside-root", `${rel}: resolves outside the root`);
  if (!exists) throw new ToolError("input-not-found", `${rel}: no such file`);
  return { rel: norm, real };
}

/** Confine `rel` for writing: the nearest existing ancestor must resolve inside `root`. Returns the absolute target. */
export function confineOutput(root: string, rel: string): { rel: string; abs: string } {
  const norm = normaliseRelative(rel);
  const abs = path.resolve(root, norm);
  if (!inside(root, abs)) throw new ToolError("path-outside-root", `${rel}: escapes the root`);
  const { real } = nearestExisting(abs);
  if (!inside(root, real)) throw new ToolError("path-outside-root", `${rel}: resolves outside the root`);
  return { rel: norm, abs };
}

export interface StagedInputs {
  /** Session path (`/in/<rel>`) → bytes. */
  files: Record<string, Uint8Array>;
}

/** Read the listed inputs (deduplicated) after confining each one; enforces the file-count and byte limits. */
export function readInputs(root: string, inputs: readonly string[], limits: Limits): StagedInputs {
  const unique = [...new Set(inputs.map((p) => normaliseRelative(p)))];
  if (unique.length > MAX_INPUT_FILES) throw new ToolError("limit-exceeded", `more than ${MAX_INPUT_FILES} input files`);
  const resolved = unique.map((rel) => {
    const { real } = confineExisting(root, rel);
    const st = fs.statSync(real);
    if (!st.isFile()) throw new ToolError("invalid-arguments", `${rel}: not a regular file`);
    return { rel, real, size: st.size };
  });
  const total = resolved.reduce((n, r) => n + r.size, 0);
  if (total > limits.inputBytes) throw new ToolError("limit-exceeded", `inputs total ${total} bytes, over the ${limits.inputBytes}-byte limit`);
  const files: Record<string, Uint8Array> = {};
  for (const r of resolved) files[`/in/${r.rel}`] = new Uint8Array(fs.readFileSync(r.real));
  return { files };
}

export interface OutputFile {
  /** Path relative to `baseDir`, as the host returned it (not yet trusted). */
  key: string;
  bytes: Uint8Array;
}

export interface CommitDeps {
  rename: typeof fs.renameSync;
  tag: string;
}

/** Created ancestors of `dir` that do not exist yet, outermost first. */
function missingDirs(dir: string): string[] {
  const missing: string[] = [];
  for (let cur = dir; !fs.existsSync(cur); cur = path.dirname(cur)) missing.unshift(cur);
  return missing;
}

/**
 * Write `files` below `<root>/<baseDir>` all-or-nothing. Every key is confined first (`path-outside-root`),
 * the byte total is re-checked (`limit-exceeded`), then temp siblings are written, existing targets are
 * moved to backups, and the temps renamed in. Any failure restores backups and removes created files and
 * directories. Returns the written paths relative to the root (POSIX separators) with their sizes.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: all-or-nothing commit: confine, stage, backup, rename, rollback; each branch is one failure/rollback step.
export function commitOutputs(
  root: string,
  baseDir: string,
  files: readonly OutputFile[],
  limit: number,
  partial: Partial<CommitDeps> = {},
): { path: string; bytes: number }[] {
  const deps: CommitDeps = { rename: fs.renameSync, tag: `${process.pid}-${Date.now().toString(36)}`, ...partial };
  const base = baseDir === "" ? "" : normaliseRelative(baseDir); // "" = the root itself (a root-level export)
  const targets = files.map((f) => {
    const key = normaliseRelative(f.key);
    if (key === "") throw new ToolError("path-outside-root", "empty output name");
    return { ...confineOutput(root, base ? `${base}/${key}` : key), bytes: f.bytes };
  });
  const total = targets.reduce((n, t) => n + t.bytes.byteLength, 0);
  if (total > limit) throw new ToolError("limit-exceeded", `outputs total ${total} bytes, over the ${limit}-byte limit`);
  if (targets.length === 0) return [];

  const createdDirs: string[] = [];
  const staged: string[] = [];
  const committed: { dest: string; backup?: string }[] = [];
  try {
    for (const t of targets) {
      if (fs.existsSync(t.abs) && fs.statSync(t.abs).isDirectory()) throw new ToolError("export-failed", `${t.rel} is a directory`);
      const dir = path.dirname(t.abs);
      for (const d of missingDirs(dir)) {
        fs.mkdirSync(d);
        createdDirs.push(d);
      }
      // After mkdir the ancestor chain exists: re-confine (a symlink swapped in meanwhile is refused).
      confineOutput(root, t.rel);
    }
    const stages = targets.map((t) => {
      const stage = path.join(path.dirname(t.abs), `.${path.basename(t.abs)}.bw-${deps.tag}.tmp`);
      fs.writeFileSync(stage, t.bytes, { flag: "wx" });
      staged.push(stage);
      return stage;
    });
    targets.forEach((t, i) => {
      const backup = fs.existsSync(t.abs) ? path.join(path.dirname(t.abs), `.${path.basename(t.abs)}.bw-bak-${deps.tag}.tmp`) : undefined;
      if (backup) deps.rename(t.abs, backup);
      committed.push({ dest: t.abs, backup });
      deps.rename(stages[i], t.abs);
    });
  } catch (e) {
    for (const { dest, backup } of committed.reverse()) {
      fs.rmSync(dest, { force: true });
      if (backup) fs.renameSync(backup, dest);
    }
    for (const s of staged) fs.rmSync(s, { force: true });
    for (const d of createdDirs.reverse()) {
      try {
        fs.rmdirSync(d);
      } catch {
        /* not empty or already gone */
      }
    }
    if (e instanceof ToolError) throw e;
    throw new ToolError("export-failed", `could not write outputs: ${(e as Error).message}`);
  }
  for (const { backup } of committed) if (backup) fs.rmSync(backup, { force: true });
  return targets.map((t) => ({ path: t.rel, bytes: t.bytes.byteLength }));
}
