/**
 * Screencast tap (change: add-browser-relay, spec `browser-relay` "Screencast
 * tap for dashboard viewers", design D5/D6).
 *
 * One tap per `(instance, tabId)` with at least one viewer. The tap is an
 * in-process listener on the relay's CDP event stream, NOT a second
 * `chrome.debugger` session — the extension allows exactly ONE debugger session
 * per tab, so a second one is impossible. Consequences the design owns:
 *
 *  - Frames are **filtered out of the CDP-client stream** for tapped sessions
 *    and delivered per-viewer-socket instead. Playwright's `CRPage` would
 *    otherwise ack and interleave with the tap.
 *  - A CDP client that already started its OWN screencast on a tab wins: the
 *    subscribe is REFUSED with state `client-screencast-active` rather than
 *    silently overriding the client's parameters (quality/size are its).
 *  - Frames are sent **per socket**, which is what makes per-viewer
 *    backpressure possible (`bufferedAmount` is a socket property). A global
 *    broadcast has no way to skip one slow viewer.
 *
 * `Page.screencastFrame` only fires on REPAINT. A hidden tab and a visible idle
 * tab both produce zero frames, so the state is `no-frames` (never `error`) and
 * the tile wording stays neutral.
 */
import type { BrowserRelayFrameMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { AuditRing } from "../audit.js";
import type { RelaySocket } from "./extension-socket.js";
import { buildViewerInputCommands, type FrameGeometry } from "./viewer-input.js";

export type TapTabState = "live" | "no-frames" | "client-screencast-active";

/** Frames are ~4 KB; 512 KiB of queued bytes is ~2 minutes of frame time. */
export const BACKPRESSURE_BYTES = 512 * 1024;

/** No repaint for this long → `no-frames` (idle OR hidden; see module doc). */
export const NO_FRAMES_MS = 2000;

export interface TapTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: TapTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TapLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface ScreencastTapDeps {
  profileDirectory: string;
  instanceId: string;
  audit: AuditRing;
  logger: TapLogger;
  /** Relay `pw-tab-N` sessionId for a Chrome tabId, or undefined when detached. */
  sessionIdForTab(tabId: number): string | undefined;
  /** Send one CDP command into a tab's session and await its result. */
  sendToTab(sessionId: string, method: string, params: unknown): Promise<unknown>;
  /** True when the CDP client already runs its own screencast on this tab. */
  clientScreencastActive(tabId: number): boolean;
  /** Fired on any state/viewer change so the host can rebroadcast status. */
  onStatusChange(): void;
  timers?: TapTimers;
  noFramesMs?: number;
  backpressureBytes?: number;
}

interface View {
  tabId: number;
  viewers: Set<RelaySocket>;
  geometry?: FrameGeometry;
  state: TapTabState;
  noFramesTimer?: unknown;
  /** Frames skipped per viewer while it was over the backpressure threshold. */
  skipped: Map<RelaySocket, number>;
}

export type SubscribeResult =
  | { ok: true }
  /** `detached` = no relay session for that tab (closed / DevTools took it). */
  | { ok: false; state: TapTabState | "detached"; reason: string };

/** The `Page.screencastFrame` shape the extension sends. */
interface ScreencastFrameParams {
  data?: unknown;
  sessionId?: unknown;
  metadata?: { deviceWidth?: unknown; deviceHeight?: unknown; timestamp?: unknown };
}

export class ScreencastTap {
  private readonly views = new Map<number, View>();
  private readonly timers: TapTimers;
  private readonly noFramesMs: number;
  private readonly backpressureBytes: number;
  /** Sessions we own a screencast on — the filter predicate for the client stream. */
  private readonly tappedSessions = new Set<string>();

  constructor(private readonly deps: ScreencastTapDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
    this.noFramesMs = deps.noFramesMs ?? NO_FRAMES_MS;
    this.backpressureBytes = deps.backpressureBytes ?? BACKPRESSURE_BYTES;
  }

  /** Tab ids a viewer may subscribe to right now. */
  get tabIds(): number[] {
    return [...this.views.keys()];
  }

  /** Current state per tapped tab (for `browser_relay_status`). */
  tabStates(): Map<number, TapTabState> {
    const out = new Map<number, TapTabState>();
    for (const [tabId, view] of this.views) out.set(tabId, view.state);
    return out;
  }

  /** Frames skipped for a viewer on a tab (status detail / tests). */
  skippedFor(tabId: number, viewer: RelaySocket): number {
    return this.views.get(tabId)?.skipped.get(viewer) ?? 0;
  }

  /** True when this sessionId is tapped (its frames must not reach the client). */
  handlesSession(sessionId: string | undefined): boolean {
    return sessionId !== undefined && this.tappedSessions.has(sessionId);
  }

  subscribe(viewer: RelaySocket, tabId: number): SubscribeResult {
    if (this.deps.clientScreencastActive(tabId)) {
      // The agent owns this tab's screencast; leave its parameters untouched.
      return { ok: false, state: "client-screencast-active", reason: "client-screencast-active" };
    }
    const sessionId = this.deps.sessionIdForTab(tabId);
    if (!sessionId) return { ok: false, state: "detached", reason: "no-session" };

    let view = this.views.get(tabId);
    const isNewTap = !view;
    if (!view) {
      view = { tabId, viewers: new Set(), state: "no-frames", skipped: new Map() };
      this.views.set(tabId, view);
      this.tappedSessions.add(sessionId);
    }
    view.viewers.add(viewer);
    this.deps.audit.append({
      profileDirectory: this.deps.profileDirectory,
      instanceId: this.deps.instanceId,
      kind: "viewer-subscribe",
      detail: `tab:${tabId}`,
    });
    if (isNewTap) this._startScreencast(sessionId, tabId);
    this._armNoFrames(view);
    this.deps.onStatusChange();
    return { ok: true };
  }

  private _startScreencast(sessionId: string, tabId: number): void {
    void this.deps
      .sendToTab(sessionId, "Page.startScreencast", {
        format: "jpeg",
        quality: 50,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      })
      .catch((err: unknown) =>
        this.deps.logger.warn(`[browser-relay] startScreencast failed tab=${tabId}`, err),
      );
  }

  unsubscribe(viewer: RelaySocket, tabId: number): void {
    const view = this.views.get(tabId);
    if (!view) return;
    view.viewers.delete(viewer);
    view.skipped.delete(viewer);
    if (view.viewers.size > 0) {
      this.deps.onStatusChange();
      return;
    }
    this._stopView(view);
    this.deps.onStatusChange();
  }

  /** Remove a socket from every tab (socket close = unsubscribe everywhere). */
  unsubscribeAll(viewer: RelaySocket): void {
    for (const tabId of [...this.views.keys()]) this.unsubscribe(viewer, tabId);
  }

  /**
   * Consume one CDP event. Returns true when the tap handled it (so the host
   * must NOT forward it to the CDP client).
   */
  onEvent(sessionId: string | undefined, method: string, params: unknown): boolean {
    if (method !== "Page.screencastFrame" || !this.handlesSession(sessionId)) return false;
    const view = [...this.views.values()].find((v) => this.deps.sessionIdForTab(v.tabId) === sessionId);
    if (!view) return false;

    const p = (params ?? {}) as ScreencastFrameParams;
    this._ackFrame(sessionId as string, p);

    const deviceWidth = typeof p.metadata?.deviceWidth === "number" ? p.metadata.deviceWidth : 0;
    const deviceHeight = typeof p.metadata?.deviceHeight === "number" ? p.metadata.deviceHeight : 0;
    const timestamp = typeof p.metadata?.timestamp === "number" ? p.metadata.timestamp : Date.now();
    if (deviceWidth > 0 && deviceHeight > 0) view.geometry = { deviceWidth, deviceHeight };

    const resumed = view.state === "no-frames";
    view.state = "live";
    this._armNoFrames(view);
    this._fanOut(view, {
      type: "browser_relay_frame",
      instanceId: this.deps.instanceId,
      tabId: view.tabId,
      jpegBase64: typeof p.data === "string" ? p.data : "",
      metadata: { deviceWidth, deviceHeight, timestamp },
    });
    if (resumed) this.deps.onStatusChange();
    return true;
  }

  /**
   * Ack IMMEDIATELY and unconditionally: the extension throttles frames until
   * acked, so a slow viewer must never delay the ack (D6).
   */
  private _ackFrame(sessionId: string, p: ScreencastFrameParams): void {
    void this.deps
      .sendToTab(sessionId, "Page.screencastFrameAck", { sessionId: p.sessionId })
      .catch((err: unknown) => this.deps.logger.warn("[browser-relay] screencastFrameAck failed", err));
  }

  /** Send one frame to each viewer of a tab, skipping any over the threshold. */
  private _fanOut(view: View, frame: BrowserRelayFrameMessage): void {
    const payload = JSON.stringify(frame);
    for (const viewer of view.viewers) {
      if ((viewer.bufferedAmount ?? 0) > this.backpressureBytes) {
        view.skipped.set(viewer, (view.skipped.get(viewer) ?? 0) + 1);
        continue;
      }
      try {
        viewer.send(payload);
      } catch (err) {
        this.deps.logger.warn("[browser-relay] frame send failed", err);
      }
    }
  }

  /**
   * Apply one viewer input message. Validation is pure (`buildViewerInputCommands`);
   * a refusal is audited with the input KIND (never the payload) so a probing
   * viewer is visible in the audit trail.
   */
  async input(viewer: RelaySocket, tabId: number, msg: unknown, remoteAddress?: string): Promise<void> {
    const view = this.views.get(tabId);
    if (!view?.viewers.has(viewer)) return;
    const sessionId = this.deps.sessionIdForTab(tabId);

    const raw = (msg ?? {}) as { kind?: unknown };
    const built = buildViewerInputCommands(raw as never, view.geometry);
    if (!built.ok || !sessionId) {
      const kind = typeof raw.kind === "string" ? raw.kind : "unknown";
      this.deps.audit.append({
        profileDirectory: this.deps.profileDirectory,
        instanceId: this.deps.instanceId,
        kind: "denied",
        detail: kind,
      });
      this.deps.logger.warn(
        `[browser-relay] viewer input refused tab=${tabId} kind=${kind} peer=${remoteAddress ?? "?"}`,
      );
      return;
    }

    this.deps.audit.append({
      profileDirectory: this.deps.profileDirectory,
      instanceId: this.deps.instanceId,
      kind: "viewer-input",
      detail: typeof raw.kind === "string" ? raw.kind : "unknown",
    });
    for (const command of built.commands) {
      try {
        await this.deps.sendToTab(sessionId, command.method, command.params);
      } catch (err) {
        this.deps.logger.warn(`[browser-relay] viewer input command failed method=${command.method}`, err);
      }
    }
  }

  /** Mark a tab detached (DevTools) — refusal state until it is re-subscribed. */
  markDetached(tabId: number): void {
    const view = this.views.get(tabId);
    if (view) view.state = "client-screencast-active";
  }

  /** Stop every screencast and drop every viewer (instance close / kill switch). */
  closeAll(): void {
    for (const view of [...this.views.values()]) this._stopView(view);
  }

  private _stopView(view: View): void {
    if (view.noFramesTimer !== undefined) {
      this.timers.clearTimeout(view.noFramesTimer);
      view.noFramesTimer = undefined;
    }
    const sessionId = this.deps.sessionIdForTab(view.tabId);
    if (sessionId) {
      this.tappedSessions.delete(sessionId);
      void this.deps
        .sendToTab(sessionId, "Page.stopScreencast", {})
        .catch((err: unknown) => this.deps.logger.warn("[browser-relay] stopScreencast failed", err));
    }
    this.views.delete(view.tabId);
  }

  private _armNoFrames(view: View): void {
    if (view.noFramesTimer !== undefined) this.timers.clearTimeout(view.noFramesTimer);
    view.noFramesTimer = this.timers.setTimeout(() => {
      view.noFramesTimer = undefined;
      if (view.state === "no-frames") return;
      view.state = "no-frames";
      this.deps.onStatusChange();
    }, this.noFramesMs);
  }
}
