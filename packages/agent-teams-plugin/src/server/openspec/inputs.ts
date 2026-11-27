/**
 * Repository inputs are untrusted (design D2, spec "Repository inputs are bounded"): `groups.json`,
 * `dependencies.yaml` and `tasks.md` are read ONLY as regular files (`lstat` + `fstat` on the opened
 * descriptor, `O_NOFOLLOW`, `O_NONBLOCK` so a FIFO swapped in cannot park the process), at most 1 MiB; a
 * change directory must be a real directory under `<repo>/openspec/changes/`; names are re-validated
 * wherever they come from (the goal alone is not enough). `dependencies.yaml` goes through the shared
 * reader (64 KiB, aliases rejected outright, a symlink/FIFO/oversize file is `invalid`).
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { DEPENDENCIES_FILE, type DeclaredDependencies, readDependenciesFile } from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";

export const MAX_INPUT_BYTES = 1024 * 1024;
/** Goal / change / group-id length cap (code points). */
export const MAX_NAME_CHARS = 64;

const CHANGE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A change name (or kebab group id): `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters. */
export function isChangeName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_NAME_CHARS && CHANGE_NAME_RE.test(value);
}

export type FileReadCode = "absent" | "not_regular" | "too_large" | "unreadable";
export type BoundedRead = { ok: true; text: string } | { ok: false; code: FileReadCode };

/** Read one regular file of at most `maxBytes`; never follows a symlink, never blocks on a FIFO. */
export function readBoundedFile(file: string, maxBytes: number = MAX_INPUT_BYTES): BoundedRead {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, code: code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable" };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, code: "not_regular" };
  if (st.size > maxBytes) return { ok: false, code: "too_large" };
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    if (!fs.fstatSync(fd).isFile()) return { ok: false, code: "not_regular" };
    const buf = Buffer.alloc(maxBytes + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > maxBytes) return { ok: false, code: "too_large" };
    return { ok: true, text: buf.subarray(0, n).toString("utf8") };
  } catch {
    return { ok: false, code: "unreadable" };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export type ChangeDirResult = { ok: true; dir: string } | { ok: false; code: "invalid_name" | "absent" | "not_directory" };

/**
 * `<repo>/openspec/changes/<change>` when it is a real directory whose real path is exactly that path under
 * the real repo root (a symlinked `openspec`, `changes` or change directory is refused). `archive` is not a change.
 */
export function resolveChangeDir(repo: string, change: unknown): ChangeDirResult {
  if (!isChangeName(change) || change === "archive") return { ok: false, code: "invalid_name" };
  const dir = path.join(repo, "openspec", "changes", change);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return { ok: false, code: "absent" };
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, code: "not_directory" };
  try {
    if (fs.realpathSync(dir) !== path.join(fs.realpathSync(repo), "openspec", "changes", change)) return { ok: false, code: "not_directory" };
  } catch {
    return { ok: false, code: "absent" };
  }
  return { ok: true, dir };
}

export type DependenciesRead = { kind: "absent" } | { kind: "invalid"; error: string } | { kind: "ok"; value: DeclaredDependencies };

/** The declared `dependencies.yaml` of one change; an unsafe change directory counts as `invalid`. */
export async function readChangeDependencies(repo: string, change: string): Promise<DependenciesRead> {
  const dir = resolveChangeDir(repo, change);
  if (!dir.ok) return dir.code === "absent" ? { kind: "absent" } : { kind: "invalid", error: `change directory ${dir.code}` };
  const res = await readDependenciesFile(path.join(dir.dir, DEPENDENCIES_FILE));
  return res.kind === "ok" ? { kind: "ok", value: res.value } : res.kind === "absent" ? { kind: "absent" } : { kind: "invalid", error: res.error };
}

/** `<repo>/openspec/changes/<change>/tasks.md` as a bounded regular file (`tasks_unreadable` on any failure). */
export function readChangeTasks(repo: string, change: string): { ok: true; text: string } | { ok: false; code: FileReadCode | "invalid_name" | "not_directory" } {
  const dir = resolveChangeDir(repo, change);
  if (!dir.ok) return { ok: false, code: dir.code === "invalid_name" ? "invalid_name" : dir.code === "absent" ? "absent" : "not_directory" };
  return readBoundedFile(path.join(dir.dir, "tasks.md"));
}

/** `<repo>/openspec/groups/groups.json` as a bounded regular file (`groups_invalid` on a violation; `absent` ⇒ `group_unknown`). */
export function readGroupsFile(repo: string): BoundedRead {
  return readBoundedFile(path.join(repo, "openspec", "groups", "groups.json"));
}
