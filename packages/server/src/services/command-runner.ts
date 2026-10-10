/**
 * Async, bounded command runner for the service layer. Every runtime call
 * (`docker`, `podman`, `security`, `uvx --offline`, …) goes through one
 * injectable `CommandRunner`, so tests spy on a single seam and the server
 * event loop never blocks on a slow CLI (D10). argv only — never a shell.
 * See change: add-service-registry-core.
 */
import { buildSafeArgv, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  /** Hard deadline; the child is killed and `timedOut` set. Default 30 s. */
  timeoutMs?: number;
  /** Written to stdin, then stdin is closed. */
  input?: string;
}

export interface RunResult {
  /** Exit code; null when the process could not be spawned or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn failure (ENOENT, EACCES …). */
  error?: string;
}

export type CommandRunner = (file: string, args: readonly string[], opts?: RunOptions) => Promise<RunResult>;

const MAX_OUTPUT = 4 * 1024 * 1024;

export const defaultCommandRunner: CommandRunner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const { argv, spawnOptions } = buildSafeArgv(file, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (r: Omit<RunResult, "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout, stderr, timedOut });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        ...spawnOptions,
        env: opts.env ?? process.env,
        stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, error: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      finish({ code: null });
    }, opts.timeoutMs ?? 30_000);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8");
    });
    child.on("error", (err) => finish({ code: null, error: err.message }));
    child.on("close", (code) => finish({ code }));
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(opts.input);
    }
  });
