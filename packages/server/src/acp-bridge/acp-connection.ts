/**
 * ACP JSON-RPC 2.0 peer over NDJSON stdio — the hostile-input boundary.
 *
 * The agent is untrusted: stdout is split into lines with a hard per-line byte
 * cap (an over-long line is discarded through its newline while buffered memory
 * stays ≤ cap), non-JSON lines are skipped (agents log to stdout), payload
 * content is never evaluated, and agent-initiated requests we do not implement
 * get `-32601` (notifications are never answered). Outbound requests time out.
 *
 * A thin purpose-built peer rather than the SDK's `ndJsonStream`: that one has
 * no line cap, no non-JSON tolerance and no per-request timeout. The SDK stays a
 * dependency for the wire types.
 *
 * See change: add-acp-session-driver (D6, D9, "Untrusted agent output handling").
 */
import type { Readable, Writable } from "node:stream";

export interface AcpConnectionCounters {
  /** Non-JSON / non-object lines skipped. */
  skippedLines: number;
  /** Lines discarded for exceeding `maxLineBytes`. */
  discardedLines: number;
}

export class RpcTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`ACP request ${method} timed out after ${ms} ms`);
    this.name = "RpcTimeoutError";
  }
}

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** Bounded NDJSON splitter over byte chunks. Peak buffer ≤ `maxLineBytes`. */
export class LineSplitter {
  private parts: Buffer[] = [];
  private len = 0;
  private discarding = false;
  discarded = 0;
  private readonly maxLineBytes: number;

  constructor(maxLineBytes: number) {
    this.maxLineBytes = maxLineBytes;
  }

  /** Feed a chunk; returns complete lines (UTF-8, without the newline). */
  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf(0x0a, start);
      const end = nl < 0 ? chunk.length : nl;
      this.append(chunk.subarray(start, end));
      if (nl < 0) break;
      if (this.discarding) {
        this.discarding = false;
        this.discarded += 1;
      } else lines.push(this.take());
      this.parts = [];
      this.len = 0;
      start = nl + 1;
    }
    return lines;
  }

  private append(slice: Buffer): void {
    if (this.discarding || slice.length === 0) return;
    if (this.len + slice.length > this.maxLineBytes) {
      this.discarding = true;
      this.parts = [];
      this.len = 0;
      return;
    }
    this.parts.push(slice);
    this.len += slice.length;
  }

  private take(): string {
    return Buffer.concat(this.parts, this.len).toString("utf8");
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: ReturnType<typeof setTimeout>; method: string };

export type RequestHandler = (params: unknown) => Promise<unknown> | unknown;

export interface AcpConnectionOptions {
  input: Readable;
  output: Writable;
  maxLineBytes: number;
  requestTimeoutMs: number;
  /** Agent→client requests we implement (everything else → `-32601`). */
  requestHandlers?: Record<string, RequestHandler>;
  onNotification?: (method: string, params: unknown) => void;
  /** Fired when the input stream ends. */
  onClose?: () => void;
}

export interface AcpConnection {
  /** `timeoutMs`: default `requestTimeoutMs`; `0` disables (long-running `session/prompt`). */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  counters(): AcpConnectionCounters;
  /** Reject all pending requests (agent gone) and stop reading. */
  close(reason: Error): void;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createAcpConnection(o: AcpConnectionOptions): AcpConnection {
  const splitter = new LineSplitter(o.maxLineBytes);
  const pending = new Map<number | string, Pending>();
  let nextId = 1;
  let closed = false;
  let skipped = 0;

  const write = (obj: Record<string, unknown>): void => {
    if (closed || o.output.destroyed || !o.output.writable) return;
    o.output.write(`${JSON.stringify({ jsonrpc: "2.0", ...obj })}\n`);
  };

  async function handleRequest(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = o.requestHandlers?.[method];
    if (!handler || !Object.hasOwn(o.requestHandlers ?? {}, method)) {
      write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    try {
      write({ id, result: (await handler(params)) ?? null });
    } catch (err) {
      write({ id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
    }
  }

  function handleResponse(msg: Record<string, unknown>): void {
    const id = msg.id as number | string;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    if (isRec(msg.error)) {
      const e = msg.error;
      p.reject(new RpcError(typeof e.code === "number" ? e.code : -32000, typeof e.message === "string" ? e.message : "error", e.data));
    } else p.resolve(msg.result);
  }

  function dispatch(msg: Record<string, unknown>): void {
    const hasId = typeof msg.id === "number" || typeof msg.id === "string";
    if (typeof msg.method === "string") {
      if (hasId) void handleRequest(msg.id as number | string, msg.method, msg.params);
      else o.onNotification?.(msg.method, msg.params);
    } else if (hasId) handleResponse(msg);
    else skipped += 1;
  }

  function onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skipped += 1;
      return;
    }
    if (!isRec(parsed)) {
      skipped += 1;
      return;
    }
    dispatch(parsed);
  }

  o.input.on("data", (chunk: Buffer | string) => {
    if (closed) return;
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (const line of splitter.push(buf)) onLine(line);
  });
  const ended = () => {
    if (closed) return;
    o.onClose?.();
  };
  o.input.on("end", ended);
  o.input.on("close", ended);

  return {
    request(method, params, timeoutMs = o.requestTimeoutMs) {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error("ACP connection closed"));
          return;
        }
        const id = nextId++;
        const entry: Pending = { resolve, reject, method };
        if (timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id);
            reject(new RpcTimeoutError(method, timeoutMs));
          }, timeoutMs);
        }
        pending.set(id, entry);
        write({ id, method, params });
      });
    },
    notify: (method, params) => write({ method, params }),
    counters: () => ({ skippedLines: skipped, discardedLines: splitter.discarded }),
    close(reason) {
      if (closed) return;
      closed = true;
      for (const [, p] of pending) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(reason);
      }
      pending.clear();
    },
  };
}
