/**
 * Runs the `pi-dashboard` CLI (the only way `pi-obs` touches managed services:
 * `service add --file`, `service secret set` on stdin, `service status`). The
 * CLI carries the local credential itself, so `pi-obs` never holds a bearer.
 * Binary: `PI_DASHBOARD_BIN` or `pi-dashboard` on PATH, spawned via
 * `buildSafeArgv` (win32 `.cmd` shims through `cmd.exe /d /s /c`).
 * Secrets go through `stdin`, never argv. See change: add-obs-studio-plugin (D3).
 */
import { buildSafeArgv, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DashboardCli {
  /** `inherit: true` → the user's terminal (review + confirm prompts); stdout/stderr then empty. */
  run(args: string[], opts?: { stdin?: string; inherit?: boolean }): Promise<CliResult>;
}

/**
 * `prefix` (plugin server): an exact argv prefix such as
 * the server's own node, loader flags and CLI entry (see `server/dashboard-cli-argv.ts`), spawned verbatim.
 * Otherwise `PI_DASHBOARD_BIN` / `pi-dashboard` through `buildSafeArgv`.
 */
export function createDashboardCli(env: Record<string, string | undefined> = process.env, prefix?: readonly string[]): DashboardCli {
  const bin = env.PI_DASHBOARD_BIN || "pi-dashboard";
  return {
    run(args, opts = {}) {
      const { argv, spawnOptions } = prefix?.length ? { argv: [...prefix, ...args], spawnOptions: { shell: false as const, windowsHide: true as const } } : buildSafeArgv(bin, args);
      return new Promise((resolve) => {
        const child = spawn(argv[0], argv.slice(1), {
          ...spawnOptions,
          stdio: opts.inherit ? ["inherit", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (b: Buffer) => {
          stdout += String(b);
        });
        child.stderr?.on("data", (b: Buffer) => {
          stderr += String(b);
        });
        child.once("error", (e) => resolve({ code: 127, stdout, stderr: `${stderr}cannot run ${bin}: ${e.message}` }));
        child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        if (!opts.inherit) child.stdin?.end(opts.stdin ?? "");
      });
    },
  };
}
