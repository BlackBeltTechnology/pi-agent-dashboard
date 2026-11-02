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
 * **pi-agent credential files** (`AGENT_CREDENTIAL_NAMES`) are a second always-refused
 * class: `<agentDir>/<name>` and any same-directory `<name>.*` sibling (quarantine /
 * backup copies). The agent dirs are `resolvePiAgentDir()` (server env only) ∪
 * `<home>/.pi/agent`, de-duplicated on real path and recomputed per call (so a HOME /
 * `PI_CODING_AGENT_DIR` change is followed). Only the entry whose OWN basename matches
 * is refused (`models.json.d/frag.json` is admitted); hard links and swapped symlinks
 * are caught by the post-open (dev, ino) recheck. Case: exact compare on a
 * case-sensitive volume, folded only where a cached per-dir probe says the volume folds
 * (a failed probe counts as folding: over-refuse, never under-refuse).
 * To protect a new pi credential file: add its name to `AGENT_CREDENTIAL_NAMES` (fixed
 * list, no glob) and to `docs/security/residual-risks.md`.
 *
 * Residuals (accepted): a session's own `PI_CODING_AGENT_DIR` override is invisible to
 * the server (only the server env is read); the JS grep walker reads a hard-linked
 * credential file before the route's identity filter drops its matches; the
 * `rendered-pdf` converter takes a path, so a swap after its last checked open is
 * not caught (its output is a PDF rendering, never the bytes).
 *
 * See change: close-container-loopback-impersonation (D8), close-security-map-high-findings (D1).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDashboardConfigDir, resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

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

/**
 * Fixed, auditable set of pi-agent credential files (relative to an agent dir; `/` separates
 * path segments). No glob: `settings.json`, `trust.json` etc. stay readable.
 */
const AGENT_CREDENTIAL_NAMES: readonly string[] = [
  "auth.json",
  "mcp-auth.json",
  "providers.json",
  "plugin-credentials.json",
  "models.json",
  "mcp.json",
  "system-one/auth.json",
];

/** Real, de-duplicated agent dirs (server env ∪ `<home>/.pi/agent`); recomputed per call, never cached. */
async function agentCredentialDirs(): Promise<string[]> {
  const dirs = [resolvePiAgentDir(), path.join(os.homedir(), ".pi", "agent")];
  const real = await Promise.all(dirs.map((d) => realpathLoose(path.resolve(d))));
  return [...new Set(real)];
}

function agentCredentialDirsSync(): string[] {
  const dirs = [resolvePiAgentDir(), path.join(os.homedir(), ".pi", "agent")];
  return [...new Set(dirs.map((d) => realpathLooseSync(path.resolve(d))))];
}

function realpathLooseSync(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathLooseSync(parent), path.basename(p));
  }
}

const swapCase = (s: string): string =>
  [...s].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");

/** One probe per directory per process: does its volume fold case? (failure ⇒ true: over-refuse.) */
const foldProbes = new Map<string, Promise<boolean>>();
function volumeFolds(dir: string): Promise<boolean> {
  let probe = foldProbes.get(dir);
  if (!probe) {
    probe = (async () => {
      const base = path.basename(dir);
      const swapped = swapCase(base);
      if (swapped === base) return true; // no letters to swap: cannot tell
      const alt = path.join(path.dirname(dir), swapped);
      try {
        const a = await fs.stat(alt);
        const o = await fs.stat(dir);
        return a.dev === o.dev && a.ino === o.ino;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          try {
            await fs.stat(dir);
            return false; // the real dir exists, the swapped name does not: case-sensitive
          } catch {
            return true; // ENOENT on both: cannot tell
          }
        }
        return true;
      }
    })();
    foldProbes.set(dir, probe);
  }
  return probe;
}

/** Test seam: drop the cached volume probes. */
export function __resetCredentialVolumeProbes(): void {
  foldProbes.clear();
}

/** Segments of a credential name joined onto an agent dir. */
const credFile = (dir: string, name: string): string => path.join(dir, ...name.split("/"));

/**
 * Does REAL `realTarget` name a credential file of agent dir `dir` (exact entry or a same-dir `<name>.*` sibling)?
 * Exact compare first; the volume probe runs ONLY when a case-folded compare matches but the exact one does
 * not (so an unrelated path costs no probe), and then decides whether the fold counts.
 */
async function isCredentialIn(dir: string, realTarget: string): Promise<boolean> {
  const matches = (fold: boolean, t: string, c: string): boolean => (fold ? norm(t) === norm(c) : t === c);
  const nameMatch = (fold: boolean, cred: string): boolean => {
    const base = path.basename(cred);
    const tb = path.basename(realTarget);
    if (!matches(fold, path.dirname(realTarget), path.dirname(cred))) return false;
    return matches(fold, tb, base) || (tb.length > base.length && matches(fold, tb.slice(0, base.length + 1), `${base}.`));
  };
  let foldOnly = false;
  for (const name of AGENT_CREDENTIAL_NAMES) {
    const cred = credFile(dir, name);
    if (nameMatch(false, cred)) return true;
    if (nameMatch(true, cred)) foldOnly = true;
  }
  if (foldOnly && (await volumeFolds(dir))) return true;
  // A credential file that is itself a symlink: its destination is the credential too.
  for (const name of AGENT_CREDENTIAL_NAMES) {
    const cred = credFile(dir, name);
    let real: string;
    try {
      real = await fs.realpath(cred);
    } catch {
      continue;
    }
    if (real !== cred && real === realTarget) return true;
  }
  return false;
}

