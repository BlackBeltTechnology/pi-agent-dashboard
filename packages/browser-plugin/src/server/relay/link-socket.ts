/**
 * `LinkSocket` — a `RelaySocket` over the operator carrier (change:
 * add-operator-browser-relay, task 7.2; design D5).
 *
 * The vendored relay, the deny-list, the screencast tap and the audit are
 * unchanged: an operator instance's extension socket is simply this object.
 *
 *  - `send(data)`  → `browser_host_relay_data {linkId, data}` to the carrier;
 *  - `close(...)`  → `browser_host_relay_close {linkId, code, reason}`;
 *  - `bufferedAmount` = the carrier's;
 *  - `on("message"|"close")` is fed by `feed()` / `remoteClose()` (inbound
 *    `browser_host_ext_data` / `ext_close`) and by the carrier's own close.
 *
 * LIMITS (fail loud — extension traffic cannot be skipped like viewer frames):
 *  - one `data` > 16 MiB → close 1009;
 *  - carrier `bufferedAmount` > 32 MiB for 10 s → close 1013 `carrier-congested`.
 *    Every link on the carrier polls the same value, so all of them close.
 *
 * The `linkId` is the only on-wire address; the guid never reaches this file.
 */
import type { RelaySocket } from "./extension-socket.js";
import { WS_OPEN } from "./extension-socket.js";
import type { RelayTimers } from "./relay-instance.js";

/** Largest accepted single `browser_host_ext_data` payload (string length). */
export const LINK_MAX_DATA = 16 * 1024 * 1024;
export const CARRIER_CONGESTED_BYTES = 32 * 1024 * 1024;
export const CARRIER_CONGESTED_MS = 10_000;
const POLL_MS = 500;
const WS_CLOSED = 3;

const REAL_TIMERS: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Listener = (...args: never[]) => void;

export interface LinkSocketDeps {
  linkId: string;
  carrier: RelaySocket;
  timers?: RelayTimers;
}

export class LinkSocket implements RelaySocket {
  private readonly linkId: string;
  private readonly carrier: RelaySocket;
  private readonly timers: RelayTimers;
  private readonly listeners = new Map<string, Listener[]>();
  private closed = false;
  private congestedSince?: number;
  private pollTimer?: unknown;
  private readonly onCarrierClose = (): void => this._shutdown(1006, "host-gone");

  constructor(deps: LinkSocketDeps) {
    this.linkId = deps.linkId;
    this.carrier = deps.carrier;
    this.timers = deps.timers ?? REAL_TIMERS;
    // Carrier gone ⇒ the link is gone (no relay_close can be delivered).
    this.carrier.on("close", this.onCarrierClose as never);
    // Sample once now so the 10 s window starts at link creation when the
    // carrier is already congested (polling alone would start it up to one
    // poll interval late).
    if (this.bufferedAmount > CARRIER_CONGESTED_BYTES) this.congestedSince = Date.now();
    this._schedulePoll();
  }

  get readyState(): number {
    if (this.closed) return WS_CLOSED;
    return this.carrier.readyState === WS_OPEN ? WS_OPEN : WS_CLOSED;
  }

  get bufferedAmount(): number {
    return this.carrier.bufferedAmount ?? 0;
  }

  send(data: string): void {
    this._toCarrier({ type: "browser_host_relay_data", linkId: this.linkId, data });
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this._toCarrier({ type: "browser_host_relay_close", linkId: this.linkId, code, reason });
    this._shutdown(code, reason);
  }

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  /** Inbound `browser_host_ext_data`: deliver as one extension frame (≤ 16 MiB). */
  feed(data: string): void {
    if (this.closed) return;
    if (data.length > LINK_MAX_DATA) {
      this.close(1009, "message-too-big");
      return;
    }
    this._emit("message", data);
  }

  /** Inbound `browser_host_ext_close`: the extension socket ended on the host. */
  remoteClose(code: number): void {
    this._shutdown(code, "");
  }

  private _toCarrier(msg: Record<string, unknown>): void {
    if (this.carrier.readyState !== WS_OPEN) return;
    try {
      this.carrier.send(JSON.stringify(msg));
    } catch {
      /* carrier died mid-send: its close handler finishes the teardown */
    }
  }

  private _emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }

  private _shutdown(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    // The carrier (SPA /ws) outlives every link: drop our listener or each
    // connect leaks one closure (and the dead link behind it).
    this.carrier.off?.("close", this.onCarrierClose as never);
    if (this.pollTimer !== undefined) {
      this.timers.clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this._emit("close", code, reason);
  }

  /** Poll the carrier's buffered amount; > 32 MiB for 10 s fails every link loud. */
  private _schedulePoll(): void {
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = undefined;
      if (this.closed) return;
      const now = Date.now();
      if (this.bufferedAmount > CARRIER_CONGESTED_BYTES) {
        this.congestedSince ??= now;
        if (now - this.congestedSince >= CARRIER_CONGESTED_MS) {
          this.close(1013, "carrier-congested");
          return;
        }
      } else {
        this.congestedSince = undefined;
      }
      this._schedulePoll();
    }, POLL_MS);
  }
}
