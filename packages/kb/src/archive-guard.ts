// Traversal-safe archive extraction (change: harden-untrusted-content-ingestion,
// design D4 / B13). The archive is LISTED and validated first; any absolute, `..`,
// control-char or non-file (link/device/fifo) entry rejects the whole archive.
// Names and types come from two listings matched by line index — names are never
// parsed out of a verbose line, so ` -> ` and spaces in names are harmless.
// Fail closed: an unparseable listing, a count mismatch or a non-zero exit rejects.
import { execFileSync } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns tar/zip listing + extract for the https resolver)
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

export type ArchiveKind = "tar" | "zip";
export interface ArchiveLimits { maxEntries?: number; maxExpandedBytes?: number }
export const DEFAULT_MAX_ENTRIES = 50_000;
export const DEFAULT_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

const ENV = { ...process.env, LC_ALL: "C" };
const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: "latin1", env: ENV, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

/** Decode tar's C-locale escapes (`\NNN`, `\t`, `\n`, `\\` …) to a latin1 byte string. */
function decodeTarName(raw: string): string {
  const simple: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"' };
  return raw.replace(/\\([0-7]{1,3}|.)/gs, (_m, c: string) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8) & 0xff) : (simple[c] ?? `\\${c}`)));
}

function checkName(name: string, display: string): void {
  if (name.length === 0) throw new Error(`unsafe archive entry: empty name`);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) throw new Error(`unsafe archive entry (control character): ${JSON.stringify(display)}`);
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) throw new Error(`unsafe archive entry (absolute path): ${display}`);
  if (name.split(/[\\/]/).includes("..")) throw new Error(`unsafe archive entry (.. segment): ${display}`);
}

const lines = (s: string): string[] => {
  const l = s.split("\n");
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
};

/** Validate a tar archive (any compression the host tar auto-detects). Throws on any unsafe entry. */
function validateTar(archive: string, maxEntries: number): void {
  const names = lines(run("tar", ["-tf", archive]));
  const verbose = lines(run("tar", ["-tvf", archive]));
  if (names.length > maxEntries) throw new Error(`archive has too many entries (${names.length} > ${maxEntries})`);
  if (names.length !== verbose.length) throw new Error(`cannot validate archive: listing mismatch (${names.length} names vs ${verbose.length} entries)`);
  for (let i = 0; i < names.length; i++) {
    const v = verbose[i];
    const type = v[0];
    if (type !== "-" && type !== "d") throw new Error(`unsafe archive entry (type '${type}'): ${names[i]}`);
    // bsdtar renders a hardlink as `-… name link to target`; reject fail-closed.
    if (v.includes(" link to ") || v.includes(" ==> ")) throw new Error(`unsafe archive entry (link): ${names[i]}`);
    checkName(decodeTarName(names[i]), names[i]);
  }
}

/** Validate a zip archive. Throws on any unsafe entry; returns `true` when it is empty. */
function validateZip(archive: string, maxEntries: number): boolean {
  let header: string;
  try {
    header = run("unzip", ["-Z", archive]);
  } catch (e) {
    // `Empty zipfile.` exits 1 — recover its stdout and look at the entry count.
    header = String((e as { stdout?: unknown }).stdout ?? "");
    if (!/number of entries: 0\b/.test(header)) throw e;
  }
  const hl = lines(header);
  const sizeIdx = hl.findIndex((l) => l.startsWith("Zip file size:"));
  const count = Number(/number of entries: (\d+)/.exec(hl[sizeIdx] ?? "")?.[1]);
  if (sizeIdx < 0 || !Number.isInteger(count)) throw new Error("cannot validate archive: unparseable zip listing");
  if (count > maxEntries) throw new Error(`archive has too many entries (${count} > ${maxEntries})`);
  if (count === 0) return true; // `unzip -Z1` prints `Empty zipfile.` and exits 1
  const names = lines(run("unzip", ["-Z1", archive]));
  const typeLines = hl.slice(sizeIdx + 1, sizeIdx + 1 + count);
  if (names.length !== count || typeLines.length !== count) throw new Error(`cannot validate archive: zip listing mismatch (${names.length} names, ${typeLines.length} types, ${count} entries)`);
  for (let i = 0; i < count; i++) {
    const type = typeLines[i][0];
    if (type !== "-" && type !== "d") throw new Error(`unsafe archive entry (type '${type}'): ${names[i]}`);
    // Info-ZIP renders control characters as ^X (fail-closed for a literal `^A`).
    if (/\^[@-_]/.test(names[i])) throw new Error(`unsafe archive entry (control character): ${JSON.stringify(names[i])}`);
    checkName(names[i], names[i]);
  }
  return false;
}

/**
 * Stream the archive's decompressed content to a bounded buffer BEFORE extracting to disk:
 * a decompression bomb (tiny download, huge expansion) aborts once `maxBytes` is exceeded.
 */
function assertExpandedWithin(cmd: string, args: string[], maxBytes: number): void {
  try {
    execFileSync(cmd, args, { env: ENV, stdio: ["ignore", "pipe", "pipe"], maxBuffer: maxBytes });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOBUFS") throw new Error(`archive expands beyond the ${maxBytes}-byte limit`);
    throw e;
  }
}

/** Walk `out` and reject any symlink, escaping realpath or multiply-linked file (backstop, not the control). */
function backstopWalk(out: string): void {
  const root = realpathSync(out);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(`extracted symlink rejected: ${p}`);
      const real = realpathSync(p);
      if (real !== root && !real.startsWith(root + sep)) throw new Error(`extracted entry escapes destination: ${p}`);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.nlink > 1) throw new Error(`extracted hardlink rejected: ${p}`);
    }
  };
  walk(root);
}

/**
 * Validate `archive`, then extract it into the (fresh, empty) `outDir`, then run
 * the post-extraction backstop. Throws before extracting on any unsafe entry.
 */
export function extractArchiveSafely(kind: ArchiveKind, archive: string, outDir: string, limits: ArchiveLimits = {}): void {
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = limits.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;
  if (kind === "zip") {
    const empty = validateZip(archive, maxEntries);
    if (!empty) {
      assertExpandedWithin("unzip", ["-p", archive], maxBytes);
      run("unzip", ["-o", "-q", archive, "-d", outDir]);
    }
  } else {
    validateTar(archive, maxEntries);
    assertExpandedWithin("tar", ["-xOf", archive], maxBytes);
    run("tar", ["-xf", archive, "-C", outDir, "--no-same-owner"]);
  }
  backstopWalk(outDir);
}