/** Is REAL path `realTarget` a pi-agent credential file (or same-dir `<name>.*` sibling)? */
async function isAgentCredentialReal(realTarget: string): Promise<boolean> {
  for (const dir of await agentCredentialDirs()) {
    if (await isCredentialIn(dir, realTarget)) return true;
  }
  return false;
}

/**
 * Synchronous "is this file a pi-agent credential file?" for the JS grep walker, so it never reads one.
 * Basename pre-filter first (cheap), then a `realpathSync` compare. Folds case unconditionally (a
 * differently-cased name is merely skipped by the search fallback).
 */
export function isAgentCredentialFileSync(full: string): boolean {
  const base = norm(path.basename(full));
  const candidate = AGENT_CREDENTIAL_NAMES.some((n) => {
    const b = norm(path.basename(n));
    return base === b || base.startsWith(`${b}.`);
  });
  if (!candidate) return false;
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return false;
  }
  const targetDir = norm(path.dirname(real));
  const targetBase = norm(path.basename(real));
  for (const dir of agentCredentialDirsSync()) {
    for (const name of AGENT_CREDENTIAL_NAMES) {
      const cred = credFile(dir, name);
      const b = norm(path.basename(cred));
      if (norm(path.dirname(cred)) === targetDir && (targetBase === b || targetBase.startsWith(`${b}.`))) return true;
      try {
        if (norm(realpathSync(cred)) === norm(real)) return true;
      } catch {
        /* absent */
      }
    }
  }
  return false;
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
 * dashboard state dir (and which tier), or a pi-agent credential file (`"always"`)? Realpath-based, so
 * a symlink INTO the dir and a `$HOME` symlink are both seen through.
 */
export async function isDashboardStatePath(target: string): Promise<DashboardStateTier | null> {
  const [realDir, realTarget] = await Promise.all([realDashboardDir(), realpathLoose(path.resolve(target))]);
  const tier = tierWithin(realDir, realTarget);
  if (tier === "always") return tier;
  if (await isAgentCredentialReal(realTarget)) return "always";
  return tier;
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
  // pi-agent credential files + their same-dir `<name>.*` siblings (one readdir per credential dir).
  for (const dir of await agentCredentialDirs()) {
    let folds: boolean | undefined; // probed lazily: only when a case-only sibling match needs it
    const byDir = new Map<string, string[]>();
    for (const name of AGENT_CREDENTIAL_NAMES) {
      const cred = credFile(dir, name);
      out.push(cred);
      const d = path.dirname(cred);
      byDir.set(d, [...(byDir.get(d) ?? []), path.basename(cred)]);
    }
    for (const [d, bases] of byDir) {
      let names: string[];
      try {
        names = await fs.readdir(d);
      } catch {
        continue; // best effort: the named files above are still rechecked
      }
      for (const n of names) {
        if (bases.some((b) => n.startsWith(`${b}.`))) {
          out.push(path.join(d, n));
        } else if (bases.some((b) => norm(n).startsWith(`${norm(b)}.`))) {
          folds ??= await volumeFolds(dir);
          if (folds) out.push(path.join(d, n));
        }
      }
    }
  }
  return out;
}

/** (dev, ino) of every always-refused file that exists right now. Build once per request, reuse across checks. */
export type AlwaysRefusedIdentities = ReadonlyArray<{ dev: number | bigint; ino: number | bigint }>;
export async function alwaysRefusedIdentities(): Promise<AlwaysRefusedIdentities> {
  const out: Array<{ dev: number | bigint; ino: number | bigint }> = [];
  for (const file of await alwaysRefusedFiles(await realDashboardDir())) {
    try {
      const st = await fs.stat(file);
      out.push({ dev: st.dev, ino: st.ino });
    } catch {
      /* absent: cannot be the opened file */
    }
  }
  return out;
}

/** Is `(dev, ino)` an always-refused file? Pass a prebuilt `identities` list to amortize across many checks. */
export async function identityIsAlwaysRefused(
  id: { dev: number | bigint; ino: number | bigint },
  identities?: AlwaysRefusedIdentities,
): Promise<boolean> {
  const list = identities ?? (await alwaysRefusedIdentities());
  return list.some((f) => f.ino === id.ino && f.dev === id.dev);
}

/**
 * After OPENING a path, is the handle one of the always-refused files? Compares
 * (dev, ino) of the handle with each always-refused file, so a symlink or hard
 * link swapped in after the path check is caught. Fails closed on a stat error
 * of the HANDLE; a vanished always-refused file simply cannot match.
 */
export async function handleIsAlwaysRefused(handle: { stat(): Promise<{ dev: number | bigint; ino: number | bigint }> }): Promise<boolean> {
  return identityIsAlwaysRefused(await handle.stat());
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

/**
 * Plugin seam (`ServerPluginContext.readFileGuarded`): UTF-8 read of `absPath` that resolves `null` when
 * the guard refuses it — decided on the REAL path (both tiers, caller from the request scope) and again
 * on the opened handle's (dev, ino). Other failures (ENOENT, EISDIR, EACCES) reject unchanged.
 * See change: close-security-map-high-findings (D1, H1).
 */
export async function readFileGuarded(absPath: string): Promise<string | null> {
  if (await dashboardStateRefuses(absPath)) return null;
  try {
    return await readFileStateChecked(absPath, "utf-8");
  } catch (err) {
    if (err instanceof DashboardStateRefused) return null;
    throw err;
  }
}
