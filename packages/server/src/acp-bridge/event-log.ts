/**
 * Durable per-session event log (host B): every forwarded `DashboardEvent` is
 * appended as one JSON line so a reconnecting adapter can replay the session.
 *
 * - Appends are async + batched (never block the stdout pipeline).
 * - Capped at `maxBytes`: on reaching it the OLDEST whole turns are dropped until
 *   the log is ≤ 50 % of the cap and a single notice entry leads the file. A turn
 *   unit ends at an `agent_settled` event, so replay never starts mid-message.
 * - Replay streams line-by-line (bounded memory at the 64 MiB default cap).
 *
 * See change: add-acp-session-driver (D11, "Reattach after dashboard restart").
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const LOG_NOTICE_TYPE = "acp-notice";
const FLUSH_DELAY_MS = 20;

export interface EventLog {
  append(event: DashboardEvent): void;
  /** Resolves once everything appended so far is on disk (and any truncation done). */
  flush(): Promise<void>;
  /**
   * Stream stored events, oldest first (notice first when truncated). `maxBytes`
   * bounds the read to a prior `size()` snapshot so events appended during the
   * replay are not delivered twice.
   */
  replay(emit: (event: DashboardEvent) => void, maxBytes?: number): Promise<void>;
  /** Approximate current size in bytes (disk + pending). */
  size(): number;
}

interface Notice {
  event: DashboardEvent;
  dropped: number;
}

function noticeEvent(dropped: number, now: number): DashboardEvent {
  return {
    eventType: "custom_entry",
    timestamp: now,
    data: {
      customType: LOG_NOTICE_TYPE,
      data: `Earlier history was truncated to stay within the event-log size cap (${dropped} turn${dropped === 1 ? "" : "s"} dropped).`,
      acpDroppedTurns: dropped,
    },
  };
}

const parseLine = (line: string): DashboardEvent | undefined => {
  try {
    const v = JSON.parse(line) as DashboardEvent;
    return typeof v?.eventType === "string" ? v : undefined;
  } catch {
    return undefined;
  }
};

const isNotice = (e: DashboardEvent | undefined): boolean =>
  e?.eventType === "custom_entry" && (e.data as { customType?: unknown })?.customType === LOG_NOTICE_TYPE;

export function createEventLog(opts: { file: string; maxBytes: number; now?: () => number }): EventLog {
  const now = opts.now ?? Date.now;
  let onDisk = 0;
  let queue: string[] = [];
  let queuedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let ready: Promise<void> | undefined;

  const init = (): Promise<void> => {
    ready ??= fsp
      .mkdir(path.dirname(opts.file), { recursive: true, mode: 0o700 })
      .then(() => fsp.stat(opts.file))
      .then((st) => {
        onDisk = st.size;
      })
      .catch(() => {
        onDisk = 0;
      });
    return ready;
  };

  /** Stream the file once: byte offset after every `agent_settled` + a leading notice. */
  async function scan(): Promise<{ unitEnds: number[]; notice?: Notice; total: number }> {
    const unitEnds: number[] = [];
    let offset = 0;
    let notice: Notice | undefined;
    let first = true;
    const rl = readline.createInterface({ input: fs.createReadStream(opts.file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      offset += Buffer.byteLength(line) + 1;
      const ev = parseLine(line);
      if (first) {
        first = false;
        if (isNotice(ev)) {
          const dropped = Number((ev as DashboardEvent).data.acpDroppedTurns ?? 0);
          notice = { event: ev as DashboardEvent, dropped };
          unitEnds.push(offset); // the notice itself is never a droppable unit
          continue;
        }
      }
      if (ev?.eventType === "agent_settled") unitEnds.push(offset);
    }
    return { unitEnds, notice, total: offset };
  }

  async function truncate(): Promise<void> {
    const { unitEnds, notice, total } = await scan();
    const target = Math.floor(opts.maxBytes * 0.5);
    const base = notice ? 1 : 0; // first entry is the notice's end offset
    const cuttable = unitEnds.slice(base);
    let cut = notice ? (unitEnds[0] ?? 0) : 0;
    let droppedNow = 0;
    for (const end of cuttable) {
      if (total - cut <= target) break;
      cut = end;
      droppedNow += 1;
    }
    if (droppedNow === 0) return;
    const header = `${JSON.stringify(noticeEvent((notice?.dropped ?? 0) + droppedNow, now()))}\n`;
    const tmp = `${opts.file}.tmp`;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      out.on("error", reject);
      out.on("finish", resolve);
      out.write(header);
      fs.createReadStream(opts.file, { start: cut })
        .on("error", reject)
        .pipe(out);
    });
    await fsp.rename(tmp, opts.file);
    onDisk = (await fsp.stat(opts.file)).size;
  }

  async function write(batch: string, bytes: number): Promise<void> {
    await init();
    await fsp.appendFile(opts.file, batch, { mode: 0o600 });
    onDisk += bytes;
    if (onDisk > opts.maxBytes) await truncate();
  }

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      drain();
    }, FLUSH_DELAY_MS);
    timer.unref?.();
  }

  function drain(): void {
    if (queue.length === 0) return;
    const batch = queue.join("");
    const bytes = queuedBytes;
    queue = [];
    queuedBytes = 0;
    chain = chain.then(() => write(batch, bytes)).catch(() => {});
  }

  return {
    append(event) {
      const line = `${JSON.stringify(event)}\n`;
      queue.push(line);
      queuedBytes += Buffer.byteLength(line);
      schedule();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      drain();
      await chain;
    },
    async replay(emit, maxBytes) {
      await this.flush();
      if (!fs.existsSync(opts.file)) return;
      const input = fs.createReadStream(opts.file, {
        encoding: "utf8",
        ...(maxBytes !== undefined ? { end: Math.max(0, maxBytes - 1) } : {}),
      });
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of rl) {
        const ev = parseLine(line);
        if (ev) emit(ev);
      }
    },
    size: () => onDisk + queuedBytes,
  };
}
