/**
 * `pi-craft <app> mcp` (and `pi-photocraft mcp`) — provision the binary, then run
 * `<app>-cli mcp` forwarding `tools/call` requests one at a time. Apps whose MCP
 * server supports path confinement run confined to one directory (`--root`);
 * the others refuse to start unless `--allow-unconfined` is given.
 *
 * The upstream server handles requests concurrently, so a pipelined
 * `doc_open` + `command_run` races ("no document open"). The wrapper reads
 * newline-delimited JSON-RPC from the client, queues `tools/call`, and releases
 * the next one only when the server has answered the previous id. Every other
 * message passes straight through; non-JSON server stdout goes to stderr so it
 * cannot corrupt the MCP channel.
 *
 * See change: add-photocraft-plugin (design D5), add-craft-apps-core (design D4).
 */
import * as path from "node:path";
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type ChildProcess, spawn as sharedSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { provision as defaultProvision, type ProvisionReport } from "./provision.js";
import type { CraftApp } from "./registry.js";

/** Options the proxy owns: forwarding them would bypass confinement or attach to a live app. */
const REJECTED_OPTIONS = ["--bridge", "--connect", "--control-token", "--automation-read-root", "--automation-write-root"];

export function mcpUsage(app: CraftApp, prog = "pi-craft"): string {
  const cmd = prog === "pi-photocraft" ? `${prog} mcp` : `${prog} ${app.id} mcp`;
  const compact = app.mcp.compactFlag ? " [--compact]" : "";
  return app.mcp.confinement
    ? `usage: ${cmd} [--root <dir>]${compact}
       ${cmd} --register

Runs the ${app.name} stdio MCP server confined to <dir> (default: the current
directory) for both reads and writes. Register it in the project's
.pi/mcp.json with --register (opt-in).${app.mcp.compactFlag ? `\n--compact lists only the helper tools (${app.mcp.tools} tools otherwise); every command stays reachable.` : ""}`
    : `usage: ${cmd} --allow-unconfined${compact}
       ${cmd} --register --allow-unconfined${compact}

${app.name}'s MCP server has no path confinement: it can read and write any
path the user can. Start or register it only with --allow-unconfined.`;
}

/**
 * How long a cancelled in-flight `tools/call` may keep the queue blocked. MCP lets a
 * server drop the response to a cancelled request; without a bound, every later call
 * would wait forever. The server may still be finishing the old command, so the slot
 * is released late, not at once.
 */
export const CANCEL_GRACE_MS = 5000;

export interface McpDeps {
  /** Command prefix in diagnostics: `pi-craft` or the `pi-photocraft` alias. */
  prog: string;
  provision: (opts?: { probeVersion?: boolean }) => Promise<ProvisionReport>;
  spawn: (command: string, args: string[], options: { stdio: ["pipe", "pipe", "inherit"] }) => ChildProcess;
  stdin: Readable;
  stdout: Writable;
  stderr: (text: string) => void;
  cwd: () => string;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  cancelGraceMs: number;
}

export function defaultMcpDeps(app: CraftApp): McpDeps {
  return {
    prog: "pi-craft",
    provision: () => defaultProvision(app),
    spawn: (command, args, options) => sharedSpawn(command, args, options),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (t) => process.stderr.write(t),
    cwd: () => process.cwd(),
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
    cancelGraceMs: CANCEL_GRACE_MS,
  };
}

type ParsedArgs = { kind: "run"; root?: string; allowUnconfined: boolean; compact: boolean } | { kind: "help" } | { kind: "error"; message: string };

export function parseMcpArgs(argv: string[]): ParsedArgs {
  let root: string | undefined;
  let allowUnconfined = false;
  let compact = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--allow-unconfined") {
      allowUnconfined = true;
    } else if (a === "--compact") {
      compact = true;
    } else if (a === "--root") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) return { kind: "error", message: "--root needs a directory" };
      root = v;
    } else if (a.startsWith("--root=")) {
      root = a.slice("--root=".length);
      if (!root) return { kind: "error", message: "--root needs a directory" };
    } else if (REJECTED_OPTIONS.includes(a.split("=")[0])) {
      return { kind: "error", message: `option ${a.split("=")[0]} is not supported: the proxy owns confinement and never attaches to a running desktop app` };
    } else {
      return { kind: "error", message: `unknown option for mcp: ${a}` };
    }
  }
  return { kind: "run", root, allowUnconfined, compact };
}

