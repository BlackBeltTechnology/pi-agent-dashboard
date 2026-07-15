/**
 * Project / package layout resolution.
 *
 * Port of `resolve_package` / `load_shots`. Accepts a project dir, a
 * `video_production` dir, or a `shots` dir, and locates the `shots/*.md`
 * package plus the base dir that image paths resolve against.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseShotFile, type Shot, shotShort } from "./shots.js";

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function shotFilesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^shot_.*\.md$/.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface ResolvedPackage {
  /** Directory containing the `shot_*.md` files. */
  shotsDir: string;
  /** Package root that image paths resolve against (parent of `shots/`). */
  baseDir: string;
}

/**
 * Given a project dir, a `video_production` dir, or a `shots` dir, return the
 * shots dir + package base dir.
 */
export function resolvePackage(target: string): ResolvedPackage {
  const p = path.resolve(expandHome(target));
  if (!fs.existsSync(p)) throw new Error(`path does not exist: ${p}`);

  // direct shots dir
  if (isDir(p) && shotFilesIn(p).length > 0) {
    return { shotsDir: p, baseDir: path.dirname(p) };
  }
  // video_production dir
  const shots = path.join(p, "shots");
  if (isDir(shots) && shotFilesIn(shots).length > 0) {
    return { shotsDir: shots, baseDir: p };
  }
  // project dir -> video_production/shots
  const vpShots = path.join(p, "video_production", "shots");
  if (isDir(vpShots) && shotFilesIn(vpShots).length > 0) {
    return { shotsDir: vpShots, baseDir: path.join(p, "video_production") };
  }
  throw new Error(
    `could not find shot_*.md under ${p} (looked in ., ./shots, ./video_production/shots)`,
  );
}

export interface LoadedShots {
  shots: Shot[];
  baseDir: string;
}

/** Parse all (or a subset of) shots for a project. */
export function loadShots(target: string, names?: string[]): LoadedShots {
  const { shotsDir, baseDir } = resolvePackage(target);
  const files = shotFilesIn(shotsDir).sort();
  let shots = files.map((f) => parseShotFile(f, baseDir));
  if (names && names.length > 0) {
    const wantedShort = new Set(names.map((n) => n.toLowerCase().replace(/^shot_/, "")));
    const wantedFull = new Set(names.map((n) => n.toLowerCase()));
    shots = shots.filter(
      (s) => wantedShort.has(shotShort(s).toLowerCase()) || wantedFull.has(s.name.toLowerCase()),
    );
  }
  return { shots, baseDir };
}
