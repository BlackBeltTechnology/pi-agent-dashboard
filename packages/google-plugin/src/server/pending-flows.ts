/**
 * Pending sign-ins that wait for a code delivered by an HTTP callback (own Web client callback, return
 * page remote-callback). The loopback/paste paths do not use this. Each entry is one-shot: a code is
 * accepted once, for a state this dashboard issued, before its deadline (design D12, scenario-gate
 * A10/B4). `state` carries the flow id only (plus, for the return page, the dashboard origin) — never a
 * verifier, nonce, token or email. See change: add-google-connect.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** 300 s flow lifetime (scenario-gate A10, gmail precedent). */
const FLOW_TTL_MS = 300_000;

/** Separator between the flow id and the dashboard origin in a return-page `state`. */
const STATE_ORIGIN_SEP = "~";

export interface DeliveredCode {
  code?: string;
  /** Google's `error` parameter, when the redirect carried one. */
  error?: string;
}

export interface PendingFlow {
  /** The full `state` value Google echoes back. */
  state: string;
  /** Resolves with the delivered result; rejects `timeout` / `aborted`. */
  result: Promise<DeliveredCode>;
  /** Drop the entry (idempotent); rejects the waiter with `aborted`. */
  cancel(): void;
}

type Refusal = { ok: false; status: 400; error: "invalid_state" };

interface Entry {
  state: string;
  resolve: (v: DeliveredCode) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

function flowError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function sameState(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class PendingFlows {
  private readonly entries = new Map<string, Entry>();

  private readonly ttlMs: number;

  constructor(ttlMs = FLOW_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Number of waiting flows (tests). */
  get size(): number {
    return this.entries.size;
  }

  /** New flow id: 32 random bytes, base64url — the CSRF-grade part of `state`. */
  static newId(): string {
    return randomBytes(32).toString("base64url");
  }

  /** `state` for the return-page path: flow id + the dashboard origin the page may continue to. */
  static returnState(id: string, origin: string): string {
    return `${id}${STATE_ORIGIN_SEP}${origin}`;
  }

  create(opts: { id?: string; origin?: string; signal?: AbortSignal }): PendingFlow {
    const id = opts.id ?? PendingFlows.newId();
    const state = opts.origin ? PendingFlows.returnState(id, opts.origin) : id;
    let resolve!: (v: DeliveredCode) => void;
    let reject!: (e: Error) => void;
    const result = new Promise<DeliveredCode>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    result.catch(() => {}); // never an unhandled rejection when nobody awaits
    const drop = () => {
      const e = this.entries.get(id);
      if (e) clearTimeout(e.timer);
      this.entries.delete(id);
    };
    const timer = setTimeout(() => {
      drop();
      reject(flowError("timeout"));
    }, this.ttlMs);
    timer.unref?.();
    this.entries.set(id, { state, resolve, reject, timer });
    const cancel = () => {
      if (!this.entries.has(id)) return;
      drop();
      reject(flowError("aborted"));
    };
    opts.signal?.addEventListener("abort", cancel, { once: true });
    return { state, result, cancel };
  }

  /**
   * Deliver a callback's `code`/`error` for `state`. One-shot: the entry is removed on acceptance, so a
   * second delivery of the same state is refused. Unknown, malformed, expired or mismatched → 400
   * `invalid_state` with no side effect on any waiting flow.
   */
  deliver(state: string, payload: DeliveredCode): { ok: true } | Refusal {
    const refuse: Refusal = { ok: false, status: 400, error: "invalid_state" };
    if (typeof state !== "string" || state.length === 0 || state.length > 2048) return refuse;
    const id = state.split(STATE_ORIGIN_SEP, 1)[0] ?? "";
    const entry = this.entries.get(id);
    if (!entry || !sameState(entry.state, state)) return refuse;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.resolve(payload);
    return { ok: true };
  }
}
