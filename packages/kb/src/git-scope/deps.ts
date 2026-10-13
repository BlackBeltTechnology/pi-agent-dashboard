// Injectable seams for the git scope (change: add-kb-git-forge-scope). Every
// process-, clock- and network-touching call goes through `GitScopeDeps` so the
// scope is testable without a network, a forge login or real time.
import { type ChildProcessWithoutNullStreams, execFile, execFileSync, spawn } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns the local git walk + forge CLI exec, argv only, never a shell)
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the binary could not be started at all (ENOENT/EACCES). */
  spawnError?: string;
}
interface CliOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface GitScopeDeps {
  /** Synchronous git (rev-parse, for-each-ref, …). Throws {@link GitExecError}. */
  git(args: string[], cwd: string): string;
  /** Streaming git (log). argv only. */
  spawnGit(args: string[], cwd: string): ChildProcessWithoutNullStreams;
  /** Absolute path of a CLI (`gh`, `glab`), or null when not installed. Resolved once per process. */
  resolveBin(name: string): string | null;
  /** Run a forge CLI by absolute path. */
  runCli(bin: string, args: string[], opts?: CliOpts): Promise<CliResult>;
  fetch: typeof fetch;
  now(): number;
  env: NodeJS.ProcessEnv;
  /** Directory holding one sub-directory per repoKey. */
  baseDir: string;
  /** Lease owner id (per process). */
  owner: string;
  /** One diagnostic line (never a credential). */
  log(line: string): void;
}

export class GitExecError extends Error {
  readonly code: string | number | null;
  readonly stderr: string;
  constructor(message: string, code: string | number | null, stderr: string) {
    super(message);
    this.name = "GitExecError";
    this.code = code;
    this.stderr = stderr;
  }
}

const GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

function realGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { status?: number | null; stderr?: Buffer | string };
    throw new GitExecError(err.message, err.code ?? err.status ?? null, String(err.stderr ?? ""));
  }
}

const binCache = new Map<string, string | null>();
/** Resolve a CLI to an absolute path once per process: PATH plus the usual Homebrew/system dirs. */
function resolveBinOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (binCache.has(name)) return binCache.get(name) ?? null;
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const extra of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", join(homedir(), ".local", "bin")]) if (!dirs.includes(extra)) dirs.push(extra);
  let found: string | null = null;
  for (const d of dirs) {
    const p = join(d, name);
    try {
      if (!statSync(p).isFile()) continue;
      accessSync(p, constants.X_OK);
      found = p;
      break;
    } catch { /* next dir */ }
  }
  binCache.set(name, found);
  return found;
}

function realRunCli(bin: string, args: string[], opts: CliOpts = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: "utf8", timeout: opts.timeoutMs ?? 30_000, maxBuffer: 16 * 1024 * 1024, signal: opts.signal, env: opts.env ?? process.env }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const e = err as NodeJS.ErrnoException & { code?: number | string };
      if (typeof e.code === "string") return resolve({ code: null, stdout: stdout ?? "", stderr: stderr ?? "", spawnError: `${e.code}: ${e.message}` });
      resolve({ code: typeof e.code === "number" ? e.code : 1, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

export function defaultDeps(): GitScopeDeps {
  return {
    git: realGit,
    spawnGit: (args, cwd) => spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } }),
    resolveBin: (name) => resolveBinOnPath(name),
    runCli: realRunCli,
    fetch: (...a) => globalThis.fetch(...a),
    now: () => Date.now(),
    env: process.env,
    baseDir: join(homedir(), ".pi", "dashboard", "kb", "git"),
    owner: `${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    log: (line) => console.log(`[kb-git] ${line}`),
  };
}
