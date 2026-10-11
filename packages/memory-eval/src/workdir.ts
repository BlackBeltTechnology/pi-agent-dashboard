/**
 * Work dir: every file the eval writes lives under
 * `<home>/.pi/dashboard/memory-eval/<project-key>/` (mode 0700, files 0600).
 * See change: add-memory-eval-tier-r (design M2).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Same derivation pi uses for a cwd's session dir: `--Users-robson-Project-x--`. */
export function projectKeyFor(cwd: string): string {
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

/** Create the work dir (and `dir` below it) with 0700; re-chmod when it already exists. */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Make the whole work dir private again (idempotent): dirs 0700, files 0600. */
export function hardenTree(root: string): void {
  if (!existsSync(root)) return;
  chmodSync(root, 0o700);
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) hardenTree(p);
    else chmodSync(p, 0o600);
  }
}

/** Write a file privately: parent dirs 0700, file 0600. */
export function writeSecure(path: string, data: string | Uint8Array, opts: { flag?: "w" | "a" } = {}): void {
  ensureDir(dirname(path));
  writeFileSync(path, data, { mode: 0o600, flag: opts.flag ?? "w" });
  chmodSync(path, 0o600);
}

/** Ensure the work dir tree exists and is private. Called by every command that writes. */
export function ensureWorkDir(p: WorkPaths): void {
  ensureDir(p.root);
  hardenTree(p.root);
}
