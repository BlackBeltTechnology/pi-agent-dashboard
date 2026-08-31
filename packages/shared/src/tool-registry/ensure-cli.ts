#!/usr/bin/env node
/**
 * `ensure` CLI — the TS-backed skill face of the tool registry (design D5).
 *
 * Reads a package's `pi.tools` manifest, ensures every tool, prints the
 * report. Distinct from the build-time `pi-dashboard-resolve-tool.cjs`
 * (path-only, no-transpiler): the env/docker-image/pw-browser strategies
 * are TypeScript registry code this CLI runs through tsx.
 *
 * Usage:
 *   pi-dashboard-ensure [--install] [--json] <path-to-package.json | dir>
 *
 * Exit codes: 0 when every required tool is present/installed — or when
 * `--json` is set (the outcome lives in the payload). Non-zero when a
 * required tool is missing/blocked or the manifest is invalid.
 *
 * See change: add-skill-tool-provisioning.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { ensureTools } from "./ensure.js";
import { parseSkillTools, ingestSkillTools } from "./pi-tools.js";
import { getDefaultRegistry } from "./index.js";
import type { EnsureReport } from "./ensure.js";

interface CliArgs {
  json: boolean;
  install: boolean;
  target: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, install: false, target: null };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg === "--install") args.install = true;
    else args.target = arg;
  }
  return args;
}

/** Set once --json is parsed — the catch handler honors the contract too. */
let jsonMode = false;

function loadPiTools(target: string): unknown {
  const file = path.extname(target) === ".json" ? target : path.join(target, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { pi?: unknown };
  return pkg.pi;
}

function fail(message: string, json: boolean, extra: Record<string, unknown> = {}): never {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, ...extra }, null, 2)}\n`);
    process.exit(0);
  }
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Interactive confirmation for requiresConfirm hints. Headless → never called. */
function promptConfirm(request: { tool: string; command: string }): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      `Install "${request.tool}" by running:\n  ${request.command}\nProceed? [y/N] `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

function printHuman(report: EnsureReport): void {
  for (const tool of report.tools) {
    const where = tool.path ? ` → ${tool.path}` : "";
    process.stdout.write(`${tool.name}: ${tool.action}${where}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  jsonMode = args.json;
  if (!args.target) {
    fail("usage: pi-dashboard-ensure [--install] [--json] <package.json | dir>", args.json);
  }

  let pi: unknown;
  try {
    pi = loadPiTools(args.target);
  } catch (e) {
    fail(`cannot read ${(e as Error).message}`, args.json, { errors: [(e as Error).message] });
  }

  const parsed = parseSkillTools(pi);
  if (!parsed.ok) {
    // A bad manifest is a doc bug — reported, never a host mutation.
    fail(
      `invalid pi.tools manifest:\n  ${parsed.errors.join("\n  ")}`,
      args.json,
      { errors: parsed.errors },
    );
  }

  const registry = getDefaultRegistry();
  // Ingest FIRST — an id with no registered definition is synthesized as a
  // probe-kind def; existing definitions are referenced, never clobbered.
  ingestSkillTools(registry, parsed.tools);
  const report = await ensureTools(parsed.tools, {
    registry,
    autoInstall: args.install,
    // stdin TTY → interactive confirm; headless → undefined = auto-deny.
    confirm: args.install && process.stdin.isTTY ? promptConfirm : undefined,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  }
  printHuman(report);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e: Error) => {
  // --json ALWAYS exits 0, even on an unexpected rejection (CodeRabbit r1).
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: [e.message] }, null, 2)}\n`);
    process.exit(0);
  }
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
