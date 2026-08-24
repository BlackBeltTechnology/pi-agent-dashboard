/**
 * Bounded, resumable reads of a session `.jsonl` — the lazy half of D12.
 *
 * Every read costs at most `maxBytes`, so a 44 MB transcript (the observed
 * maximum) never sits between a user and a usable session: registration
 * completes, live events forward, and history arrives behind them.
 *
 * **The cursor does not trust a byte offset.** Task 11.2 could only establish
 * that no prefix rewrite has been *observed* in pi 0.84.1 — not that the prefix
 * is byte-stable, and the format is pi's, not ours. So the cursor carries a
 * witness (length + hash) for the last consumed line; on mismatch the read
 * restarts from zero rather than resuming into misaligned bytes. That also
 * covers #X18, because a truncated transfer and a rewritten prefix are
 * indistinguishable from an offset alone.
 *
 * A partial trailing line — a write caught mid-flight — is never emitted and
 * never counted as complete. Partial data presented as whole is the failure
 * mode this exists to prevent.
 *
 * See change: add-pi-gateway-transport-identity (D12; tasks 11.5, 11.6).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";

const DEFAULT_MAX_BYTES = 256 * 1024;

export interface TranscriptCursor {
  /** Byte offset immediately after the last consumed line's terminator. */
  offset: number;
  /** Byte length of the last consumed line, excluding its terminator. */
  lastLineLength: number;
  /** Witness for the last consumed line's bytes. */
  lastLineHash: string;
}

export interface TranscriptChunk {
  /** Whole `.jsonl` lines, verbatim. Never a partial line. */
  entries: string[];
  cursor?: TranscriptCursor;
  /** True when the reader reached a clean end of file. */
  complete: boolean;
  /** True when the cursor did not match and the read started over. */
  restarted: boolean;
}

const hashLine = (line: string): string =>
  createHash("sha256").update(line).digest("hex").slice(0, 16);

export function makeCursor(offset: number, lastLine: string): TranscriptCursor {
  return {
    offset,
    lastLineLength: Buffer.byteLength(lastLine),
    lastLineHash: hashLine(lastLine),
  };
}

/** Does the file still contain, ending at `cursor.offset - 1`, the line we last read? */
function cursorStillValid(fd: number, size: number, cursor: TranscriptCursor): boolean {
  const lineStart = cursor.offset - cursor.lastLineLength - 1;
  if (lineStart < 0 || cursor.offset > size) return false;
  const buf = Buffer.alloc(cursor.lastLineLength);
  const read = fs.readSync(fd, buf, 0, cursor.lastLineLength, lineStart);
  if (read !== cursor.lastLineLength) return false;
  return hashLine(buf.toString("utf8")) === cursor.lastLineHash;
}

export function readTranscriptChunk(
  filePath: string,
  cursor: TranscriptCursor | undefined,
  opts: { maxBytes?: number },
): TranscriptChunk {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    // Absent is a normal startup state, not a failure to tear the backfill
    // down over. Nothing to send, nothing outstanding.
    return { entries: [], complete: true, restarted: false };
  }

  try {
    const size = fs.fstatSync(fd).size;
    let restarted = false;
    let start = 0;

    if (cursor) {
      if (cursorStillValid(fd, size, cursor)) {
        start = cursor.offset;
      } else {
        restarted = true;
      }
    }

    const entries: string[] = [];
    let offset = start;
    let lastLine: string | undefined;
    let sawTerminatedLine = false;
    let pending = "";

    while (offset < size && offset - start < maxBytes) {
      const want = Math.min(maxBytes, size - offset);
      const buf = Buffer.alloc(want);
      const read = fs.readSync(fd, buf, 0, want, offset);
      if (read <= 0) break;
      pending += buf.toString("utf8", 0, read);
      offset += read;

      let nl = pending.indexOf("\n");
      // An oversized line must still make progress: keep reading past maxBytes
      // until its terminator is found, or one entry wedges the backfill.
      while (nl === -1 && offset < size) {
        const more = Buffer.alloc(Math.min(maxBytes, size - offset));
        const n = fs.readSync(fd, more, 0, more.length, offset);
        if (n <= 0) break;
        pending += more.toString("utf8", 0, n);
        offset += n;
        nl = pending.indexOf("\n");
      }

      while (nl !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (line.length > 0) {
          entries.push(line);
          lastLine = line;
          sawTerminatedLine = true;
        }
        nl = pending.indexOf("\n");
      }
    }

    // Bytes consumed past the last terminator are an unterminated tail: rewind
    // so the next read sees that line whole.
    const consumed = offset - Buffer.byteLength(pending);
    const complete = pending.length === 0 && offset >= size;

    const nextCursor =
      sawTerminatedLine && lastLine !== undefined
        ? makeCursor(consumed, lastLine)
        : restarted
          ? undefined
          : cursor;

    return { entries, cursor: nextCursor, complete, restarted };
  } finally {
    fs.closeSync(fd);
  }
}
