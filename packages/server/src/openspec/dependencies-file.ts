/**
 * Filesystem half of `GET` / `PUT /api/openspec/dependencies`: a fresh read of
 * one change's `dependencies.yaml` and the contained, preconditioned, atomic
 * write. Route gates, the workflow-schema write guard and the per-cwd lock live
 * in the route; this module owns containment, symlink refusal and the write.
 *
 * See change: add-openspec-change-dependencies.
 */
import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DEPENDENCIES_FILE,
  type DeclaredDependencies,
  type FileStat,
  readDependenciesFile,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";

export interface DeclaredRead {
  declared: DeclaredDependencies | null;
  declaredError: string | null;
  file: FileStat | null;
}

async function lstatOrNull(p: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

/** `<root>/openspec/changes/<change>` for a canonical project root. */
const changeDirOf = (root: string, change: string): string => path.join(root, "openspec", "changes", change);

/** Read the file fresh under the read rules; a symlinked change directory is never read through. */
export async function readDeclared(root: string, change: string): Promise<DeclaredRead> {
  const dir = changeDirOf(root, change);
  const st = await lstatOrNull(dir);
  if (!st?.isDirectory()) {
    return { declared: null, declaredError: st ? "change directory is a symlink or not a directory" : null, file: null };
  }
  const r = await readDependenciesFile(path.join(dir, DEPENDENCIES_FILE));
  if (r.kind === "absent") return { declared: null, declaredError: null, file: null };
  if (r.kind === "invalid") return { declared: null, declaredError: r.error, file: r.stat ?? null };
  return { declared: r.value, declaredError: null, file: r.stat };
}

export type WriteOutcome =
  | { ok: true; file: FileStat }
  | { ok: false; status: 403 | 409 | 500; reason: "write-refused" | "modified" | "write-failed"; error: string };

const refused = (error: string): WriteOutcome => ({ ok: false, status: 403, reason: "write-refused", error });
const modified = (error: string): WriteOutcome => ({ ok: false, status: 409, reason: "modified", error });

/**
 * Write `content` as the change's `dependencies.yaml`.
 *
 * Containment first: the change directory and an existing file must be real
 * (non-symlink) and the directory's realpath must sit under the canonical
 * `<root>/openspec/changes/`. Then the precondition `expected` (the `file` value
 * GET returned): `null` = the file must not exist; otherwise mtime and size must
 * both match. The content goes to a temp file in the same directory and is moved
 * into place — `rename` when replacing, `link` (no replace) when creating.
 */
export async function writeDependenciesFile(args: {
  root: string;
  change: string;
  content: string;
  expected: FileStat | null;
}): Promise<WriteOutcome> {
  const { root, change, content, expected } = args;
  const dir = changeDirOf(root, change);
  const dirStat = await lstatOrNull(dir);
  if (!dirStat || dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    return refused("the change directory is missing, a symlink, or not a directory");
  }
  let changesReal: string;
  let dirReal: string;
  try {
    changesReal = await fsp.realpath(path.join(root, "openspec", "changes"));
    dirReal = await fsp.realpath(dir);
  } catch {
    return refused("cannot resolve the change directory");
  }
  if (!(dirReal + path.sep).startsWith(changesReal + path.sep)) {
    return refused("the change directory resolves outside openspec/changes/");
  }

  const target = path.join(dirReal, DEPENDENCIES_FILE);
  const existing = await lstatOrNull(target);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    return refused("dependencies.yaml is a symlink or not a regular file");
  }
  if (expected === null) {
    if (existing) return modified("dependencies.yaml was created after it was read");
  } else if (!existing || existing.mtimeMs !== expected.mtimeMs || existing.size !== expected.size) {
    return modified("dependencies.yaml changed since it was read");
  }

  const tmp = path.join(dirReal, `.dependencies.yaml.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fsp.writeFile(tmp, content, { flag: "wx", mode: 0o644 });
    if (expected === null) {
      try {
        await fsp.link(tmp, target); // exclusive: never replaces
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return modified("dependencies.yaml was created after it was read");
        throw err;
      }
    } else {
      await fsp.rename(tmp, target);
    }
    const st = await fsp.stat(target);
    return { ok: true, file: { mtimeMs: st.mtimeMs, size: st.size } };
  } catch (err) {
    return { ok: false, status: 500, reason: "write-failed", error: `could not write dependencies.yaml: ${(err as Error).message}` };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}
