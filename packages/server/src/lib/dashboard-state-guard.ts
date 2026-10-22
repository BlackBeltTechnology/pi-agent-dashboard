/**
 * Dashboard secrets out of reach of the path-taking routes.
 *
 * `~/.pi/dashboard/` holds the local IPC token (`local/token`), the server
 * identity key and `config.json` (which carries the auth HMAC secret). The file
 * routes anchor on `[cwd, ~/.pi]`, and a session cwd of `$HOME` contains them
 * too, so any running session used to let a bare-loopback caller read them.
 *
 * Two tiers, decided on REAL paths (symlinks resolved on both sides):
 *   - **always** — `<dir>/local/**` and `<dir>/identity.key`: refused for every
 *     caller in every mode. This tier is the recorded exception to
 *     rollback-by-flag (`requireLocalProof: false` does not reopen it).
 *   - **gated** — the rest of `<dir>`: refused unless the caller is locally
 *     trusted NOW (proof, or the strict default is off) or holds a login
 *     session. A caller that passes then falls through to the ordinary anchors.
 *
 * The caller is supplied per request through an `AsyncLocalStorage` set by one
 * `onRequest` hook, so every containment decision made while serving that
 * request sees it without each site threading a request through. With no caller
 * in scope (internal, non-HTTP code) only the always-refused tier applies.
 *
 * `handleIsAlwaysRefused` closes the check-then-open race: after opening, the
 * handle's (dev, ino) is compared with each always-refused file, so a symlink
 * swapped in between the path check and the open is still caught. The
 * trust-gated tier keeps only the pre-open check (its residual race is
 * documented in the design).
 *
 * Deliberately NOT built on `access/verified-read.ts`: that is grant-only and
 * `lstat`-based, and would regress in-scope symlink reads.
 *
 * See change: close-container-loopback-impersonation (D8).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

type DashboardStateTier = "always" | "gated";

/** What the guard needs to know about the caller of the current request. */
export interface StateCaller {
  /** May the trust-gated tier be read? (locally trusted now, or a login session) */
  gatedAdmitted(): boolean;
  /** Is this a bare-loopback caller that only lacks local proof? (never raises an operator prompt) */
  unproven(): boolean;
}

const callers = new AsyncLocalStorage<StateCaller>();

/** Run `fn` with `caller` in scope for every containment decision it (transitively) makes. */
export function runWithStateCaller<T>(caller: StateCaller, fn: () => T): T {
  return callers.run(caller, fn);
}

/** The caller of the request being served, if any. */
export function currentStateCaller(): StateCaller | undefined {
  return callers.getStore();
}

/** Resolve symlinks; for a path that does not exist, resolve the nearest existing ancestor and re-append the tail. */
async function realpathLoose(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realpathLoose(parent), path.basename(p));
  }
}

// Compared case-insensitively everywhere: macOS/Windows volumes are case-insensitive (`Local/Token` IS the token),
// and on a case-sensitive volume the only cost is refusing a differently-cased name inside the dashboard dir.
const norm = (s: string): string => s.toLowerCase();

let cachedFor = "";
let cachedReal = "";
async function realDashboardDir(): Promise<string> {
  // Recomputed when HOME changes (tests reassign it; `os.homedir()` follows it).
  const key = `${os.homedir()}`;
  if (cachedFor !== key) {
    cachedReal = await realpathLoose(getDashboardConfigDir());
    cachedFor = key;
  }
  return cachedReal;
}

/** The tier of a path that is ALREADY a real path, relative to the real dashboard dir; `null` outside it. */
function tierWithin(realDir: string, realTarget: string): DashboardStateTier | null {
  const rel = path.relative(norm(realDir), norm(realTarget));
  if (rel === "") return "gated";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const first = rel.split(path.sep)[0];
  if (first === "local" || rel === "identity.key") return "always";
  return "gated";
}

/**
 * Is `target` (any spelling: relative symlinks, `~` already expanded) inside the
 * dashboard state dir, and which tier? Realpath-based, so a symlink INTO the dir
 * and a `$HOME` symlink are both seen through.
 */
