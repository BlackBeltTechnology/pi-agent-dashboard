/**
 * Minimal local `git` runner of the OpenSpec profiles: argv only (never a shell), no prompts, bounded time
 * and output, optional abort. Used for READ-ONLY probes (repo root, worktree list, ref existence) and the
 * best-effort `fetch` of a branch; every mutation of the repository goes through the dashboard git routes.
 * Callers pass literal flags only and validated refs as positionals (never an option-like value).
 * See change: add-agent-teams-openspec.
 */
import { execFile } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface GitRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type GitRunner = (cwd: string, args: readonly string[], opts?: GitRunOptions) => Promise<GitResult>;

const DEFAULT_TIMEOUT_MS = 10_000;

export const runGit: GitRunner = (cwd, args, opts = {}) =>
  new Promise((resolve) => {
    try {
      execFile(
        "git",
        [...args],
        {
          cwd,
          encoding: "utf8",
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
          ...(opts.signal ? { signal: opts.signal } : {}),
        },
        (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
      );
    } catch {
      resolve({ ok: false, stdout: "", stderr: "spawn_failed" });
    }
  });
