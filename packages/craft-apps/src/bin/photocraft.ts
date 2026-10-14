/**
 * pi-photocraft — compatibility alias of `pi-craft photocraft …` plus the
 * PhotoCraft-only `replace-region`. Same subcommands, options, exit codes and
 * outputs as before the craft-apps change.
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
 * See change: add-photocraft-plugin, add-craft-apps-core.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runAppCommand } from "../app-command.js";
import { defaultLauncherPath } from "../mcp-register.js";
import { type ProvisionReport, provision } from "../provision.js";
import { parseReplaceArgs, REPLACE_USAGE, replaceRegion } from "../region-replace.js";
import { getApp } from "../registry.js";


export const USAGE = `usage: pi-photocraft <command> [args]

commands:
  ensure                 provision photocraft-cli and print a JSON report
  path                   provision photocraft-cli and print its absolute path
  exec <args…>           run photocraft-cli with <args…> verbatim (bash route)
  mcp [--root <dir>]     run the stdio MCP server confined to <dir> (default: cwd)
  mcp --register         add a "photocraft" entry to .pi/mcp.json (opt-in)
  replace-region <input> generative part-replacement (pi-photocraft replace-region --help)

env: PHOTOCRAFT_VERSION (pin) · PHOTOCRAFT_BIN (skip provisioning) · PHOTOCRAFT_HOME / CRAFT_HOME (cache) · GITHUB_TOKEN
alias of \`pi-craft photocraft …\` — see \`pi-craft --help\` for the other apps`;

export interface CliDeps {
  provision: (opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function defaultCliDeps(): CliDeps {
  return {
    provision: (opts) => provision("photocraft", opts),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  };
}

export async function main(argv: string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultCliDeps(), ...partial };
  const [command, ...rest] = argv;

  if (command === "replace-region") {
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
  if (command === "--help" || command === "-h") {
    deps.stderr(`${USAGE}\n`);
    return 0;
  }
  const code = command
    ? await runAppCommand(getApp("photocraft"), command, rest, {
        prog: "pi-photocraft",
        provision: deps.provision,
        stdout: deps.stdout,
        stderr: deps.stderr,
        usage: USAGE,
        register: { launcher: defaultLauncherPath("pi-photocraft"), entryArgs: ["mcp"] },
      })
    : undefined;
  if (code !== undefined) return code;
  deps.stderr(`${USAGE}\n`);
  return 1;
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
