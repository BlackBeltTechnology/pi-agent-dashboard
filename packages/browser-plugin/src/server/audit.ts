/**
 * Per-relay audit ring (change: add-browser-relay, task 2.6 / spec
 * `browser-relay` "Audit trail").
 *
 * Holds the last `capacity` entries in memory for the process lifetime — the
 * audit is a live diagnostic surface (`GET /api/browser/audit`), not durable
 * history. Two invariants the spec pins:
 *
 *  1. `detail` carries URLs and METHOD NAMES only. Never a request/response
 *     payload, never the relay guid, never a profile token. That is enforced
 *     by typing `detail` as a string and by `instanceId` being a separate,
 *     non-secret public id (the guid is never handed to the ring at all).
 *  2. `auditSeq` is strictly monotonic across appends (it is a counter, NOT
 *     `entries.length`), because the client uses "did auditSeq change?" as its
 *     refetch signal — a seq that wrapped or repeated on ring rollover would
 *     silently stop the audit viewer updating.
 */

/** Kinds the spec enumerates. A caller may not invent its own. */
type AuditKind =
  | "attach"
  | "detach"
  | "navigate"
  | "createTarget"
  | "denied"
  | "viewer-subscribe"
  | "viewer-input";

export interface AuditEntry {
  /** Epoch ms. */
  ts: number;
  /** Stable Chrome profile key (never the user-editable label). */
  profileDirectory: string;
  /** Public, non-secret instance address (never the guid). */
  instanceId: string;
  kind: AuditKind;
  /** URL / CDP method name / input kind — a plain string, never a payload. */
  detail: string;
}

export interface AuditAppend {
  profileDirectory: string;
  instanceId: string;
  kind: AuditKind;
  detail: string;
}

export const AUDIT_CAPACITY = 500;

export class AuditRing {
  private entries: AuditEntry[] = [];
  private seq = 0;
  private onAppend?: (entry: AuditEntry) => void;

  constructor(
    private readonly capacity: number = AUDIT_CAPACITY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Observe every append (the status broadcaster coalesces its refresh off
   * this). One listener; `undefined` clears it. An observer must never break
   * an append, so its throw is swallowed.
   */
  setOnAppend(listener: ((entry: AuditEntry) => void) | undefined): void {
    this.onAppend = listener;
  }

  /** Monotonic append counter — the client's audit-refresh signal. */
  get auditSeq(): number {
    return this.seq;
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Append one entry and return it. Drops the OLDEST entry once the ring is
   * full, so the newest `capacity` entries are always the ones served.
   */
  append(input: AuditAppend): AuditEntry {
    const entry: AuditEntry = {
      ts: this.now(),
      profileDirectory: input.profileDirectory,
      instanceId: input.instanceId,
      kind: input.kind,
      // Coerce: a caller passing a non-string (a payload object, most likely)
      // must never leak it into the audit — a URL/method is all that is allowed.
      detail: typeof input.detail === "string" ? input.detail : String(input.detail),
    };
    this.entries.push(entry);
    this.seq += 1;
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    try {
      this.onAppend?.(entry);
    } catch {
      /* an observer must not break an append */
    }
    return entry;
  }

  /**
   * Entries NEWEST-FIRST (spec "Audit read"). `profileDirectory` narrows to
   * one profile; omitted → every profile.
   */
  list(profileDirectory?: string): AuditEntry[] {
    const wanted =
      profileDirectory === undefined
        ? this.entries
        : this.entries.filter((e) => e.profileDirectory === profileDirectory);
    return [...wanted].reverse();
  }

  /** Drop every entry (tests / kill-switch reset). Leaves `auditSeq` monotonic. */
  clear(): void {
    this.entries = [];
  }
}
