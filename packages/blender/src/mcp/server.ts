/**
 * Hand-rolled newline-delimited JSON-RPC 2.0 MCP server over stdio (design D8). Handles `initialize`,
 * `notifications/initialized`, `ping`, `tools/list`, `tools/call` and `notifications/cancelled`; any
 * other method gets `-32601`, bad JSON `-32700`. Nothing but protocol messages is ever written to
 * stdout. Lazy: no probe, provisioning or boot happens until the first Blender tool call.
 *
 * See change: add-blender-wasm-mcp (design D8, D6, task 4.5).
 */
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Supervisor } from "../host/supervisor.js";
import { startTool, TOOL_DEFS, type ToolContext, type ToolRun } from "./tools.js";
import type { Limits } from "./workspace.js";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];

/** How long a closed server waits for calls that cannot be aborted (probe/provision) before exiting. */
const SHUTDOWN_GRACE_MS = 2000;

export interface ServerDeps {
  stdin: Readable;
  stdout: Writable;
  stderr: (text: string) => void;
  root: string;
  limits: Limits;
  supervisor: Pick<Supervisor, "enqueue" | "takeReset" | "shutdown">;
  version: string;
}

type Id = string | number;

interface Rpc {
  jsonrpc?: unknown;
  id?: Id | null;
  method?: unknown;
  params?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Run the server until stdin ends; resolves with the process exit code (always 0). */
export async function runServer(deps: ServerDeps): Promise<number> {
  const inflight = new Map<Id, ToolRun>();
  const ctx: ToolContext = { root: deps.root, supervisor: deps.supervisor as ToolContext["supervisor"], limits: deps.limits };
  const pending = new Set<Promise<void>>();

  const write = (msg: unknown): void => {
    deps.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  const reply = (id: Id | null, result: unknown): void => write({ jsonrpc: "2.0", id, result });
  const fail = (id: Id | null, code: number, message: string): void => write({ jsonrpc: "2.0", id, error: { code, message } });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: JSON-RPC method dispatch: each branch is one protocol method.
  const handle = (msg: Rpc): void => {
    const hasId = msg.id !== undefined && msg.id !== null;
    const id = hasId ? (msg.id as Id) : null;
    if (typeof msg.method !== "string") {
      if (hasId) fail(id, -32600, "invalid request");
      return;
    }
    switch (msg.method) {
      case "initialize": {
        const requested = isObject(msg.params) ? msg.params.protocolVersion : undefined;
        const version = (SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        reply(id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "blender-wasm", version: deps.version },
        });
        return;
      }
      case "notifications/initialized":
        return;
      case "ping":
        if (hasId) reply(id, {});
        return;
      case "tools/list":
        if (hasId) reply(id, { tools: TOOL_DEFS });
        return;
      case "tools/call": {
        if (!hasId) return;
        const params = isObject(msg.params) ? msg.params : {};
        const name = typeof params.name === "string" ? params.name : "";
        const run = startTool(name, params.arguments, ctx);
        inflight.set(id as Id, run);
        const p = run.promise
          .then((result) => {
            if ("cancelled" in result) return;
            reply(id, result);
          })
          .catch((e: unknown) => {
            deps.stderr(`blender-wasm: internal error: ${(e as Error).stack ?? String(e)}\n`);
            reply(id, { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "session-crashed", message: `internal error: ${(e as Error).message}`, sessionReset: false, durationMs: 0 }) }] });
          })
          .finally(() => {
            inflight.delete(id as Id);
            pending.delete(p);
          });
        pending.add(p);
        return;
      }
      case "notifications/cancelled": {
        // A notification carries no id; one that does is a malformed request and would wait for a reply forever.
        if (hasId) {
          fail(id, -32600, "notifications/cancelled is a notification and must not carry an id");
          return;
        }
        const requestId = isObject(msg.params) ? msg.params.requestId : undefined;
        if (typeof requestId === "string" || typeof requestId === "number") inflight.get(requestId)?.cancel();
        return;
      }
      default:
        if (hasId) fail(id, -32601, `method not found: ${msg.method}`);
    }
  };

  const rl = readline.createInterface({ input: deps.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      return;
    }
    if (!isObject(parsed) || parsed.jsonrpc !== "2.0") {
      const id = isObject(parsed) && (typeof parsed.id === "string" || typeof parsed.id === "number") ? parsed.id : null;
      fail(id, -32600, 'invalid request: a JSON-RPC 2.0 object ("jsonrpc": "2.0") is required');
      return;
    }
    handle(parsed as Rpc);
  });
  await new Promise<void>((resolve) => rl.once("close", resolve));
  await deps.supervisor.shutdown();
  // A cancelled call writes no reply. A call still inside probe/provision has no abort hook, so wait for the
  // pending calls only briefly: the client is gone and the process exit ends any in-flight download.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
  return 0;
}
