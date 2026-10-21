/**
 * Content hash of a runtime plugin's client asset root (`clientBundle` directory), design D12 / R2 / R15.
 *
 * `sha256` over the sorted `(relpath, sha256(file))` list of the directory's allowlisted
 * (`PLUGIN_ASSET_MIME`, optionally `.gz`-suffixed), realpath-confined files. Dotfiles are skipped (the
 * server never serves them); symlinked files resolving outside the root are never hashed; symlinked
 * directories are not followed.
 *
 * Recomputed on EVERY read, behind a per-file stat cache keyed by `(relpath, size, mtimeMs, ino, ctimeMs)`:
 * a file is re-digested only when that tuple changes. `mtimeMs` alone is not enough (npm normalises mtimes
 * and a same-size update would keep the old digest); `ino`/`ctimeMs` change on every write or rename and
 * cannot be set by the package. `clear()` drops every cached digest (discovery refresh, package-operation
 * completion). No wildcard pin exists.
 *
 * See change: decouple-plugins-from-core (task 6.7).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isWithin, PLUGIN_ASSET_MIME } from "./confined-static.js";

export interface ContentHasher {
  /** Content hash of `dir`, or `undefined` when it does not exist / is not a directory. */
  hashDir(dir: string): string | undefined;
  /** Drop every cached per-file digest. */
  clear(): void;
  /** Number of file digests computed since creation (cache-effectiveness probe for tests). */
  readonly digestCalls: number;
}

interface CachedDigest {
  key: string;
  digest: string;
}

function allowlisted(name: string): boolean {
  const base = name.endsWith(".gz") ? name.slice(0, -3) : name;
  const ext = path.extname(base).toLowerCase();
  return ext !== "" && PLUGIN_ASSET_MIME[ext] !== undefined;
}

/** Real path of a hashable file entry (allowlisted; a symlink must resolve to a file inside `root`), else `null`. */
function hashableReal(abs: string, e: fs.Dirent, root: string): string | null {
  if (!(e.isFile() || e.isSymbolicLink()) || !allowlisted(e.name)) return null;
  if (!e.isSymbolicLink()) return abs;
  try {
    const real = fs.realpathSync(abs);
    return isWithin(real, root) ? real : null; // symlink escape: never hashed
  } catch {
    return null;
  }
}

/** Child directory / hashable-file entries of `dir` (dotfiles skipped); `[]` when unreadable. */
function readEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
  } catch {
    return [];
  }
}

/** Relative posix paths + absolute real paths of the hashable files under real root `root`. */
function listFiles(root: string): Array<{ rel: string; real: string }> {
  const out: Array<{ rel: string; real: string }> = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of readEntries(dir)) {
      const abs = path.join(dir, e.name);
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      const real = e.isDirectory() ? null : hashableReal(abs, e, root);
      if (e.isDirectory()) walk(abs, rel);
      else if (real) out.push({ rel, real });
    }
  };
  walk(root, "");
  return out;
}

/** Real directory of `dir`, or `undefined` when it is absent / not a directory. */
function realDir(dir: string): string | undefined {
  try {
    const root = fs.realpathSync(dir);
    return fs.statSync(root).isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
}

export function createContentHasher(opts: { digestFile?: (file: string) => string } = {}): ContentHasher {
  const digestFile = opts.digestFile ?? ((file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  // root → rel → cached digest. Entries of files no longer present are dropped on each walk.
  const cache = new Map<string, Map<string, CachedDigest>>();
  let digestCalls = 0;

  /** Digest of `real`, reusing `hit` while its stat key is unchanged; `undefined` when the file is unreadable / not a file. */
  const digestOf = (real: string, hit: CachedDigest | undefined): CachedDigest | undefined => {
    let st: fs.Stats;
    try {
      st = fs.statSync(real);
    } catch {
      return undefined;
    }
    if (!st.isFile()) return undefined;
    const key = `${st.size}:${st.mtimeMs}:${st.ino}:${st.ctimeMs}`;
    if (hit && hit.key === key) return hit;
    try {
      const digest = digestFile(real);
      digestCalls++;
      return { key, digest };
    } catch {
      return undefined;
    }
  };

  return {
    hashDir(dir) {
      const root = realDir(dir);
      if (!root) return undefined;
      const previous = cache.get(root) ?? new Map<string, CachedDigest>();
      const next = new Map<string, CachedDigest>();
      const lines: string[] = [];
      for (const { rel, real } of listFiles(root).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
        const entry = digestOf(real, previous.get(rel));
        if (!entry) continue;
        next.set(rel, entry);
        lines.push(`${rel}\0${entry.digest}\n`);
      }
      cache.set(root, next);
      return crypto.createHash("sha256").update(lines.join("")).digest("hex");
    },
    clear() {
      cache.clear();
    },
    get digestCalls() {
      return digestCalls;
    },
  };
}
