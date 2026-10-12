/**
 * pi-photocraft — headless PhotoCraft for pi agents.
 *
 *   pi-photocraft ensure                  provision the binary, print the JSON report
 *   pi-photocraft path                    provision, print the binary path
 *   pi-photocraft exec <args…>            pass-through to photocraft-cli (bash route)
 *   pi-photocraft mcp [--root <dir>]      stdio MCP server confined to <dir> (default cwd)
 *   pi-photocraft mcp --register          write a `photocraft` entry into .pi/mcp.json
 *   pi-photocraft replace-region …        generative part-replacement (see --help)
 *
 * Exit codes: 0 ok · 1 usage error / failed edit · 69 provisioning failure
 * (`exec` propagates the binary's own exit code).
 *
 * See change: add-photocraft-plugin.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { runMcp } from "../mcp-proxy.js";
import { registerMcp } from "../mcp-register.js";
import { type ProvisionReport, provision } from "../provision.js";
import { parseReplaceArgs, REPLACE_USAGE, replaceRegion } from "../region-replace.js";

export const USAGE = `usage: pi-photocraft <command> [args]

commands:
  ensure                 provision photocraft-cli and print a JSON report
  path                   provision photocraft-cli and print its absolute path
  exec <args…>           run photocraft-cli with <args…> verbatim (bash route)
  mcp [--root <dir>]     run the stdio MCP server confined to <dir> (default: cwd)
  mcp --register         add a "photocraft" entry to .pi/mcp.json (opt-in)
  replace-region <input> generative part-replacement (pi-photocraft replace-region --help)

env: PHOTOCRAFT_VERSION (pin) · PHOTOCRAFT_BIN (skip provisioning) · PHOTOCRAFT_HOME (cache) · GITHUB_TOKEN`;

export interface CliDeps {
  provision: (opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function defaultCliDeps(): CliDeps {
  return {
    provision: (opts) => provision(opts),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  };
}

/** Run the binary with inherited stdio; resolves with its exit code. */
function execPassthrough(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
    child.on("error", (e) => {
      process.stderr.write(`pi-photocraft: failed to run ${bin}: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(signal ? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1) : (code ?? 1)));
  });
}

export async function main(argv: string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultCliDeps(), ...partial };
  const [command, ...rest] = argv;

  switch (command) {
    case "ensure":
    case "path": {
      let report: ProvisionReport;
      try {
        report = await deps.provision({ probeVersion: command === "ensure" });
      } catch (e) {
        deps.stderr(`pi-photocraft: ${(e as Error).message}\n`);
        return 69;
      }
      deps.stdout(command === "ensure" ? `${JSON.stringify(report)}\n` : `${report.binary}\n`);
      return 0;
    }
    case "exec": {
      let bin: string;
      try {
        bin = (await deps.provision()).binary;
      } catch (e) {
        deps.stderr(`pi-photocraft: ${(e as Error).message}\n`);
        return 69;
      }
      return execPassthrough(bin, rest);
    }
    case "mcp":
      if (rest.includes("--register")) {
        if (rest.length > 1) {
          deps.stderr(`--register takes no other option\n${USAGE}\n`);
          return 1;
        }
        return registerMcp({ stderr: deps.stderr });
      }
      return runMcp(rest, { provision: deps.provision, stderr: deps.stderr });
    case "replace-region": {
      const parsed = parseReplaceArgs(rest);
      if (!parsed.ok) {
        if (parsed.help) {
          deps.stderr(`${REPLACE_USAGE}\n`);
          return 0;
        }
        deps.stderr(`pi-photocraft replace-region: ${parsed.error}\n${REPLACE_USAGE}\n`);
        return 1;
      }
      return replaceRegion(parsed.options, { provision: deps.provision, stdout: deps.stdout, stderr: deps.stderr });
    }
    case "--help":
    case "-h":
      deps.stderr(`${USAGE}\n`);
      return 0;
    default:
      deps.stderr(`${USAGE}\n`);
      return 1;
  }
}

/** True when this module is the process entry (direct run, bin symlink, or tsx). */
function isEntry(): boolean {
  try {
    const entry = process.argv[1];
    return !!entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`pi-photocraft: ${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