export async function isDashboardStatePath(target: string): Promise<DashboardStateTier | null> {
  const [realDir, realTarget] = await Promise.all([realDashboardDir(), realpathLoose(path.resolve(target))]);
  return tierWithin(realDir, realTarget);
}

/**
 * Must the current caller be refused this path? Always-refused tier: every caller.
 * Trust-gated tier: unless the request's caller is admitted (no caller in scope ⇒ internal ⇒ admitted).
 */
export async function dashboardStateRefuses(target: string): Promise<boolean> {
  const tier = await isDashboardStatePath(target);
  if (tier === null) return false;
  if (tier === "always") return true;
  const caller = currentStateCaller();
  return caller ? !caller.gatedAdmitted() : false;
}

/** Is the current request's caller a bare-loopback one that merely lacks proof? */
export function currentCallerUnproven(): boolean {
  return currentStateCaller()?.unproven() === true;
}

async function alwaysRefusedFiles(realDir: string): Promise<string[]> {
  const out: string[] = [path.join(realDir, "identity.key")];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) await walk(full, depth + 1);
      } else {
        out.push(full);
      }
    }
  };
  await walk(path.join(realDir, "local"), 0);
  return out;
}

/**
 * After OPENING a path, is the handle one of the always-refused files? Compares
 * (dev, ino) of the handle with each always-refused file, so a symlink or hard
 * link swapped in after the path check is caught. Fails closed on a stat error
 * of the HANDLE; a vanished always-refused file simply cannot match.
 */
export async function handleIsAlwaysRefused(handle: { stat(): Promise<{ dev: number | bigint; ino: number | bigint }> }): Promise<boolean> {
  const hs = await handle.stat();
  const realDir = await realDashboardDir();
  for (const file of await alwaysRefusedFiles(realDir)) {
    try {
      const st = await fs.stat(file);
      if (st.ino === hs.ino && st.dev === hs.dev) return true;
    } catch {
      /* absent: cannot be the opened file */
    }
  }
  return false;
}

let cachedSyncFor = "";
let cachedSyncReal = "";
/**
 * Synchronous "is this directory the dashboard state dir itself?" for the one sync walker (the JS grep
 * fallback), so it never enters the dir. Cheap: only a directory whose BASE NAME matches the state dir's
 * is resolved. Compared on real paths, like {@link isDashboardStatePath}.
 */
export function isDashboardStateDirSync(dir: string): boolean {
  const configured = getDashboardConfigDir();
  if (norm(path.basename(dir)) !== norm(path.basename(configured))) return false;
  const key = `${os.homedir()}`;
  if (cachedSyncFor !== key) {
    try {
      cachedSyncReal = realpathSync(configured);
    } catch {
      cachedSyncReal = path.resolve(configured);
    }
    cachedSyncFor = key;
  }
  try {
    return norm(realpathSync(dir)) === norm(cachedSyncReal);
  } catch {
    return false;
  }
}

/** Thrown when an OPENED handle turned out to be one of the always-refused files. */
export class DashboardStateRefused extends Error {
  constructor() {
    super("refused: dashboard state file");
    this.name = "DashboardStateRefused";
  }
}

/**
 * `fs.open` + the post-open handle check. A refused handle is closed at once and
 * nothing is read from it.
 */
export async function openStateChecked(
  p: string,
  flags: string | number = "r",
): Promise<import("node:fs/promises").FileHandle> {
  const fh = await fs.open(p, flags);
  try {
    if (await handleIsAlwaysRefused(fh)) throw new DashboardStateRefused();
  } catch (err) {
    await fh.close().catch(() => undefined);
    throw err;
  }
  return fh;
}

/** `fs.readFile` through {@link openStateChecked}: the bytes come from the checked handle. */
export async function readFileStateChecked(p: string): Promise<Buffer>;
export async function readFileStateChecked(p: string, encoding: BufferEncoding): Promise<string>;
export async function readFileStateChecked(p: string, encoding?: BufferEncoding): Promise<Buffer | string> {
  const fh = await openStateChecked(p, "r");
  try {
    return encoding ? await fh.readFile(encoding) : await fh.readFile();
  } finally {
    await fh.close().catch(() => undefined);
  }
}
