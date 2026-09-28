/**
 * Session-cwd confinement for attachment save / attach (design D6).
 * - Windows device / UNC / drive forms rejected outright.
 * - Containment via `isPathInside` on the REALPATH of the parent directory
 *   (a symlinked parent that escapes the cwd is refused).
 * - Create with `wx` + `O_NOFOLLOW` where available: never overwrites, never
 *   follows a final-component symlink.
 * Residual risk (documented, not prevented): a parent directory swapped for a
 * symlink between the check and the create (TOCTOU).
 * See change: add-gmail-plugin.
 */
import { constants as fsc } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "@blackbelt-technology/pi-dashboard-shared/path-containment.js";

export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

class PathRefusedError extends Error {
  constructor(readonly code: "path_refused" | "exists" | "too_large") {
    super(
      code === "exists"
        ? "path_refused: target already exists (attachments never overwrite)"
        : code === "too_large"
          ? "path_refused: file exceeds the 20 MiB attachment limit"
          : "path_refused: path must stay inside the session working directory",
    );
    this.name = "PathRefusedError";
  }
}

/** Device (`\\?\`, `\\.\`), UNC (`\\host`) and drive-letter (`C:`) forms. */
function isWindowsSpecial(p: string): boolean {
  return /^[\\/]{2}/.test(p) || /^[a-zA-Z]:/.test(p) || p.includes("\0");
}

async function confined(cwd: string, target: string): Promise<{ realCwd: string; resolved: string }> {
  if (!target || isWindowsSpecial(target)) throw new PathRefusedError("path_refused");
  const realCwd = await realpath(cwd);
  const resolved = path.resolve(realCwd, target);
  if (!isPathInside(realCwd, resolved)) throw new PathRefusedError("path_refused");
  return { realCwd, resolved };
}

/** Save `data` to `target` (relative to `cwd`), exclusive + no-follow. Returns the written path. */
export async function saveInsideCwd(cwd: string, target: string, data: Buffer): Promise<string> {
  const { realCwd, resolved } = await confined(cwd, target);
  let realParent: string;
  try {
    realParent = await realpath(path.dirname(resolved));
  } catch {
    throw new PathRefusedError("path_refused");
  }
  if (!isPathInside(realCwd, realParent)) throw new PathRefusedError("path_refused");
  const finalPath = path.join(realParent, path.basename(resolved));
  const flags = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0);
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(finalPath, flags, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new PathRefusedError(code === "EEXIST" || code === "ELOOP" ? "exists" : "path_refused");
  }
  try {
    await fh.writeFile(data);
  } finally {
    await fh.close();
  }
  return finalPath;
}

/** Read a file to attach; its realpath must stay inside `cwd`. */
export async function readInsideCwd(cwd: string, target: string): Promise<Buffer> {
  const { realCwd, resolved } = await confined(cwd, target);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    throw new PathRefusedError("path_refused");
  }
  if (!isPathInside(realCwd, real)) throw new PathRefusedError("path_refused");
  const st = await stat(real);
  if (!st.isFile()) throw new PathRefusedError("path_refused");
  if (st.size > MAX_ATTACH_BYTES) throw new PathRefusedError("too_large");
  return readFile(real);
}
