/**
 * Work dir: every file the eval writes lives under
 * `<home>/.pi/dashboard/memory-eval/<project-key>/` (mode 0700, files 0600).
 * See change: add-memory-eval-tier-r (design M2).
 */
import { chmodSync, closeSync, existsSync, fchmodSync, constants as fsConstants, lstatSync, mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { CliError } from "./util.js";

/** Same derivation pi uses for a cwd's session dir: `--Users-robson-Project-x--`. */
function projectKeyFor(cwd: string): string {
  return `--${cwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
}

export interface WorkPaths {
  home: string;
  projectKey: string;
  sessionsRoot: string;
  sessionsDir: string;
  root: string;
  casesDir: string;
  snapshotsDir: string;
  runsDir: string;
  reportsDir: string;
  verdicts: string;
  providersFile: string;
}

export function resolvePaths(opts: { cwd: string; home?: string }): WorkPaths {
  const home = opts.home ?? homedir();
  const projectKey = projectKeyFor(opts.cwd);
  const sessionsRoot = join(home, ".pi", "agent", "sessions");
  const root = join(home, ".pi", "dashboard", "memory-eval", projectKey);
  return {
    home,
    projectKey,
    sessionsRoot,
    sessionsDir: join(sessionsRoot, projectKey),
    root,
    casesDir: join(root, "cases"),
    snapshotsDir: join(root, "snapshots"),
    runsDir: join(root, "runs"),
    reportsDir: join(root, "reports"),
    verdicts: join(root, "verdicts.jsonl"),
    providersFile: join(home, ".pi", "agent", "providers.json"),
  };
}

/** The work dir the current process is writing to; every write must stay inside its real path. */
let activeRoot: string | null = null;

function refuseSymlink(path: string): void {
  let st: ReturnType<typeof lstatSync> | null = null;
  try {
    st = lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (st?.isSymbolicLink()) throw new CliError(`refusing to follow a symlink inside the work dir: ${path}`);
}

/** Create `dir` (0700), re-chmod an existing one; never through a symlink or out of the work dir. */
function ensureDir(dir: string): void {
  if (activeRoot) {
    // Check every existing component below the work dir root before mkdir can follow one out of it.
    for (let d = dir; d !== activeRoot && d.startsWith(activeRoot + sep); d = dirname(d)) refuseSymlink(d);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  refuseSymlink(dir);
  chmodSync(dir, 0o700);
}

/** Make the whole work dir private again (idempotent): dirs 0700, files 0600. Symlinks are refused, not followed. */
function hardenTree(root: string): void {
  if (!existsSync(root)) return;
  refuseSymlink(root);
  chmodSync(root, 0o700);
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new CliError(`refusing to follow a symlink inside the work dir: ${p}`);
    if (st.isDirectory()) hardenTree(p);
    else chmodSync(p, 0o600);
  }
}

const O = fsConstants;
const FLAGS = { w: O.O_WRONLY | O.O_CREAT | O.O_TRUNC, a: O.O_WRONLY | O.O_CREAT | O.O_APPEND, wx: O.O_WRONLY | O.O_CREAT | O.O_EXCL } as const;

/** Write a file privately: parent dirs 0700, file 0600, never through a symlink (`O_NOFOLLOW`). */
export function writeSecure(path: string, data: string | Uint8Array, opts: { flag?: "w" | "a" | "wx" } = {}): void {
  ensureDir(dirname(path));
  refuseSymlink(path);
  const fd = openSync(path, FLAGS[opts.flag ?? "w"] | (O.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeFileSync(fd, data);
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Ensure the work dir tree exists and is private. Called by every command that writes. */
export function ensureWorkDir(p: WorkPaths): void {
  // The eval owns `memory-eval/` and `<project-key>/`; a symlink at either would redirect every write.
  // Higher components (`~/.pi`, `~/.pi/dashboard`) are the user's own config tree and may legitimately be linked.
  refuseSymlink(dirname(p.root));
  activeRoot = p.root;
  ensureDir(p.root);
  hardenTree(p.root);
}
