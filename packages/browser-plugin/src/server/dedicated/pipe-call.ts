/**
 * Shared CDP-over-pipe plumbing for the dedicated Chrome (change:
 * add-dedicated-agent-browser, D4).
 *
 * `DedicatedChrome` reserves ids ≥ `CHROME_INTERNAL_ID_BASE` for its own
 * commands and swallows their replies. EVERY other sender on the pipe — the
 * live `DedicatedInstance` (client commands rewritten, server-owned commands)
 * and the instance-less `openHiddenTab` — draws ids from the ONE counter below,
 * so ids never collide across instance generations (a late reply addressed to a
 * closed instance can never match a command of the next one) and always stay
 * below the internal range.
 */
import { CHROME_INTERNAL_ID_BASE, type ChromeExitInfo } from "./chrome-process.js";

/** The slice of `DedicatedChrome` the bridge needs; `FakeChromePipe` implements it too. */
export interface PipeLike {
  send(msg: object): void;
  onMessage(cb: (msg: unknown) => void): () => void;
  onExit(cb: (info: ChromeExitInfo) => void): () => void;
  /** Stamp `lastUsed`; optional so a bare fake need not implement it. */
  touch?(): void;
}

let seq = 0;

/** Next pipe command id: monotonic, wraps before `CHROME_INTERNAL_ID_BASE`. */
export function nextCdpId(): number {
  seq = seq + 1 >= CHROME_INTERNAL_ID_BASE ? 1 : seq + 1;
  return seq;
}

export interface CdpError {
  code: number;
  message: string;
}

export class PipeCallError extends Error {
  readonly cdp?: CdpError;
  constructor(message: string, cdp?: CdpError) {
    super(message);
    this.name = "PipeCallError";
    this.cdp = cdp;
  }
}

export interface PipeCallOptions {
  sessionId?: string;
  timeoutMs?: number;
}

export const DEFAULT_PIPE_CALL_TIMEOUT_MS = 15_000;

/**
 * One command over the pipe with its own reply listener. For the rare
 * instance-less callers; a live instance routes replies through its own
 * pending map instead of adding a listener per call.
 */
export function pipeCall(
  chrome: PipeLike,
  method: string,
  params: object | undefined,
  opts: PipeCallOptions = {},
): Promise<unknown> {
  const id = nextCdpId();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PIPE_CALL_TIMEOUT_MS;
  return new Promise<unknown>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done: Array<() => void> = [];
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const fn of done) fn();
    };
    done.push(
      chrome.onMessage((raw) => {
        const msg = raw as { id?: unknown; result?: unknown; error?: CdpError };
        if (msg?.id !== id) return;
        cleanup();
        if (msg.error) reject(new PipeCallError(msg.error.message ?? `${method} failed`, msg.error));
        else resolve(msg.result);
      }),
    );
    done.push(chrome.onExit(() => {
      cleanup();
      reject(new PipeCallError("dedicated Chrome exited"));
    }));
    timer = setTimeout(() => {
      cleanup();
      reject(new PipeCallError(`${method} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    try {
      chrome.send({ id, method, ...(params ? { params } : {}), ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) });
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new PipeCallError(String(err)));
    }
  });
}
