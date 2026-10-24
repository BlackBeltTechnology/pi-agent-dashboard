/**
 * Test client for the real `pi-blender mcp` server: spawns `bin/pi-blender mcp` (the launcher, so the
 * process tree is launcher → server → host as in production), speaks line-framed JSON-RPC, and can find
 * the Blender host pid below the launcher.
 *
 * See change: add-blender-wasm-mcp (design D9).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { TEST_CACHE } from "./runtime.js";

export const LAUNCHER = fileURLToPath(new URL("../../../bin/pi-blender", import.meta.url));
export const SOCKET_GUARD = fileURLToPath(new URL("./socket-guard.cjs", import.meta.url));

export interface ToolResultJson {
  raw: { isError?: boolean; content: { type: string; text: string }[] };
  isError: boolean;
  /** Parsed first content block. */
  data: Record<string, unknown>;
  /** Last block when more than one, else undefined. */
  output?: string;
}

export interface McpClient {
  child: ChildProcess;
  rpc(method: string, params?: unknown): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }>;
  notify(method: string, params?: unknown): void;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResultJson>;
  /** Fire a tools/call and return its JSON-RPC id plus the pending response promise. */
  callAsync(name: string, args?: Record<string, unknown>): { id: number; response: Promise<ToolResultJson> };
  stderr(): string;
  close(): Promise<number | null>;
  exited: Promise<number | null>;
}

export interface StartOptions {
  cwd: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export function startServer(opts: StartOptions): McpClient {
  const env: NodeJS.ProcessEnv = { ...process.env, BLENDER_WASM_HOME: TEST_CACHE, ...opts.env };
  const child = spawn(process.execPath, [LAUNCHER, "mcp", ...(opts.args ?? [])], { cwd: opts.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let err = "";
  child.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const rl = readline.createInterface({ input: child.stdout as NodeJS.ReadableStream });
  const waiters = new Map<number, (m: never) => void>();
  rl.on("line", (line) => {
    const m = JSON.parse(line) as { id?: number };
    if (typeof m.id === "number") waiters.get(m.id)?.(m as never);
  });
  let n = 0;
  const rpc: McpClient["rpc"] = (method, params) =>
    new Promise((resolve) => {
      const id = ++n;
      waiters.set(id, resolve as (m: never) => void);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const decode = (r: Awaited<ReturnType<McpClient["rpc"]>>): ToolResultJson => {
    const raw = r.result as ToolResultJson["raw"];
    return { raw, isError: raw.isError === true, data: JSON.parse(raw.content[0].text) as Record<string, unknown>, output: raw.content.length > 1 ? raw.content[raw.content.length - 1].text : undefined };
  };
  const callAsync: McpClient["callAsync"] = (name, args = {}) => {
    const id = n + 1;
    return { id, response: rpc("tools/call", { name, arguments: args }).then(decode) };
  };
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return {
    child,
    rpc,
    notify: (method, params) => void child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    call: (name, args = {}) => callAsync(name, args).response,
    callAsync,
    stderr: () => err,
    close: async () => {
      child.stdin?.end();
      return exited;
    },
    exited,
  };
}

/** Every descendant pid of `pid` (children, grandchildren, ...). POSIX: `ps`; Windows: PowerShell CIM. */
export function descendants(pid: number): { pid: number; command: string }[] {
  let table: { pid: number; ppid: number; command: string }[] = [];
  if (process.platform === "win32") {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)\" }"], { encoding: "utf8" });
    table = out.split(/\r?\n/).filter(Boolean).map((l) => {
      const [p, pp, ...rest] = l.split("|");
      return { pid: Number(p), ppid: Number(pp), command: rest.join("|") };
    });
  } else {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    table = out.split("\n").filter(Boolean).map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      return { pid: Number(m?.[1]), ppid: Number(m?.[2]), command: m?.[3] ?? "" };
    });
  }
  const found: { pid: number; command: string }[] = [];
  const queue = [pid];
  while (queue.length) {
    const parent = queue.shift() as number;
    for (const p of table) if (p.ppid === parent && !found.some((f) => f.pid === p.pid)) {
      found.push({ pid: p.pid, command: p.command });
      queue.push(p.pid);
    }
  }
  return found;
}

/** The Blender host child below `launcherPid` (its command line names `host.ts` / `host.js`), if any. */
export function hostPidBelow(launcherPid: number): number | undefined {
  return descendants(launcherPid).find((d) => /[\\/]host\.(ts|js)\b/.test(d.command) && d.command.includes("--runtime-dir"))?.pid;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function waitUntil(cond: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}
