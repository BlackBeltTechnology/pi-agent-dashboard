#!/usr/bin/env node
/**
 * `pi-apple-tools-install [--check]` — opt-in CLI entry for iMCP provisioning.
 *
 * Never runs implicitly (no postinstall). Writes exactly two files in write
 * mode (`~/.pi/agent/mcp.json`, `~/.pi/agent/settings.json`) and NEVER touches
 * the server-owned plugin config store. `--check` reports the terminal state
 * without mutating anything.
 *
 * See change: add-apple-tools-imcp-plugin.
 */
import { createInstallerEnv } from "../env.js";
import { runInstaller } from "../install.js";

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const overrideIdx = argv.indexOf("--path");
  const overridePath =
    overrideIdx >= 0 && argv[overrideIdx + 1] ? argv[overrideIdx + 1] : undefined;

  const env = createInstallerEnv({ ...(overridePath ? { overridePath } : {}) });
  const result = runInstaller(env, { check });

  const label = check ? "[check]" : "[install]";
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${label} ${result.state}\n${result.message}\n`);
  if (result.resolvedPath) stream.write(`imcp-server: ${result.resolvedPath}\n`);
  return result.exitCode;
}

process.exit(main(process.argv.slice(2)));