function sameId(a: unknown, b: unknown): boolean {
  return a === b;
}

export async function runMcp(app: CraftApp, argv: string[], partial: Partial<McpDeps> = {}): Promise<number> {
  const deps: McpDeps = { ...defaultMcpDeps(app), ...partial };
  const usage = mcpUsage(app, deps.prog);
  const parsed = parseMcpArgs(argv);
  if (parsed.kind === "help") {
    deps.stderr(`${usage}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    deps.stderr(`${parsed.message}\n${usage}\n`);
    return 1;
  }
  if (parsed.compact && !app.mcp.compactFlag) {
    deps.stderr(`${deps.prog}: --compact is not supported by ${app.name}'s MCP server\n${usage}\n`);
    return 1;
  }
  const confined = app.mcp.confinement !== false;
  if (!confined && !parsed.allowUnconfined) {
    deps.stderr(
      `${deps.prog}: ${app.name}'s MCP server has no path confinement and can read and write any path the user can; refusing to start. Pass --allow-unconfined to accept that, or use the bash route (${deps.prog === "pi-photocraft" ? deps.prog : `${deps.prog} ${app.id}`} exec …).\n${usage}\n`,
    );
    return 1;
  }
  if (!confined && parsed.root !== undefined) {
    deps.stderr(`${deps.prog}: --root has no effect: ${app.name}'s MCP server cannot confine paths\n${usage}\n`);
    return 1;
  }

  let bin: string;
  try {
    bin = (await deps.provision()).binary;
  } catch (e) {
    deps.stderr(`${deps.prog}: ${(e as Error).message}\n`);
    return 69;
  }

  let spawnArgs: string[];
  if (confined) {
    const root = path.resolve(deps.cwd(), parsed.root ?? ".");
    deps.stderr(`[${deps.prog}] mcp root: ${root}\n`);
    spawnArgs = app.mcp.confinement === "root" ? ["mcp", "--root", root] : ["mcp", "--automation-read-root", root, "--automation-write-root", root];
  } else {
    deps.stderr(`[${deps.prog}] warning: ${app.name}'s MCP server is unconfined — it can read and write any path the user can\n`);
    spawnArgs = ["mcp"];
  }
  if (parsed.compact && app.mcp.compactFlag) spawnArgs.push(app.mcp.compactFlag);
  const child = deps.spawn(bin, spawnArgs, { stdio: ["pipe", "pipe", "inherit"] });

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

    let cancelTimer: NodeJS.Timeout | undefined;
    /** `notifications/cancelled`: drop a queued call; bound the wait on an in-flight one. */
    const onCancelled = (requestId: unknown, line: string) => {
      const queued = queue.findIndex((q) => sameId(q.id, requestId));
      if (queued >= 0) {
        queue.splice(queued, 1); // never reached the server: nothing to cancel there
        return;
      }
      toChild(line);
      if (hasInflight && sameId(inflight, requestId)) {
        clearTimeout(cancelTimer);
        cancelTimer = setTimeout(() => {
          if (!hasInflight || !sameId(inflight, requestId)) return;
          hasInflight = false;
          inflight = undefined;
          pump();
        }, deps.cancelGraceMs);
        cancelTimer.unref();
      }
    };

    const clientRl = readline.createInterface({ input: deps.stdin });
    clientRl.on("line", (line) => {
      if (line.trim() === "") return;
      let msg: { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: { requestId?: unknown } } | undefined;
      try {
        msg = JSON.parse(line);
      } catch {
        return toChild(line);
      }
      const single = msg && !Array.isArray(msg) ? msg : undefined;
      if (single?.method === "tools/call" && single.id !== undefined) {
        queue.push({ raw: line, id: single.id });
        pump();
      } else if (
        single?.method === "notifications/cancelled" &&
        single.jsonrpc === "2.0" &&
        single.id === undefined && // a notification carries no id; anything else passes through untouched
        single.params?.requestId !== undefined
      ) {
        onCancelled(single.params.requestId, line);
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
      deps.stderr(`${deps.prog}: failed to start ${app.cli}: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(cancelTimer);
      clientRl.close();
      // Let buffered server lines flush before reporting.
      setImmediate(() => resolve(exitOverride ?? (signal ? 1 : (code ?? 1))));
    });
  });
}
