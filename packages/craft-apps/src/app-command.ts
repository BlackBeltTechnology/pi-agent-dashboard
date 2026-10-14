/**
 * Per-app commands shared by `pi-craft <app> …` and the `pi-photocraft` alias:
 * `ensure | path | exec | mcp [--register]`. The two entry points differ only in
 * the diagnostic prefix, the usage text and the launcher the `--register` entry runs.
 *
 * See change: add-craft-apps-core.
 */
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { runMcp } from "./mcp-proxy.js";
import { registerMcp } from "./mcp-register.js";
import type { ProvisionReport } from "./provision.js";
import type { CraftApp } from "./registry.js";

/** Run the binary with inherited stdio; resolves with its exit code. */
export function execPassthrough(prog: string, bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
    const handlers = (["SIGINT", "SIGTERM"] as const).map((sig) => [sig, forward(sig)] as const);
    for (const [sig, h] of handlers) process.on(sig, h);
    const release = () => {
      for (const [sig, h] of handlers) process.off(sig, h);
    };
    child.on("error", (e) => {
      release();
      process.stderr.write(`${prog}: failed to run ${bin}: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => (release(), resolve(signal ? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1) : (code ?? 1))));
  });
}

/** Shared per-app command context: `pi-craft <app> …` and the `pi-photocraft` alias differ only in these. */
export interface AppCommandContext {
  prog: string;
  provision: (opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  usage: string;
  /** Launcher + arguments the `--register` entry runs; default pi-craft `[<app>, "mcp"]`. */
  register?: { launcher: string; entryArgs: string[] };
}

/** `ensure | path | exec | mcp` for one app. Returns `undefined` for any other subcommand. */
export async function runAppCommand(app: CraftApp, command: string, rest: string[], ctx: AppCommandContext): Promise<number | undefined> {
  switch (command) {
    case "ensure":
    case "path": {
      let report: ProvisionReport;
      try {
        report = await ctx.provision({ probeVersion: command === "ensure" });
      } catch (e) {
        ctx.stderr(`${ctx.prog}: ${(e as Error).message}\n`);
        return 69;
      }
      ctx.stdout(command === "ensure" ? `${JSON.stringify(report)}\n` : `${report.binary}\n`);
      return 0;
    }
    case "exec": {
      let bin: string;
      try {
        bin = (await ctx.provision()).binary;
      } catch (e) {
        ctx.stderr(`${ctx.prog}: ${(e as Error).message}\n`);
        return 69;
      }
      return execPassthrough(ctx.prog, bin, rest);
    }
    case "mcp": {
      if (rest.includes("--register")) {
        const other = rest.filter((a) => a !== "--register" && a !== "--allow-unconfined" && a !== "--compact");
        if (other.length > 0) {
          ctx.stderr(`--register takes no other option than --allow-unconfined and --compact\n${ctx.usage}\n`);
          return 1;
        }
        return registerMcp(app, {
          stderr: ctx.stderr,
          prog: ctx.prog,
          allowUnconfined: rest.includes("--allow-unconfined"),
          compact: rest.includes("--compact"),
          ...(ctx.register ? { launcher: ctx.register.launcher, entryArgs: ctx.register.entryArgs } : {}),
        });
      }
      return runMcp(app, rest, { prog: ctx.prog, provision: ctx.provision, stderr: ctx.stderr });
    }
    default:
      return undefined;
  }
}

