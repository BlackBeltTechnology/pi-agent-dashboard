/**
 * Lifecycle outbox of the lead host (design D3, task 5.6/5.14): `requestPluginServer` never retries and resolves
 * `{ok:false}` on a transport failure, so every lifecycle report (`started`, `idle` with `finalText`/`error`/`aborted`,
 * `gone`, `state`) is kept here, keyed by `(member, run, kind)`, until the server answers `{ok:true}`. Reports flush IN ORDER;
 * a transport failure stops the flush and keeps the head; an APPLICATION error (the server answered but refused) is retried
 * {@link MAX_REPORT_TRIES} times and then dead-lettered so it can never block the reports behind it (head-of-line).
 * Bounds (decision B94): 1 000 entries / 8 MiB, oldest first; a non-settle report goes first, an `idle` that carries
 * `finalText` only when nothing else is left.
 * See change: add-agent-teams-in-process.
 */
import type { InProcEvent } from "../shared/inproc-protocol.js";

export const OUTBOX_MAX_ENTRIES = 1000;
export const OUTBOX_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_TRIES = 3;

/** The answer to one report request: accepted, or failed in transport (retry later) / refused by the server (application error). */
export type ReportResult = { ok: true } | { ok: false; transport: boolean; error?: string };

interface Entry {
  key: string;
  report: InProcEvent;
  bytes: number;
}

export interface OutboxDeps {
  send(report: InProcEvent): Promise<ReportResult>;
  /** An entry was evicted by the size bounds. */
  onOverflow(report: InProcEvent): void;
  /** An application-error report was dropped after {@link MAX_REPORT_TRIES} tries. */
  onDeadLetter(report: InProcEvent, error: string | undefined): void;
  maxEntries?: number;
  maxBytes?: number;
}

export interface Outbox {
  /** Queue a report (a repeat of the same `(member, run, kind)` replaces the queued copy in place). */
  push(report: InProcEvent): void;
  /** Send queued reports in order until the queue is empty or a transport failure; overlapping calls join the running flush. */
  flush(): Promise<void>;
  /** The newest queued `idle` report of `member` (its unacknowledged settle). */
  unackedSettle(member: string): InProcEvent | undefined;
  /** Drop everything queued for `member` (a respawn starts clean). */
  forget(member: string): void;
  readonly size: number;
  readonly bytes: number;
  /** Queued reports, oldest first (read-only copy). */
  entries(): InProcEvent[];
}

const keyOf = (r: InProcEvent): string => `${r.member}\u0000${r.run}\u0000${r.kind}`;
const sizeOf = (r: InProcEvent): number => 120 + r.member.length + (r.finalText?.length ?? 0) + (r.error?.length ?? 0) + (r.reason?.length ?? 0);
const isSettleWithText = (r: InProcEvent): boolean => r.kind === "idle" && r.finalText !== undefined && r.finalText !== "";

export function createOutbox(deps: OutboxDeps): Outbox {
  const maxEntries = deps.maxEntries ?? OUTBOX_MAX_ENTRIES;
  const maxBytes = deps.maxBytes ?? OUTBOX_MAX_BYTES;
  const queue: Entry[] = [];
  let bytes = 0;
  let flushing: Promise<void> | undefined;
  /** A report was queued while a flush ran: it loops once more instead of stranding the new entry. */
  let dirty = false;

  function evictOne(): void {
    // Oldest non-settle first; an `idle` with finalText only when nothing else is left.
    let i = queue.findIndex((e) => !isSettleWithText(e.report));
    if (i < 0) i = 0;
    const [gone] = queue.splice(i, 1) as [Entry];
    bytes -= gone.bytes;
    deps.onOverflow(gone.report);
  }

  function push(report: InProcEvent): void {
    dirty = true;
    const key = keyOf(report);
    const entry: Entry = { key, report, bytes: sizeOf(report) };
    const same = queue.findIndex((e) => e.key === key);
    if (same >= 0) {
      bytes += entry.bytes - (queue[same] as Entry).bytes;
      queue[same] = entry;
    } else {
      queue.push(entry);
      bytes += entry.bytes;
    }
    while (queue.length > maxEntries || bytes > maxBytes) evictOne();
  }

  /** One report with up to {@link MAX_REPORT_TRIES} tries: a transport failure or an accepted report ends it at once. */
  async function sendWithRetries(report: InProcEvent): Promise<ReportResult> {
    let result: ReportResult = { ok: false, transport: true };
    for (let attempt = 1; attempt <= MAX_REPORT_TRIES; attempt++) {
      try {
        result = await deps.send(report);
      } catch {
        result = { ok: false, transport: true };
      }
      if (result.ok || result.transport) break;
    }
    return result;
  }

  /** Returns true when a transport failure stopped the flush. */
  async function drain(): Promise<boolean> {
    while (queue.length > 0) {
      const head = queue[0] as Entry;
      const result = await sendWithRetries(head.report);
      if (!result.ok && result.transport) return true; // keep the head, flush again after the next hello
      const at = queue.indexOf(head);
      if (at >= 0) {
        queue.splice(at, 1);
        bytes -= head.bytes;
      }
      if (!result.ok) deps.onDeadLetter(head.report, result.error);
    }
    return false;
  }

  async function run(): Promise<void> {
    for (;;) {
      dirty = false;
      if ((await drain()) || !dirty) return;
    }
  }

  return {
    push,
    flush() {
      if (!flushing) {
        flushing = run().finally(() => {
          flushing = undefined;
        });
      }
      return flushing;
    },
    unackedSettle(member) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const r = (queue[i] as Entry).report;
        if (r.member === member && r.kind === "idle") return r;
      }
      return undefined;
    },
    forget(member) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue[i] as Entry;
        if (e.report.member !== member) continue;
        queue.splice(i, 1);
        bytes -= e.bytes;
      }
    },
    get size() {
      return queue.length;
    },
    get bytes() {
      return bytes;
    },
    entries: () => queue.map((e) => e.report),
  };
}
