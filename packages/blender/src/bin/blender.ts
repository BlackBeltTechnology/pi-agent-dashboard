/**
 * `pi-blender` — headless Blender (WebAssembly) for pi agents.
 *
 *   ensure [--json]               probe JSPI, then provision the pinned runtime
 *   status [--json]               cache + JSPI report; never downloads
 *   mcp [--root <dir>]            stdio MCP server (blender-wasm)
 *   mcp --register [--root <dir>] opt-in registration in <cwd>/.pi/mcp.json
 *
 * Exit codes: 0 ok / `--help`; 1 usage or registration failure; 69 provisioning or JSPI failure.
 * Launched by `bin/pi-blender` with an IPC channel: on `disconnect` (launcher or an ancestor died) the
 * server kills its Blender host and exits.
 *
 * See change: add-blender-wasm-mcp (design D7, task 5.1).
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { type ProbeResult, probeJspi } from "../host/probe.js";
import { defaultSupervisorDeps, Supervisor } from "../host/supervisor.js";
import { runServer } from "../mcp/server.js";
import { resolveLimits, resolveRoot } from "../mcp/workspace.js";
import { registerMcp } from "../mcp-register.js";
import { type ProvisionDeps, type ProvisionResult, provision } from "../provision.js";
import { type CacheStatus, cacheStatus, failureReport, provisionReport } from "../report.js";

export const USAGE = `usage: pi-blender <command> [options]

commands:
  ensure [--json]                probe JSPI, then download and verify the pinned Blender runtime
  status [--json]                report the cache and JSPI support (never downloads)
  mcp [--root <dir>]             run the blender-wasm stdio MCP server (root: default the current directory)
  mcp --register [--root <dir>]  add a "blender-wasm" entry to <cwd>/.pi/mcp.json (opt-in)

Needs Node 24 or newer (WebAssembly JSPI). The runtime (~175 MB) is fetched on first use.
`;

export interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  probe: () => Promise<ProbeResult>;
  provision: () => Promise<ProvisionResult>;
  cacheStatus: () => CacheStatus;
  register: (opts: { root?: string }) => number;
  runMcp: (opts: { root?: string }) => Promise<number>;
}

export function defaultCliDeps(provisionDeps: Partial<ProvisionDeps> = {}): CliDeps {
  return {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    probe: () => probeJspi(),
    provision: () => provision(provisionDeps),
    cacheStatus: () => cacheStatus(provisionDeps),
    register: (opts) => registerMcp({ root: opts.root }),
    runMcp: (opts) => runMcpServer(opts.root),
  };
}

const JSPI_HINT = (node: string): string => `the Blender WebAssembly runtime needs JSPI, which Node ${node} does not provide; use Node 24 or newer`;

async function ensure(args: string[], deps: CliDeps): Promise<number> {
  const json = args.includes("--json");
  const unknown = args.filter((a) => a !== "--json");
  if (unknown.length) {
    deps.stderr(`pi-blender: unknown option for ensure: ${unknown[0]}\n`);
    return 1;
  }
  const probe = await deps.probe();
  if (probe.mode === "unavailable") {
    const message = JSPI_HINT(probe.node);
    deps.stdout(json ? `${JSON.stringify({ code: "jspi-unavailable", message, jspi: "unavailable", node: probe.node })}\n` : "");
    deps.stderr(`pi-blender: ${message}\n`);
    return 69;
  }
  try {
    const report = provisionReport(await deps.provision(), probe.mode);
    deps.stdout(json ? `${JSON.stringify(report)}\n` : `runtime ${report.version} ready (${report.source}) at ${report.dir}\n  ${(report.bytes / 1e6).toFixed(0)} MB, licence ${report.licence}, JSPI ${report.jspi}\n`);
    return 0;
  } catch (e) {
    const f = failureReport(e);
    deps.stdout(json ? `${JSON.stringify({ ...f, jspi: probe.mode })}\n` : "");
    deps.stderr(`pi-blender: ${f.code}: ${f.message}\n`);
    return 69;
  }
}

async function status(args: string[], deps: CliDeps): Promise<number> {
  const json = args.includes("--json");
  const unknown = args.filter((a) => a !== "--json");
  if (unknown.length) {
    deps.stderr(`pi-blender: unknown option for status: ${unknown[0]}\n`);
    return 1;
  }
  const cache = deps.cacheStatus();
  const probe = await deps.probe();
  if (json) {
    deps.stdout(`${JSON.stringify({ ...cache, jspi: probe.mode, node: probe.node })}\n`);
    return 0;
  }
  const lines = [
    `pinned runtime: ${cache.pinned.version} — ${cache.pinned.cached ? `cached at ${cache.pinned.dir}` : "not cached"}`,
    `source: ${cache.source}`,
    `cache root: ${cache.root}`,
    `cached versions: ${cache.versions.length ? cache.versions.map((v) => `${v.version} (${(v.bytes / 1e6).toFixed(0)} MB)`).join(", ") : "none"}`,
    `licence: ${cache.licence}`,
    `JSPI: ${probe.mode} (Node ${probe.node})`,
  ];
  deps.stdout(`${lines.join("\n")}\n`);
  return 0;
}

interface McpArgs {
  register: boolean;
  root?: string;
  error?: string;
}

function parseMcpArgs(argv: string[]): McpArgs {
  const out: McpArgs = { register: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--register") out.register = true;
    else if (a === "--root") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) return { ...out, error: "--root needs a directory" };
      out.root = v;
    } else if (a.startsWith("--root=")) {
      out.root = a.slice("--root=".length);
      if (!out.root) return { ...out, error: "--root needs a directory" };
    } else return { ...out, error: `unknown option for mcp: ${a}` };
  }
  return out;
}

/** The real server: confined root, supervisor, stdio. Exits 1 (via the returned code) on a bad root. */
export async function runMcpServer(rootArg: string | undefined): Promise<number> {
  let root: string;
  try {
    root = resolveRoot(process.cwd(), rootArg);
  } catch (e) {
    process.stderr.write(`pi-blender: ${(e as Error).message}\n`);
    return 1;
  }
  const supervisor = new Supervisor(defaultSupervisorDeps());
  const version = readPackageVersion();
  const done = (): void => {
    void supervisor.shutdown().finally(() => process.exit(0));
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, done);
  // The launcher (or an ancestor) died: the Blender host must not outlive it.
  if (process.connected) process.on("disconnect", done);
  return runServer({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (t) => process.stderr.write(t),
    root,
    limits: resolveLimits(process.env),
    supervisor,
    version,
  });
}

/** Package version: `../package.json` from the bundled `dist/`, `../../package.json` from `src/bin/`. */
function readPackageVersion(): string {
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as { name?: unknown; version?: unknown };
      if (typeof pkg.version === "string" && pkg.name === "@blackbelt-technology/pi-dashboard-blender") return pkg.version;
    } catch {
      /* try the next location */
    }
  }
  return "0.0.0";
}

export async function main(argv: string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultCliDeps(), ...partial };
  const [cmd, ...rest] = argv;
  if (cmd === "--help" || cmd === "-h") {
    deps.stderr(USAGE);
    return 0;
  }
  switch (cmd) {
    case "ensure":
      return ensure(rest, deps);
    case "status":
      return status(rest, deps);
    case "mcp": {
      if (rest.includes("--help") || rest.includes("-h")) {
        deps.stderr(USAGE);
        return 0;
      }
      const parsed = parseMcpArgs(rest);
      if (parsed.error) {
        deps.stderr(`pi-blender: ${parsed.error}\n`);
        return 1;
      }
      return parsed.register ? deps.register({ root: parsed.root }) : deps.runMcp({ root: parsed.root });
    }
    default:
      deps.stderr(USAGE);
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
      process.stderr.write(`pi-blender: ${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
