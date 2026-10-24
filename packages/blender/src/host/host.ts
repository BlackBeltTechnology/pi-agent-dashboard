/**
 * The disposable Blender host child (design D1). One process = one Blender session; the MCP server
 * kills it to end a session, so a wedged JSPI call, an OOM or an abort never takes the server down.
 *
 * `--probe`: print `{"jspi": boolean, "node": process.version}` and exit (no runtime touched).
 * Normal mode (`--runtime-dir <package dir>`; the session loads `<dir>/runtime/`): pose as a browser page for the published `st` runtime —
 * `self`/`location`, a runtime-confined `fetch`, a worker_thread-backed `Worker` (the Blender worker
 * deletes `process` and every network constructor, see worker-boot.cjs) — boot the session, send
 * `{type:"ready"}`, then serve `HostRequest` ops over IPC one at a time. Exits non-zero on worker
 * error/exit, session fatal, a rejected request or a corrupt response, and exits on IPC `disconnect`
 * (the server, or an ancestor, died).
 *
 * See change: add-blender-wasm-mcp (design D1, D4, tasks 3.3).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { buildJobScript, interpretResponse, type SessionResponse, stripProtocolNoise, tailBytes } from "./jobs.js";
import { type HostMessage, type HostRequest, type HostResult, OUTPUT_TAIL_BYTES } from "./protocol.js";

interface SessionLike {
  boot(): Promise<void>;
  request(req: {
    job: { commands: never[]; script: string; known: object; handlers: object; reportGeometry: boolean };
    files: Record<string, Uint8Array>;
    load?: { kind: "factory" | "empty" } | { kind: "blend"; bytes: Uint8Array };
  }): Promise<SessionResponse>;
  close(): void;
}

let exiting = false;
function die(message: string, code = 1): never {
  if (!exiting) {
    exiting = true;
    process.stderr.write(`${message}\n`);
  }
  process.exit(code);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function send(msg: HostMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error("no IPC channel"));
    process.send(msg, undefined, undefined, (err) => (err ? reject(err) : resolve()));
  });
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".json")) return "application/json";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

/** Browser globals the published session code expects, all confined to the runtime directory. */
function installBrowserGlobals(runtimeUrl: string): void {
  const g = globalThis as Record<string, unknown>;
  g.self = globalThis;
  g.location = new URL(runtimeUrl);
  g.fetch = async (input: unknown): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    const u = new URL(raw, runtimeUrl);
    if (u.protocol !== "file:") throw new TypeError(`network disabled: ${u.href}`);
    if (!u.href.startsWith(runtimeUrl)) throw new TypeError(`outside the runtime directory: ${u.href}`);
    const bytes = await fs.promises.readFile(u);
    return new Response(bytes, { headers: { "content-type": contentType(u.pathname), "content-length": String(bytes.length) } });
  };
  for (const name of ["WebSocket", "EventSource", "XMLHttpRequest", "WebSocketStream"]) {
    try {
      delete g[name];
    } catch {
      /* non-configurable on this Node: the worker deletes them again and the X4/X5 guard tests would catch a leak */
    }
  }

  const bootPath = fileURLToPath(new URL("./worker-boot.cjs", import.meta.url));
  class ThreadWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: Error) => void) | null = null;
    private readonly w: NodeWorker;
    constructor(url: unknown) {
      this.w = new NodeWorker(bootPath, {
        workerData: { url: String(url) },
        resourceLimits: { maxOldGenerationSizeMb: 4096 },
      });
      this.w.on("message", (data) => this.onmessage?.({ data }));
      this.w.on("error", (e: Error) => {
        if (this.onerror) this.onerror(e);
        die(`blender worker error: ${e.stack ?? e.message}`);
      });
      this.w.on("exit", (code) => die(`blender worker exited (code ${code})`));
    }
    postMessage(data: unknown, transfer?: unknown[]): void {
      this.w.postMessage(data, transfer?.filter((t): t is ArrayBuffer => t instanceof ArrayBuffer));
    }
    terminate(): void {
      void this.w.terminate();
    }
    addEventListener(type: string, fn: never): void {
      if (type === "message") this.onmessage = fn;
      if (type === "error") this.onerror = fn;
    }
  }
  g.Worker = ThreadWorker;
}

function runtimeVersion(dir: string): string {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

async function serve(session: SessionLike, version: string, req: HostRequest): Promise<HostResult> {
  const script = buildJobScript(req.op, req.args, req.nonce, req.outputLimit);
  let load: { kind: "factory" | "empty" } | { kind: "blend"; bytes: Uint8Array } | undefined;
  if (req.op === "reset") load = { kind: (req.args as { mode: "factory" | "empty" }).mode };
  else if (req.op === "import" && req.blend) load = { kind: "blend", bytes: req.blend };
  const r = await session.request({
    job: { commands: [], script, known: {}, handlers: {}, reportGeometry: false },
    files: req.files,
    ...(load ? { load } : {}),
  });
  const tail = tailBytes(stripProtocolNoise(r.output), OUTPUT_TAIL_BYTES);
  const base = { type: "result" as const, id: req.id, output: tail.text, outputTruncated: tail.truncated };
  const out = interpretResponse(req.op, req.nonce, req.outputLimit, r);
  if (out.kind === "corrupt") die(`corrupt session response (${out.message}); session killed`);
  if (out.kind === "error") return { ...base, ok: false, code: out.code, message: out.message };
  const result = req.op === "scene" ? { ...out.result, runtimeVersion: version } : out.result;
  return { ...base, ok: true, result, files: out.files };
}

async function main(): Promise<void> {
  if (process.argv.includes("--probe")) {
    const wasm = (globalThis as { WebAssembly?: { Suspending?: unknown } }).WebAssembly;
    const jspi = typeof wasm?.Suspending === "function";
    process.stdout.write(`${JSON.stringify({ jspi, node: process.version })}\n`);
    process.exit(0);
  }
  const dir = argValue("--runtime-dir");
  if (!dir) die("host: --runtime-dir is required");
  const href = pathToFileURL(path.resolve(dir, "runtime")).href;
  const runtimeUrl = href.endsWith("/") ? href : `${href}/`;
  installBrowserGlobals(runtimeUrl);

  const mod = (await import(pathToFileURL(path.join(dir, "dist", "browser", "index.js")).href)) as {
    createBlenderSession(o: { runtimeUrl: string; threads: boolean }): SessionLike;
  };
  const session = mod.createBlenderSession({ runtimeUrl, threads: false });
  await session.boot();
  const version = runtimeVersion(dir);
  process.on("disconnect", () => process.exit(0));
  let chain: Promise<void> = Promise.resolve();
  process.on("message", (msg: HostRequest) => {
    if (msg?.type !== "op") return;
    chain = chain.then(async () => {
      try {
        await send(await serve(session, version, msg));
      } catch (e) {
        die(`host request failed: ${(e as Error).stack ?? String(e)}`);
      }
    });
  });
  await send({ type: "ready", runtimeVersion: version });
}

main().catch((e) => die(`host boot failed: ${(e as Error).stack ?? String(e)}`));
