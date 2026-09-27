/**
 * `createLoopbackCallback` — a one-shot OAuth redirect listener for plugin
 * server entries. Binds `127.0.0.1` on an ephemeral port, generates `state`
 * itself (32 random bytes, base64url), and resolves with the `code` of the
 * first `GET <path>` whose `state` matches.
 *
 * The state check comes FIRST: a missing/mismatched state (even one carrying
 * `error=`) gets a 400 and the helper keeps waiting, so a stray or hostile
 * local request cannot kill the flow. Other paths get a 404. Only a
 * state-matched `error=` rejects. Pure `node:http`.
 *
 * Local-only: remote dashboards use the `manual_code` paste fallback.
 * See change: expose-plugin-credential-and-oauth-seams (D5).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackCallbackOptions {
  /** Callback path. Default `/callback`. */
  path?: string;
  /** Give up after this long. Default 5 min. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** HTML answered to the browser on a successful callback (default: a minimal English page). */
  successHtml?: string;
}

export interface LoopbackCallback {
  redirectUri: string;
  state: string;
  /** Resolves with the authorization code; rejects on error / timeout / abort. */
  waitForCode(): Promise<{ code: string }>;
  /** Idempotent. */
  close(): void;
  /** The underlying listener (for address inspection). */
  server: http.Server;
}

export class LoopbackCallbackError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LoopbackCallbackError";
    this.code = code;
  }
}

const DONE_PAGE =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title></head>" +
  "<body><p>Sign-in complete. You can close this window.</p></body></html>";

function stateMatches(expected: string, got: string | null): boolean {
  if (got === null) return false;
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(got, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function createLoopbackCallback(
  opts: LoopbackCallbackOptions = {},
): Promise<LoopbackCallback> {
  const cbPath = opts.path ?? "/callback";
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const state = randomBytes(32).toString("base64url");

  let resolveCode!: (v: { code: string }) => void;
  let rejectCode!: (e: Error) => void;
  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Avoid an unhandled rejection when the caller never awaits.
  result.catch(() => {});

  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== cbPath) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const params = url.searchParams;
    if (!stateMatches(state, params.get("state"))) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Invalid state");
      return;
    }
    const error = params.get("error");
    if (error) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Sign-in failed");
      const desc = params.get("error_description");
      finish(() => rejectCode(new LoopbackCallbackError(error, desc ?? error)));
      return;
    }
    const code = params.get("code");
    if (!code) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Missing code");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(opts.successHtml ?? DONE_PAGE);
    finish(() => resolveCode({ code }));
  });

  const onAbort = () => finish(() => rejectCode(new LoopbackCallbackError("aborted", "Sign-in aborted")));

  function close(): void {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    server.close();
    server.closeAllConnections?.();
  }

  function finish(settle: () => void): void {
    if (closed) return;
    settle();
    close();
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (opts.signal?.aborted) {
    onAbort();
  } else {
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      () => finish(() => rejectCode(new LoopbackCallbackError("timeout", "Sign-in timed out"))),
      timeoutMs,
    );
    timer.unref?.();
  }

  const { port } = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${port}${cbPath}`,
    state,
    waitForCode: () => result,
    close,
    server,
  };
}
