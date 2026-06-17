/**
 * `DrainingFakeWs` — a timing-aware fake WebSocket for the broadcast load
 * harness. Unlike the static `makeFakeWs` in
 * `browser-gateway-broadcast-serialize-once.test.ts` (whose `send` is a spy
 * and `bufferedAmount` is a frozen `0`), this fake models the send queue as a
 * byte counter that fills on `send(frame)` and drains under a caller-owned
 * virtual clock via `advance(ms)`.
 *
 * This is the only genuinely new primitive in the harness — everything else
 * drives the REAL gateway (`createBrowserGateway` + `wss.emit("connection")`).
 *
 * Drain model: the wire drains FIFO at a constant `drainRateBytesPerMs`. A
 * frame is "flushed" once the wire has drained every byte queued ahead of it
 * plus itself. Because drain is continuous at a constant rate, the flush time
 * of a frame is exactly `bytesAtEnqueue / drainRateBytesPerMs` measured from
 * its enqueue moment — `bytesAtEnqueue` is the buffer depth (including the
 * frame itself) captured at send time, so it already accounts for any draining
 * that happened before this frame was enqueued. This is the head-of-line
 * blocking metric: a small frame queued behind a large one inherits the large
 * frame's bytes in its `bytesAtEnqueue` and therefore flushes later.
 *
 * NOTE: the linear drain model ignores TCP slow-start, Nagle, and OS buffers.
 * It proves RELATIVE effects (B worse than A; C/D/E worsen B) deterministically.
 * Absolute ms numbers are illustrative, not calibrated to a real link.
 */
import { EventEmitter } from "node:events";

/** A single recorded `send` on the socket. */
export interface SentRecord {
  /** Monotonic per-socket sequence number (send order). */
  seq: number;
  /** Virtual clock time (ms) at which the frame was enqueued. */
  enqueuedAt: number;
  /** `bufferedAmount` immediately AFTER this frame was added (queue depth incl. self). */
  bytesAtEnqueue: number;
  /** Byte length of this frame. */
  bytes: number;
  /** Best-effort parsed `type` field from the JSON frame, if any. */
  type?: string;
  /** Best-effort parsed `cwd` field from the JSON frame, if any. */
  cwd?: string;
  /** Best-effort parsed `sessionId` field from the JSON frame, if any. */
  sessionId?: string;
}

export interface DrainingWs extends EventEmitter {
  readonly OPEN: number;
  readonly drainRateBytesPerMs: number;
  readyState: number;
  bufferedAmount: number;
  send(frame: string | Buffer): void;
  close(): void;
  /** Advance the virtual clock by `ms`, draining the buffer at the configured rate. */
  advance(ms: number): void;
  /** Advance just enough to drain the buffer to 0 (clears bootstrap/replay frames before a measurement window). */
  drainFully(): void;
  /** Current virtual clock time (ms). */
  now(): number;
  /** The full ordered log of recorded sends. */
  readonly sent: SentRecord[];
  /**
   * Virtual ms from a matching frame's enqueue until the wire clears it.
   * Pure function of the recorded `bytesAtEnqueue` and the drain rate.
   * Returns the value for the FIRST matching record, or `undefined` if none.
   */
  timeToFlush(predicate: (r: SentRecord) => boolean): number | undefined;
  /** All flush times for matching records, in send order. */
  flushTimes(predicate: (r: SentRecord) => boolean): number[];
  /** Sum of byte lengths of recorded sends matching the predicate. */
  bytesWhere(predicate: (r: SentRecord) => boolean): number;
  /** Highest `bufferedAmount` observed across the socket's lifetime. */
  peakBufferedAmount(): number;
}

export interface DrainingWsOpts {
  /** Bytes drained per virtual millisecond. */
  drainRateBytesPerMs: number;
  /** Initial readyState (defaults to OPEN=1). */
  readyState?: number;
}

function byteLength(frame: string | Buffer): number {
  return typeof frame === "string" ? Buffer.byteLength(frame, "utf8") : frame.length;
}

export function createDrainingWs(opts: DrainingWsOpts): DrainingWs {
  const drainRate = opts.drainRateBytesPerMs;
  const sent: SentRecord[] = [];
  let virtualNow = 0;
  let seqCounter = 0;
  let peak = 0;

  const ws = new EventEmitter() as DrainingWs & {
    readyState: number;
    bufferedAmount: number;
  };

  Object.defineProperty(ws, "OPEN", { value: 1, writable: false });
  Object.defineProperty(ws, "drainRateBytesPerMs", { value: drainRate, writable: false });
  ws.readyState = opts.readyState ?? 1;
  ws.bufferedAmount = 0;

  Object.defineProperty(ws, "sent", { get: () => sent });

  ws.send = (frame: string | Buffer) => {
    const bytes = byteLength(frame);
    ws.bufferedAmount += bytes;
    if (ws.bufferedAmount > peak) peak = ws.bufferedAmount;

    // Best-effort parse of envelope metadata. The openspec concat-envelope
    // frame is valid JSON; live `event` frames are valid JSON. Non-JSON or
    // partial frames simply leave the optional fields undefined.
    let type: string | undefined;
    let cwd: string | undefined;
    let sessionId: string | undefined;
    try {
      const parsed = JSON.parse(typeof frame === "string" ? frame : frame.toString("utf8"));
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.type === "string") type = parsed.type;
        if (typeof parsed.cwd === "string") cwd = parsed.cwd;
        if (typeof parsed.sessionId === "string") sessionId = parsed.sessionId;
      }
    } catch {
      // best-effort: leave fields undefined
    }

    sent.push({
      seq: seqCounter++,
      enqueuedAt: virtualNow,
      bytesAtEnqueue: ws.bufferedAmount,
      bytes,
      type,
      cwd,
      sessionId,
    });
  };

  ws.close = () => {
    ws.readyState = 3; // CLOSED
    ws.emit("close");
  };

  ws.advance = (ms: number) => {
    const drained = drainRate * ms;
    ws.bufferedAmount = Math.max(0, ws.bufferedAmount - drained);
    virtualNow += ms;
  };

  ws.now = () => virtualNow;

  ws.drainFully = () => {
    if (ws.bufferedAmount > 0) ws.advance(ws.bufferedAmount / drainRate);
  };

  ws.timeToFlush = (predicate) => {
    const rec = sent.find(predicate);
    if (!rec) return undefined;
    return rec.bytesAtEnqueue / drainRate;
  };

  ws.flushTimes = (predicate) =>
    sent.filter(predicate).map((r) => r.bytesAtEnqueue / drainRate);

  ws.bytesWhere = (predicate) =>
    sent.filter(predicate).reduce((sum, r) => sum + r.bytes, 0);

  ws.peakBufferedAmount = () => peak;

  return ws;
}
