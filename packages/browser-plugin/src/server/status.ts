/**
 * `browser_relay_status` broadcast + the relay gateway handlers (change:
 * add-browser-relay, tasks 2.11 / 3.4 / 3.6; design D6/D7).
 *
 * Three jobs:
 *
 *  1. **Status composition** — turn the manager's live instances + their tab
 *     views into the `browser_relay_status` snapshot the settings rows and the
 *     live-view tiles render.
 *  2. **Change notification** — broadcast on every instance/tab change
 *     IMMEDIATELY (`broadcastNow`, driven by the manager's `onStatusChange`),
 *     and on every audit append COALESCED to ≤1 per 500 ms (`schedule`, driven
 *     by the audit ring's append hook). `auditSeq` is the audit viewer's refetch
 *     signal, so a burst of denials must not become a burst of broadcasts.
 *  3. **Browser→server handlers** — `browser_relay_subscribe|unsubscribe|input`
 *     keyed `{instanceId, tabId}`. Malformed or unknown refs are dropped and
 *     audited; a socket close unsubscribes that socket everywhere.
 *
 * Frames never travel through here: the tap sends per-socket so backpressure
 * can skip ONE viewer (see screencast-tap.ts), which a broadcast cannot do.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type {
  BrowserRelayStatusMessage,
  BrowserRelayTabStatus,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { AuditRing } from "./audit.js";
import type { RelaySocket } from "./relay/extension-socket.js";
import type { RelayLike } from "./relay/relay-manager.js";

/** Audit appends within this window collapse into one status broadcast. */
export const STATUS_COALESCE_MS = 500;

/** The manager surface status needs (narrow for tests; `RelayManager` fits). */
export interface StatusManager {
  instances(): RelayLike[];
  find(instanceId: string): RelayLike | undefined;
}

export interface StatusTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: StatusTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface StatusLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface BrowserRelayStatusDeps {
  manager: StatusManager;
  audit: AuditRing;
  broadcast(msg: BrowserRelayStatusMessage): void;
  logger: StatusLogger;
  timers?: StatusTimers;
  coalesceMs?: number;
}

interface RelayedRef {
  instanceId: string;
  tabId: number;
}

/** `{instanceId: string, tabId: integer}` or null — the only accepted shape. */
function refOf(msg: unknown): RelayedRef | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as { instanceId?: unknown; tabId?: unknown };
  if (typeof m.instanceId !== "string" || m.instanceId.length === 0) return null;
  if (typeof m.tabId !== "number" || !Number.isInteger(m.tabId)) return null;
  return { instanceId: m.instanceId, tabId: m.tabId };
}

/** Best-effort peer address for the denial audit (the `ws` socket). */
function remoteAddressOf(ws: unknown): string | undefined {
  const sock = (ws as { _socket?: { remoteAddress?: string } } | undefined)?._socket;
  return typeof sock?.remoteAddress === "string" ? sock.remoteAddress : undefined;
}

export class BrowserRelayStatus {
  private readonly timers: StatusTimers;
  private readonly coalesceMs: number;
  /** Sockets that already have a close listener — registered at most once. */
  private readonly closeTracked = new WeakSet<object>();
  private timer?: unknown;

  constructor(private readonly deps: BrowserRelayStatusDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
    this.coalesceMs = deps.coalesceMs ?? STATUS_COALESCE_MS;
    // Audit appends are the only change signal the manager/tap do not route
    // through `onStatusChange`; coalesce them here.
    this.deps.audit.setOnAppend(() => this.schedule());
  }

  /** The current full snapshot. */
  message(): BrowserRelayStatusMessage {
    return {
      type: "browser_relay_status",
      instances: this.deps.manager.instances().map((inst) => ({
        instanceId: inst.instanceId,
        profileDirectory: inst.profileDirectory,
        state: inst.statusState(),
        tabs: inst.tabList().map(
          (tab): BrowserRelayTabStatus => ({
            tabId: tab.tabId,
            title: tab.title,
            url: tab.url,
            state: tab.state,
            ...(tab.reason ? { reason: tab.reason } : {}),
          }),
        ),
      })),
      auditSeq: this.deps.audit.auditSeq,
    };
  }

  /** Immediate broadcast for an instance/tab change. Cancels a pending coalesced emit. */
  broadcastNow(): void {
    this._clearTimer();
    this.deps.broadcast(this.message());
  }

  /** Coalesced broadcast for an audit append: at most one per `coalesceMs`. */
  schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.deps.broadcast(this.message());
    }, this.coalesceMs);
  }

  /** Register the three relay gateway handlers on `ctx`. */
  registerHandlers(ctx: ServerPluginContext): void {
    ctx.registerBrowserHandler("browser_relay_subscribe", (msg, ws) =>
      this._onSubscribe(msg, ws as RelaySocket),
    );
    ctx.registerBrowserHandler("browser_relay_unsubscribe", (msg, ws) =>
      this._onUnsubscribe(msg, ws as RelaySocket),
    );
    ctx.registerBrowserHandler("browser_relay_input", (msg, ws) => {
      void this._onInput(msg, ws as RelaySocket);
    });
  }

  /** Drop the audit hook + any pending timer (plugin disable). */
  dispose(): void {
    this._clearTimer();
    this.deps.audit.setOnAppend(undefined);
  }

  private _onSubscribe(msg: unknown, ws: RelaySocket): void {
    const ref = refOf(msg);
    const inst = ref ? this.deps.manager.find(ref.instanceId) : undefined;
    if (!ref || !inst) {
      this._deny(msg, "browser_relay_subscribe");
      return;
    }
    this._trackClose(ws);
    inst.subscribe(ws, ref.tabId);
  }

  private _onUnsubscribe(msg: unknown, ws: RelaySocket): void {
    const ref = refOf(msg);
    const inst = ref ? this.deps.manager.find(ref.instanceId) : undefined;
    if (!ref || !inst) {
      this._deny(msg, "browser_relay_unsubscribe");
      return;
    }
    inst.unsubscribe(ws, ref.tabId);
  }

  private async _onInput(msg: unknown, ws: RelaySocket): Promise<void> {
    const ref = refOf(msg);
    const inst = ref ? this.deps.manager.find(ref.instanceId) : undefined;
    if (!ref || !inst) {
      this._deny(msg, "browser_relay_input");
      return;
    }
    this._trackClose(ws);
    await inst.input(ws, ref.tabId, msg, remoteAddressOf(ws));
  }

  /**
   * A socket close is an unsubscribe from EVERY instance the socket may have
   * subscribed to — the socket carries no instance id, so it cannot be narrowed.
   */
  private _trackClose(ws: RelaySocket): void {
    const key = ws as unknown as object;
    if (this.closeTracked.has(key)) return;
    this.closeTracked.add(key);
    ws.on("close", (() => {
      for (const inst of this.deps.manager.instances()) inst.unsubscribeAll(ws);
    }) as never);
  }

  /** A refused viewer message: audited with the message type (never the payload). */
  private _deny(msg: unknown, detail: string): void {
    const instanceId = (msg as { instanceId?: unknown } | null)?.instanceId;
    this.deps.audit.append({
      profileDirectory: "unknown",
      instanceId: typeof instanceId === "string" ? instanceId : "unknown",
      kind: "denied",
      detail,
    });
    this.deps.logger.warn(`[browser-relay] viewer message refused detail=${detail}`);
  }

  private _clearTimer(): void {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
