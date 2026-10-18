/**
 * NUL-delimited JSON framing for Chrome's `--remote-debugging-pipe` (fd 3 =
 * commands to Chrome, fd 4 = messages from Chrome), the same framing Playwright
 * and Puppeteer use on every OS.
 *
 * The decoder works on raw bytes and only decodes a frame once its terminating
 * NUL arrived, so a multi-byte UTF-8 character split across two chunks is
 * never corrupted. Large frames (screencast) are collected as a chunk list and
 * concatenated once, not on every chunk.
 *
 * See change: add-dedicated-agent-browser (D1).
 */

/** Serialise one message as `<json>\0`. */
export function encodeFrame(msg: object): Buffer {
  return Buffer.from(`${JSON.stringify(msg)}\0`, "utf8");
}

/** Incremental NUL-frame splitter: handles split, merged and empty chunks. */
export class NulFrameDecoder {
  private chunks: Buffer[] = [];

  /** Feed a chunk; returns every frame completed by it (UTF-8 strings, no NUL). */
  push(chunk: Buffer | string): string[] {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const frames: string[] = [];
    let start = 0;
    for (;;) {
      const nul = buf.indexOf(0, start);
      if (nul < 0) break;
      const piece = buf.subarray(start, nul);
      const whole = this.chunks.length > 0 ? Buffer.concat([...this.chunks, piece]) : piece;
      this.chunks = [];
      if (whole.length > 0) frames.push(whole.toString("utf8"));
      start = nul + 1;
    }
    if (start < buf.length) this.chunks.push(buf.subarray(start));
    return frames;
  }

  /** Drop any partial frame (pipe closed / process gone). */
  reset(): void {
    this.chunks = [];
  }
}
