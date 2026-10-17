/**
 * pi-craft — headless ArtCraft Crafting Apps for pi agents.
 *
 *   pi-craft apps [--json]                    list the 13 apps (offline)
 *   pi-craft status [--json]                  installed versions, cache size, source (never downloads)
 *   pi-craft install <app…>|--all             provision CLIs, one JSON report per app
 *   pi-craft launcher status|install          ArtCraft Craft Launcher source / installer
 *   pi-craft verify <file> [assertions…]      mechanical output checks (see `pi-craft verify --help`)
 *   pi-craft doc prepare <in.md> --out <dir>  fill a docx template + prepare the body for WordCraft (`pi-craft doc --help`)
 *   pi-craft <app> ensure|path|exec|mcp       per-app provisioning, bash route, stdio MCP server
 *
 * Exit codes: 0 ok · 1 usage error / failed operation · 69 provisioning failure
 * (`exec` propagates the binary's own exit code; `verify` and `doc prepare` have their own: 2 = usage).
 *
 * See change: add-craft-apps-core, add-craft-office-workflows.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runAppCommand } from "../app-command.js";
import { DOC_USAGE, prepareDoc } from "../doc-prepare.js";
import { installLauncher, launcherStatus } from "../launcher-install.js";
import { defaultLauncherPath } from "../mcp-register.js";
import { defaultDeps, type ProvisionReport, provision } from "../provision.js";
import { APP_IDS, CRAFT_APPS, getApp, isAppId } from "../registry.js";
import { appStatus } from "../status.js";
import { runVerify } from "../verify.js";

export function usage(): string {
  return `usage: pi-craft <command> [args]

commands:
  apps [--json]                list the Crafting Apps (offline)
  status [--json]              installed versions, cache size, source (never downloads)
  install <app…>|--all         provision <app>-cli for each app, print one JSON report per app
  launcher status|install      Craft Launcher state / checksum-verified installer (explicit only)
  verify <file> [assertions…]  mechanical output checks (pi-craft verify --help)
  doc prepare <in.md> --out <dir>  fill a docx template, inline images/diagrams (pi-craft doc --help)
  <app> ensure                 provision <app>-cli and print a JSON report
  <app> path                   provision <app>-cli and print its absolute path
  <app> exec <args…>           run <app>-cli with <args…> verbatim (bash route)
  <app> mcp [--root <dir>]     stdio MCP server (confined apps), --allow-unconfined otherwise
  <app> mcp --register         add a craft-<app> entry to .pi/mcp.json (opt-in)

apps: ${APP_IDS.join(", ")}

env: CRAFT_HOME (cache root) · CRAFT_SOURCE=managed|launcher|auto · <APP>_VERSION (pin) · <APP>_BIN (skip provisioning) · GITHUB_TOKEN
exit: 0 ok · 1 usage/failed · 69 provisioning failure`;
}

export interface CliDeps {
  provision: (appId: string, opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homedir: () => string;
  now: () => number;
  runVerify: (argv: string[]) => Promise<number>;
  runDocPrepare: (argv: string[], io: { stdout: (t: string) => void; stderr: (t: string) => void }) => Promise<number>;
  installLauncher: () => Promise<{ version: string; asset: string; file: string; handoff: string }>;
}

function defaultCliDeps(): CliDeps {
  const d = defaultDeps();
  return {
    provision: (appId, opts) => provision(appId, opts),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
    platform: process.platform,
    homedir: d.homedir,
    now: d.now,
    runVerify: (argv) => runVerify(argv, {}),
    runDocPrepare: (argv, io) => prepareDoc(argv, io),
    installLauncher: () => installLauncher(d),
  };
}

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function appsCommand(rest: string[], deps: CliDeps): number {
  const json = rest.includes("--json");
  if (rest.some((a) => a !== "--json")) {
    deps.stderr(`usage: pi-craft apps [--json]\n`);
    return 1;
  }
  const rows = CRAFT_APPS.map((a) => ({ id: a.id, name: a.name, purpose: a.purpose, repo: a.repo, mcp: { confinement: a.mcp.confinement, toolClass: a.mcp.toolClass, tools: a.mcp.tools } }));
  if (json) deps.stdout(`${JSON.stringify(rows)}\n`);
  else {
    for (const r of rows) {
      deps.stdout(`${r.id.padEnd(12)} ${r.purpose}\n`);
      deps.stdout(`${"".padEnd(12)} ${r.repo} · mcp: ${r.mcp.confinement ? "confined" : "unconfined"}, ${r.mcp.tools} tools (${r.mcp.toolClass})\n`);
    }
  }
  return 0;
}

function statusCommand(rest: string[], deps: CliDeps): number {
  const json = rest.includes("--json");
  if (rest.some((a) => a !== "--json")) {
    deps.stderr(`usage: pi-craft status [--json]\n`);
    return 1;
  }
  let rows: ReturnType<typeof appStatus>[];
  try {
    rows = CRAFT_APPS.map((a) => appStatus(a, deps));
  } catch (e) {
    deps.stderr(`pi-craft: ${(e as Error).message}\n`);
    return 1;
  }
  if (json) {
    deps.stdout(`${JSON.stringify(rows)}\n`);
    return 0;
  }
  for (const r of rows) {
    const inst = r.installed.length ? `${r.installed.join(", ")} (${formatBytes(r.cacheBytes)})` : "not installed";
    const use = r.wouldUse.version ? `${r.wouldUse.version} (${r.wouldUse.source})` : r.wouldUse.source;
    deps.stdout(`${r.app.padEnd(12)} ${inst} · next: ${use} · source: ${r.source}\n`);
  }
  return 0;
}

async function installCommand(rest: string[], deps: CliDeps): Promise<number> {
  const all = rest.includes("--all");
  const ids = rest.filter((a) => a !== "--all");
  if ((all && ids.length > 0) || (!all && ids.length === 0)) {
    deps.stderr(`usage: pi-craft install <app…> | pi-craft install --all\n`);
    return 1;
  }
  const bad = ids.filter((id) => !isAppId(id));
  if (bad.length) {
    deps.stderr(`pi-craft: unknown craft app "${bad[0]}"; supported apps: ${APP_IDS.join(", ")}\n`);
    return 1;
  }
  let failed = false;
  for (const id of all ? [...APP_IDS] : ids) {
    try {
      deps.stdout(`${JSON.stringify(await deps.provision(id, { probeVersion: true }))}\n`);
    } catch (e) {
      failed = true;
      deps.stderr(`pi-craft: ${id}: ${(e as Error).message}\n`);
    }
  }
  return failed ? 69 : 0;
}

async function launcherCommand(rest: string[], deps: CliDeps): Promise<number> {
  const [sub, ...more] = rest;
  if ((sub !== "status" && sub !== "install") || more.length > 0) {
    deps.stderr(`usage: pi-craft launcher status | pi-craft launcher install\n`);
    return 1;
  }
  if (sub === "status") {
    deps.stdout(`${JSON.stringify(launcherStatus(deps))}\n`);
    return 0;
  }
  try {
    deps.stdout(`${JSON.stringify(await deps.installLauncher())}\n`);
    return 0;
  } catch (e) {
    deps.stderr(`pi-craft: ${(e as Error).message}\n`);
    return 69;
  }
}

async function docCommand(rest: string[], deps: CliDeps): Promise<number> {
  const [sub, ...more] = rest;
  if (sub === "--help" || sub === "-h") {
    deps.stderr(`${DOC_USAGE}\n`);
    return 0;
  }
  if (sub === "prepare") return deps.runDocPrepare(more, { stdout: deps.stdout, stderr: deps.stderr });
  deps.stderr(`${DOC_USAGE}\n`);
  return 1;
}

export async function main(argv: string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultCliDeps(), ...partial };
  const [command, ...rest] = argv;

  switch (command) {
    case "apps":
      return appsCommand(rest, deps);
    case "status":
      return statusCommand(rest, deps);
    case "install":
      return installCommand(rest, deps);
    case "launcher":
      return launcherCommand(rest, deps);
    case "verify":
      return deps.runVerify(rest);
    case "doc":
      return docCommand(rest, deps);
    case "--help":
    case "-h":
      deps.stderr(`${usage()}\n`);
      return 0;
    default: {
      if (command && isAppId(command)) {
        const app = getApp(command);
        const [sub, ...args] = rest;
        const code = await runAppCommand(app, sub ?? "", args, {
          prog: "pi-craft",
          provision: (opts) => deps.provision(command, opts),
          stdout: deps.stdout,
          stderr: deps.stderr,
          usage: usage(),
          register: { launcher: defaultLauncherPath("pi-craft"), entryArgs: [app.id, "mcp"] },
        });
        if (code !== undefined) return code;
      }
      deps.stderr(`${usage()}\n`);
      return 1;
    }
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
      process.stderr.write(`pi-craft: ${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
