/**
 * File discovery + `.srt`-sibling idempotency. Mirrors the Python skill: no arg
 * scans `~/Movies`; a single directory scans it; otherwise args are explicit
 * files. Discovered files sort oldest-first by mtime.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4"]);
export const AUDIO_EXTENSIONS = new Set([".m4a", ".mp3"]);
export const ALL_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

/** Default scan target when no argument is given. */
export function defaultTargetDir(): string {
  return path.join(os.homedir(), "Movies");
}

export function isVideo(file: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Sibling `.srt` path derived from the original file's stem. */
export function srtPath(file: string): string {
  return `${file.replace(/\.[^./\\]+$/, "")}.srt`;
}

/** True when a sibling `.srt` already exists. */
export function isTranscribed(file: string): boolean {
  return fs.existsSync(srtPath(file));
}

function sortByMtime(files: string[]): string[] {
  return files
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((x) => x.f);
}

/** Scan a directory for supported media, oldest-first. */
export function discoverFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir);
  const files = entries
    .map((name) => path.join(dir, name))
    .filter((full) => {
      try {
        return fs.statSync(full).isFile() && ALL_EXTENSIONS.has(path.extname(full).toLowerCase());
      } catch {
        return false;
      }
    });
  return sortByMtime(files);
}

/**
 * Resolve CLI args into files to consider. Throws on missing paths or
 * unsupported extensions in explicit-file mode.
 */
export function resolveInputs(args: string[], target: string = defaultTargetDir()): string[] {
  if (args.length === 0) return discoverFiles(target);

  if (args.length === 1) {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(args[0]);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) return discoverFiles(args[0]);
  }

  const files: string[] = [];
  for (const arg of args) {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(arg);
    } catch {
      stat = undefined;
    }
    if (!stat?.isFile()) throw new Error(`Not a file: ${arg}`);
    if (!ALL_EXTENSIONS.has(path.extname(arg).toLowerCase())) {
      throw new Error(`Unsupported file type: ${arg}`);
    }
    files.push(arg);
  }
  return sortByMtime(files);
}

/** Write SRT content to a file (UTF-8). */
export function saveSrt(file: string, content: string): void {
  fs.writeFileSync(file, content, "utf8");
}
