/**
 * `pi-photocraft mcp` — provision the binary, then run `photocraft-cli mcp`
 * confined to one directory, forwarding `tools/call` requests one at a time.
 *
 * The upstream server handles requests concurrently, so a pipelined
 * `doc_open` + `command_run` races ("no document open"). The wrapper reads
 * newline-delimited JSON-RPC from the client, queues `tools/call`, and releases
 * the next one only when the server has answered the previous id. Every other
 * message passes straight through; non-JSON server stdout goes to stderr so it
 * cannot corrupt the MCP channel.
 *
 * See change: add-photocraft-plugin (design D5).
 */
import * as path from "node:path";
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type ChildProcess, spawn as sharedSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { provision as defaultProvision, type ProvisionReport } from "./provision.js";

export const MCP_USAGE = `usage: pi-photocraft mcp [--root <dir>]
       pi-photocraft mcp --register

Runs the PhotoCraft stdio MCP server confined to <dir> (default: the current
directory) for both reads and writes. Register it in the project's
.pi/mcp.json with --register (opt-in).`;

export interface McpDeps {
  provision: (opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  spawn: (command: string, args: string[], options: { stdio: ["pipe", "pipe", "inherit"] }) => ChildProcess;
  stdin: Readable;
  stdout: Writable;
  stderr: (text: string) => void;
  cwd: () => string;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
}

export function defaultMcpDeps(): McpDeps {
  return {
    provision: () => defaultProvision(),
    spawn: (command, args, options) => sharedSpawn(command, args, options),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (t) => process.stderr.write(t),
    cwd: () => process.cwd(),
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
  };
}

type ParsedArgs = { kind: "run"; root?: string } | { kind: "help" } | { kind: "error"; message: string };

export function parseMcpArgs(argv: string[]): ParsedArgs {
  let root: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--root") {
      const v = argv[++i];
      if (!v) return { kind: "error", message: "--root needs a directory" };
      root = v;
    } else if (a.startsWith("--root=")) {
      root = a.slice("--root=".length);
      if (!root) return { kind: "error", message: "--root needs a directory" };
    } else {
      return { kind: "error", message: `unknown option for mcp: ${a}` };
    }
  }
  return { kind: "run", root };
}

function sameId(a: unknown, b: unknown): boolean {
  return a === b;
}

export async function runMcp(argv: string[], partial: Partial<McpDeps> = {}): Promise<number> {
  const deps: McpDeps = { ...defaultMcpDeps(), ...partial };
  const parsed = parseMcpArgs(argv);
  if (parsed.kind === "help") {
    deps.stderr(`${MCP_USAGE}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    deps.stderr(`${parsed.message}\n${MCP_USAGE}\n`);
    return 1;
  }

  let bin: string;
  try {
    bin = (await deps.provision()).binary;
  } catch (e) {
    deps.stderr(`pi-photocraft: ${(e as Error).message}\n`);
    return 69;
  }

  const root = path.resolve(deps.cwd(), parsed.root ?? ".");
  deps.stderr(`[pi-photocraft] mcp root: ${root}\n`);
  const child = deps.spawn(bin, ["mcp", "--automation-read-root", root, "--automation-write-root", root], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  return new Promise<number>((resolve) => {
    let inflight: unknown;
    let hasInflight = false;
    let eof = false;
    let exitOverride: number | undefined;
    const queue: { raw: string; id: unknown }[] = [];
    const toChild = (line: string) => {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(`${line}\n`);
    };

    const maybeClose = () => {
      if (eof && !hasInflight && queue.length === 0 && child.stdin && !child.stdin.destroyed) child.stdin.end();
    };
    const pump = () => {
      if (hasInflight) return;
      const next = queue.shift();
      if (!next) return maybeClose();
      hasInflight = true;
      inflight = next.id;
      toChild(next.raw);
    };

    child.stdin?.on("error", () => {
      /* child gone; its exit handler reports */
    });

    const clientRl = readline.createInterface({ input: deps.stdin });
    clientRl.on("line", (line) => {
      if (line.trim() === "") return;
      let msg: { method?: unknown; id?: unknown } | undefined;
      try {
        msg = JSON.parse(line);
      } catch {
        return toChild(line);
      }
      if (msg && !Array.isArray(msg) && msg.method === "tools/call" && msg.id !== undefined) {
        queue.push({ raw: line, id: msg.id });
        pump();
      } else toChild(line);
    });
    clientRl.on("close", () => {
      eof = true;
      maybeClose();
    });

    const serverRl = readline.createInterface({ input: child.stdout as Readable });
    serverRl.on("line", (line) => {
      let msg: { id?: unknown } | undefined;
      try {
        msg = JSON.parse(line);
      } catch {
        deps.stderr(`${line}\n`);
        return;
      }
      deps.stdout.write(`${line}\n`);
      if (hasInflight && msg && !Array.isArray(msg) && msg.id !== undefined && sameId(msg.id, inflight)) {
        hasInflight = false;
        inflight = undefined;
        pump();
      }
    });

    const onSignal = (code: number) => () => {
      exitOverride = code;
      child.kill();
    };
    deps.onSignal("SIGINT", onSignal(130));
    deps.onSignal("SIGTERM", onSignal(143));

    child.on("error", (e) => {
      deps.stderr(`pi-photocraft: failed to start photocraft-cli: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      clientRl.close();
      // Let buffered server lines flush before reporting.
      setImmediate(() => resolve(exitOverride ?? (signal ? 1 : (code ?? 1))));
    });
  });
}
