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
  /**
   * Spawn `file args` exactly as given — never wrapped in `cmd.exe` on win32.
   * For user-authored argv that must not meet any shell (attached stop).
   */
  verbatim?: boolean;
}

export interface RunResult {
  /** Exit code; null when the process could not be spawned or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /**
   * stdout or stderr reached the 4 MiB cap and the rest was dropped. Callers
   * that need the whole output (logs) must treat this as a failure.
   */
  truncated?: boolean;
  /** Spawn failure (ENOENT, EACCES …). */
  error?: string;
}

export type CommandRunner = (file: string, args: readonly string[], opts?: RunOptions) => Promise<RunResult>;

const MAX_OUTPUT = 4 * 1024 * 1024;

export const defaultCommandRunner: CommandRunner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const { argv, spawnOptions } = opts.verbatim
      ? { argv: [file, ...args], spawnOptions: { shell: false as const, windowsHide: true as const } }
      : buildSafeArgv(file, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let truncated = false;
    const finish = (r: Omit<RunResult, "stdout" | "stderr" | "timedOut" | "truncated">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout, stderr, timedOut, ...(truncated ? { truncated: true } : {}) });
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
    // `setEncoding` decodes across chunk boundaries: a multi-byte character split between two
    // chunks must not become two U+FFFD (that would defeat exact-value log redaction).
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
      else truncated = true;
    });
    child.stderr?.on("data", (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
      else truncated = true;
    });
    child.on("error", (err) => finish({ code: null, error: err.message }));
    child.on("close", (code) => finish({ code }));
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(opts.input);
    }
  });
