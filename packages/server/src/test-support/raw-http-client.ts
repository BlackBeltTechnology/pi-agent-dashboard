/**
 * Tiny `node:http` client for L1 tests that `fastify.inject` cannot express: a chosen
 * `Content-Length` or `Transfer-Encoding: chunked`, a body streamed (or trickled) chunk by
 * chunk, and a mid-body abort. Talks to a real socket (`app.listen({ port: 0 })`).
 *
 * Test-only. See change: harden-cors-and-csp-reporting (test-plan "Real-socket helper").
 */
import http, { type IncomingHttpHeaders } from "node:http";

export interface RawRequestOptions {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string | number>;
  /** Body pieces written in order. Without a `content-length` header the request is chunked. */
  chunks?: Iterable<Buffer | string>;
  /** Pause between chunks (default: one macrotask). */
  chunkDelayMs?: number;
  /** Destroy the socket after the last chunk instead of ending the request. */
  abortAfterChunks?: boolean;
}

export interface RawResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  /** Bytes the client had written when the response head arrived. */
  writtenAtResponse: number;
  /** Bytes the client wrote in total before it finished or the socket failed. */
  written: number;
  /** The wall-clock ms from first write to the response head. */
  responseAfterMs: number;
}

export interface RawRequestHandle {
  done: Promise<RawResult>;
  /** Destroy the client socket now. */
  destroy(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : setImmediate(r)));

export function rawRequest(opts: RawRequestOptions): RawRequestHandle {
  let written = 0;
  let writtenAtResponse = -1;
  const startedAt = Date.now();
  let responseAt = startedAt;
  // `agent: false`: a fresh socket per request, so a server-side close is observable.
  const req = http.request({
    host: "127.0.0.1",
    port: opts.port,
    path: opts.path,
    method: opts.method ?? "POST",
    headers: opts.headers,
    agent: false,
  });
  req.on("error", () => {
    /* surfaced through `done` (response) or ignored (server closed on us) */
  });

  const done = new Promise<RawResult>((resolve, reject) => {
    let responded = false;
    req.on("response", (res) => {
      responded = true;
      writtenAtResponse = written;
      responseAt = Date.now();
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      const fin = () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(parts).toString("utf8"),
          writtenAtResponse,
          written,
          responseAfterMs: responseAt - startedAt,
        });
      res.on("end", fin);
      res.on("error", fin);
    });
    req.on("close", () => {
      if (!responded) reject(new Error("socket closed before a response"));
    });
  });

  done.catch(() => {
    /* callers that abort on purpose never await `done` */
  });

  const pump = async () => {
    for (const piece of opts.chunks ?? []) {
      if (req.destroyed) return;
      const buf = typeof piece === "string" ? Buffer.from(piece) : piece;
      req.write(buf);
      written += buf.length;
      await sleep(opts.chunkDelayMs ?? 0);
    }
    if (opts.abortAfterChunks) req.destroy();
    else if (!req.destroyed) req.end();
  };
  void pump().catch(() => {
    /* socket gone */
  });

  return { done, destroy: () => req.destroy() };
}
