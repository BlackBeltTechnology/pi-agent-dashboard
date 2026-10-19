/**
 * Streamed SHA-1 of an open file handle + a small concurrency limiter, for
 * `GET /api/file/digest` (content-hash conflict token; no content leaves).
 *
 * The limiter bounds in-flight hashes server-wide so a burst of digests cannot
 * starve the event loop's disk reads; a slot is released when the hash ends OR
 * the client aborts (the abort destroys the read stream, so an abandoned
 * 256 MiB hash frees its slot at once). A task still queued when its client
 * aborts never starts.
 *
 * See change: add-editor-pane-file-handlers (minimal slice of
 * gate-changed-on-disk-by-content D4).
 */
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { createSemaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";

/** Above this size the digest reports `size`/`mtime` only (no `sha1`). */
export const DIGEST_CEILING_BYTES = 256 * 1024 * 1024;
/** In-flight hashes allowed at once. */
export const DIGEST_MAX_CONCURRENT = 2;

export interface HashLimiter {
  /** Run `task` once a slot is free; rejects (without starting) when `signal` is already aborted. */
  run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T>;
}

export function createHashLimiter(max: number = DIGEST_MAX_CONCURRENT): HashLimiter {
  const sem = createSemaphore(max);
  return {
    run: (signal, task) =>
      sem.run(async () => {
        signal.throwIfAborted();
        return task();
      }),
  };
}

/** Hex SHA-1 of the handle's content from offset 0 to EOF. Aborting `signal` destroys the stream and rejects. */
export async function sha1OfHandle(fh: FileHandle, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha1");
  const stream = fh.createReadStream({ autoClose: false, start: 0, highWaterMark: 1024 * 1024 });
  const onAbort = (): void => {
    stream.destroy();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally {
    signal.removeEventListener("abort", onAbort);
    stream.destroy();
  }
  signal.throwIfAborted();
  return hash.digest("hex");
}
