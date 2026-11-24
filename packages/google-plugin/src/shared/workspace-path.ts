/**
 * Session-cwd confinement for files a Google tool reads or writes (design D11), ported from the Gmail
 * attachment guard (no import edge between the plugins; each keeps its own copy).
 * - Windows device / UNC / drive forms rejected outright.
 * - Containment via `isPathInside` on the REALPATH of the parent directory (a symlinked parent that escapes
 *   the cwd is refused).
 * - Missing parent directories are created inside the cwd; the bytes go to a temp file in the target directory and are
 *   hard-linked into place (`link` fails on an existing name, symlinks included: never overwrites, never follows).
 * Residual risk (documented, not prevented): a parent directory swapped for a symlink between the check and
 * the create (TOCTOU). See change: add-google-connect.
 */
import { randomBytes } from "node:crypto";
import { constants as fsc } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "@blackbelt-technology/pi-dashboard-shared/path-containment.js";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class PathRefusedError extends Error {
  readonly code: "path_refused" | "exists" | "too_large";

  constructor(code: "path_refused" | "exists" | "too_large") {
    super(
      code === "exists"
        ? "path_refused: target already exists (files are never overwritten)"
        : code === "too_large"
          ? "path_refused: file exceeds the 20 MiB limit"
          : "path_refused: path must stay inside the session working directory",
    );
    this.code = code;
    this.name = "PathRefusedError";
  }
}

/** Device (`\\?\`, `\\.\`), UNC (`\\host`) and drive-letter (`C:`) forms. */
function isWindowsSpecial(p: string): boolean {
  return /^[\\/]{2}/.test(p) || /^[a-zA-Z]:/.test(p) || p.includes("\0");
}

/** Resolve `target` against the real cwd; refuse anything that lexically leaves it. */
export async function confineToCwd(cwd: string, target: string): Promise<{ realCwd: string; resolved: string }> {
  if (!target || isWindowsSpecial(target)) throw new PathRefusedError("path_refused");
  const realCwd = await realpath(cwd);
  const resolved = path.resolve(realCwd, target);
  if (!isPathInside(realCwd, resolved)) throw new PathRefusedError("path_refused");
  return { realCwd, resolved };
}

/** Where a save will land; computed (and fully validated) before anything is fetched or created. */
export interface SavePlan {
  /** Existing directory (real path, inside the cwd) the missing components are created under. */
  base: string;
  /** Directories still to create below `base`, outermost first. */
  missing: string[];
  name: string;
  finalPath: string;
}

const MAX_NAME_BYTES = 255;

/**
 * Validate a save target without touching the disk: confined to the cwd (realpath of the nearest existing
 * ancestor), a real file name (not `.`/`..`/trailing slash/over-long), and not already present (a file, a
 * directory or a symlink all count). Throws `PathRefusedError`.
 */
export async function planSave(cwd: string, target: string): Promise<SavePlan> {
  if (/[\\/]$/.test(target)) throw new PathRefusedError("path_refused");
  const { realCwd, resolved } = await confineToCwd(cwd, target);
  const name = path.basename(resolved);
  if (resolved === realCwd || name === "." || name === ".." || Buffer.byteLength(name) > MAX_NAME_BYTES) throw new PathRefusedError("path_refused");
  const missing: string[] = [];
  let dir = path.dirname(resolved);
  let base: string | undefined;
  while (base === undefined) {
    try {
      base = await realpath(dir);
    } catch {
      missing.unshift(path.basename(dir));
      dir = path.dirname(dir);
    }
  }
  if (!isPathInside(realCwd, base)) throw new PathRefusedError("path_refused");
  const finalPath = path.join(base, ...missing, name);
  if (await lstat(finalPath).then(() => true, () => false)) throw new PathRefusedError("exists");
  return { base, missing, name, finalPath };
}

/** Create the planned directories and the file: write a temp file next to it, then hard-link it into place (never overwrites), drop the temp. */
export async function commitSave(plan: SavePlan, data: Buffer): Promise<string> {
  let dir = plan.base;
  try {
    for (const m of plan.missing) {
      dir = path.join(dir, m);
      await mkdir(dir).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
    }
  } catch {
    throw new PathRefusedError("path_refused");
  }
  const tmp = path.join(dir, `.pi-google-${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fh = await open(tmp, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0), 0o600);
    try {
      await fh.writeFile(data);
    } finally {
      await fh.close();
    }
    await link(tmp, plan.finalPath);
  } catch (err) {
    throw new PathRefusedError((err as NodeJS.ErrnoException).code === "EEXIST" ? "exists" : "path_refused");
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  return plan.finalPath;
}

/** Save `data` to `target` (relative to `cwd`): missing parent directories are created inside the cwd; an existing target is never overwritten. Returns the written path. */
export async function saveInsideCwd(cwd: string, target: string, data: Buffer): Promise<string> {
  return commitSave(await planSave(cwd, target), data);
}

/** Read a file to upload; its realpath must stay inside `cwd`. */
export async function readInsideCwd(cwd: string, target: string, maxBytes: number = MAX_FILE_BYTES): Promise<Buffer> {
  const { realCwd, resolved } = await confineToCwd(cwd, target);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    throw new PathRefusedError("path_refused");
  }
  if (!isPathInside(realCwd, real)) throw new PathRefusedError("path_refused");
  const st = await stat(real);
  if (!st.isFile()) throw new PathRefusedError("path_refused");
  if (st.size > maxBytes) throw new PathRefusedError("too_large");
  return readFile(real);
}
