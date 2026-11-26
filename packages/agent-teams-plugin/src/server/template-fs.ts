/**
 * Safe source-file access shared by template and agent discovery: a source directory must resolve
 * inside its root, a file must be a regular file whose realpath stays inside that directory, and
 * the size is checked from `stat` BEFORE any byte is read. Project trust is read through one helper.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export type FsFailCode = "not_found" | "outside_source_dir" | "too_large" | "not_regular" | "unreadable";

export type SourceDirResult = { ok: true; dir: string } | { ok: false; code: "not_found" | "outside_source_dir" };

export interface SourceFile {
  /** File text; empty (and `cached` true) when the caller's `peek` already knows this `key`. */
  text: string;
  /** Cache identity: realpath + stat signature. */
  key: string;
  cached?: true;
}
export type SourceFileResult = ({ ok: true } & SourceFile) | { ok: false; code: FsFailCode };

const isWithin = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const errCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code;

/** `<root>/<rel>` as a real directory that stays inside `root` (a symlinked `.pi/teams` → outside is refused). */
export function resolveSourceDir(root: string, rel: string): SourceDirResult {
  try {
    const rootReal = fs.realpathSync(root);
    const real = fs.realpathSync(path.join(rootReal, rel));
    if (!isWithin(real, rootReal)) return { ok: false, code: "outside_source_dir" };
    if (!fs.statSync(real).isDirectory()) return { ok: false, code: "not_found" };
    return { ok: true, dir: real };
  } catch {
    return { ok: false, code: "not_found" };
  }
}

/** Does `<dir>/<file>` exist as an entry (lstat only; nothing is read)? */
export function entryExists(dir: string, file: string): boolean {
  try {
    fs.lstatSync(path.join(dir, file));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read `<dir>/<file>` (`dir` already a real path) under the regular-file / inside-dir / size rules.
 * `peek(key)` true ⇒ the caller already holds this exact file version: nothing is read.
 */
export function readSourceFile(dir: string, file: string, maxBytes: number, peek?: (key: string) => boolean): SourceFileResult {
  const p = path.join(dir, file);
  try {
    const lst = fs.lstatSync(p);
    let real = p;
    if (lst.isSymbolicLink()) {
      real = fs.realpathSync(p);
      if (!isWithin(real, dir)) return { ok: false, code: "outside_source_dir" };
    }
    const st = fs.statSync(real, { bigint: true });
    if (!st.isFile()) return { ok: false, code: "not_regular" };
    if (st.size > BigInt(maxBytes)) return { ok: false, code: "too_large" };
    const key = `${real}|${st.mtimeNs}|${st.ino}|${st.size}`;
    if (peek?.(key)) return { ok: true, text: "", key, cached: true };
    const buf = fs.readFileSync(real);
    if (buf.length > maxBytes) return { ok: false, code: "too_large" };
    return { ok: true, text: buf.toString("utf8"), key };
  } catch (err) {
    return { ok: false, code: errCode(err) === "ENOENT" || errCode(err) === "ENOTDIR" ? "not_found" : "unreadable" };
  }
}

const warnedNoTrust = new WeakSet<object>();

/** Project trust, fail closed: a missing or throwing service means untrusted (logged once). */
export function projectTrusted(deps: Pick<TemplatesHooksDeps, "host" | "logger">, cwd: string): boolean {
  const fn = deps.host.isProjectTrusted as ((cwd: string) => boolean) | undefined;
  if (typeof fn !== "function") {
    if (!warnedNoTrust.has(deps.host)) {
      warnedNoTrust.add(deps.host);
      deps.logger.warn("agent-teams: host.isProjectTrusted is unavailable; project templates and agents are treated as untrusted");
    }
    return false;
  }
  try {
    return fn(cwd) === true;
  } catch (err) {
    deps.logger.warn(`agent-teams: host.isProjectTrusted threw (${(err as Error).message}); treating project as untrusted`);
    return false;
  }
}
