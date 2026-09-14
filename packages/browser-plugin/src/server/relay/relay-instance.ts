/**
 * One relay instance = one guid = one extension socket + (at most) one CDP
 * client (change: add-browser-relay, design D2/D3/D5).
 *
 * WHAT IT WRAPS, AND WHY IT DOES NOT USE `CDPRelayServer`
 * ─────────────────────────────────────────────────────
 * Upstream's `CDPRelayServer` is one-extension/one-CDP-client per instance AND
 * owns its own `http.Server` + `ws` listener. The relay cannot use that listener:
 * instances receive sockets the CORE upgrade gate already admitted (pinned
 * origin, genuinely-local peer, no forwarding headers — see plugin-ws-route),
 * and opening a second listener would bypass every one of those gates. Its
 * constructor is inert (`start()` is what listens, and the vendored `WSServer`
 * shim throws), so the design's fallback applies: construct the vendored LOGIC
 * classes directly — `ExtensionProtocolV2` (which owns `BrowserModel`) — and
 * supply the transport. `ExtensionSocket` is that transport; the deny-list,
 * tap, audit and lifecycle live here. The vendored files stay byte-identical,
 * which is what keeps an upstream refresh a re-copy.
 *
 * The tab↔session map is the ONE place this file reads a vendored private
 * (`BrowserModel._tabSessions`). It is unavoidable: the model invents the
 * `pw-tab-N` relay session ids internally and exposes no public
 * tabId→sessionId accessor, yet the tap must address a tab by Chrome tab id.
 * The vendor hash test pins the file contents, and a unit test pins this
 * mapping, so a future upstream refresh fails loudly here instead of silently.
 */
import type { AuditRing } from "../audit.js";
import { deniedMethod, denyError } from "./deny-list.js";
import {
  ExtensionSocket,
  type RelaySocket,
  WS_OPEN,
} from "./extension-socket.js";
import { ScreencastTap, type TapTabState } from "./screencast-tap.js";
import type { CDPMessage, SendToCDPClient } from "./vendor/playwright-core/src/tools/mcp/browserModel.js";
import { ExtensionProtocolV2 } from "./vendor/playwright-core/src/tools/mcp/cdpRelayV2.js";

/** `chrome.debugger.onDetach` reason when the user opened DevTools. */
const DEVTOOLS_DETACH_REASON = "canceled_by_user";

/** No CDP client after the handshake — the agent crashed or is on another host. */
const DEFAULT_CDP_ATTACH_TIMEOUT_MS = 30_000;

export interface RelayLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface RelayTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RelayInstanceDeps {
  instanceId: string;
  profileDirectory: string;
  allowedDomains: readonly string[];
  audit: AuditRing;
  logger: RelayLogger;
  /** Fired exactly once when the instance dies; the manager removes the guid. */
  onClosed(reason: string): void;
  /** Fired on any instance/tab/state change so status can be rebroadcast. */
  onStatusChange(): void;
  timers?: RelayTimers;
  cdpAttachTimeoutMs?: number;
}

/** Minimal tab view the status message needs. `detached` + `reason` carry the
 * DevTools take-over; a plain `TapTabState` means "not detached". */
export interface RelayTabView {
  tabId: number;
  title: string;
  url: string;
  state: TapTabState | "detached";
  /** Set when `state === "detached"`. */
  reason?: "devtools";
}

// ── Vendored-internal access (see module doc) ────────────────────────────────
interface TabSessionLike {
  tabId: number;
  sessionId: string;
}
interface ModelInternals {
  _tabSessions: Map<number, TabSessionLike>;
  _knownTabs: Map<number, { title?: string; url?: string }>;
}
function modelOf(handler: ExtensionProtocolV2): ModelInternals {
  return (handler as unknown as { _model: ModelInternals })._model;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing may observe this rejection before a racer attaches.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

interface WireCommand {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: unknown;
}

export class RelayInstance {
  private readonly protocol: ExtensionProtocolV2;
  private readonly tap: ScreencastTap;
  private readonly timers: RelayTimers;
  private readonly cdpAttachTimeoutMs: number;

  private extension?: ExtensionSocket;
  private cdp?: RelaySocket;
  /** Tabs the extension has announced (its controlled set). */
  private readonly knownTabs = new Set<number>();
  /**
   * Relay sessions whose debugger DevTools took over (`canceled_by_user`).
   * Recorded as SESSION ids, not tab ids: the vendored model drops the tab
   * session the moment it processes the detach, so a later tabId→session
   * lookup can no longer resolve and could never match an inbound command.
   */
  private readonly devtoolsDetachedSessions = new Set<string>();
  /**
   * Same take-over, keyed by TAB id for the status view: the model drops the
   * tab session when it processes the detach, so a later tabId→session lookup
   * cannot recover `devtoolsDetachedSessions` for `tabList()`.
   */
  private readonly devtoolsDetachedTabs = new Set<number>();
  /** Relay sessions where the CDP CLIENT runs its own screencast. */
  private readonly clientScreencasts = new Set<string>();

  private handshakeDone = false;
  private readonly ready = deferred<void>();
  private cdpAttachTimer?: unknown;
  private closedReason?: string;

  constructor(private readonly deps: RelayInstanceDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
    this.cdpAttachTimeoutMs = deps.cdpAttachTimeoutMs ?? DEFAULT_CDP_ATTACH_TIMEOUT_MS;

    this.protocol = new ExtensionProtocolV2((method, params) => {
      if (!this.extension) return Promise.reject(new Error("Extension not connected"));
      return this.extension.send(method, params);
    });
    // The model's single output sink: the tap filters frames for sessions it
    // owns, everything else goes to the CDP client. This is where design D2's
    // "listener list" lives — without editing the vendored `_emit`.
    const sink: SendToCDPClient = (message) => this._onModelOutput(message);
    this.protocol.connectOverCDP(sink);

    this.tap = new ScreencastTap({
      profileDirectory: deps.profileDirectory,
      instanceId: deps.instanceId,
      audit: deps.audit,
      logger: deps.logger,
      sessionIdForTab: (tabId) => this.sessionIdForTab(tabId),
      sendToTab: (sessionId, method, params) => this.sendToTab(sessionId, method, params),
      clientScreencastActive: (tabId) => this.clientScreencastActive(tabId),
      onStatusChange: () => this.deps.onStatusChange(),
      timers: this.timers,
    });
  }

  get instanceId(): string {
    return this.deps.instanceId;
  }

  get profileDirectory(): string {
    return this.deps.profileDirectory;
  }

  get isClosed(): boolean {
    return this.closedReason !== undefined;
  }

  get hasCdpClient(): boolean {
    return this.cdp !== undefined;
  }

  get tapState(): ScreencastTap {
    return this.tap;
  }

  /**
   * Resolves once the extension's `extension.initialized` handshake arrives.
   * Rejects when the instance closes first (extension never dialled, or died),
   * which is what turns a failed connect into a 504 rather than a hang.
   */
  waitForHandshake(): Promise<void> {
    return this.ready.promise;
  }

  /** Relay `pw-tab-N` session for a Chrome tab id (the vendored-internal read). */
  sessionIdForTab(tabId: number): string | undefined {
    return modelOf(this.protocol)._tabSessions.get(tabId)?.sessionId;
  }

  /** One CDP command into a tab's session (used by the tap and viewer input). */
  sendToTab(sessionId: string, method: string, params: unknown): Promise<unknown> {
    return this.protocol.forwardToExtension(method, params, sessionId);
  }

  tabList(): RelayTabView[] {
    const known = modelOf(this.protocol)._knownTabs;
    const states = this.tap.tabStates();
    const ids = known.size > 0 ? [...known.keys()] : [...this.knownTabs];
    return ids.map((tabId) => {
      // Precedence: an active tap view (live / no-frames / client-screencast-
      // active) first; then DevTools take-over; then a client-run screencast;
      // else `live`. `tap.tabStates()` only knows tabs with viewers, so the
      // detached/client-screencast branches must come from the instance.
      const sessionId = this.sessionIdForTab(tabId);
      const detached = this.devtoolsDetachedTabs.has(tabId);
      const clientScreencast = sessionId !== undefined && this.clientScreencasts.has(sessionId);
      const state: RelayTabView["state"] = detached
        ? "detached"
        : (states.get(tabId) ?? (clientScreencast ? "client-screencast-active" : "live"));
      return {
        tabId,
        title: known.get(tabId)?.title ?? "",
        url: known.get(tabId)?.url ?? "",
        state,
        ...(state === "detached" ? { reason: "devtools" as const } : {}),
      };
    });
  }

  statusState(): "connected" | "no-cdp-client" {
    return this.cdp ? "connected" : "no-cdp-client";
  }

  // ── Extension side ─────────────────────────────────────────────────────────

  attachExtension(ws: RelaySocket): void {
    if (this.extension) {
      ws.close(1000, "Another extension connection already established");
      return;
    }
    const socket = new ExtensionSocket(ws);
    this.extension = socket;
    socket.onmessage = (method, params) => this._onExtensionMessage(method, params);
    socket.onclose = (reason) => this._onExtensionClose(reason);

    this.protocol
      .ready()
      .then(() => this._onHandshake())
      .catch(() => {
        /* extension died before initializing; _onExtensionClose owns teardown */
      });

    this.deps.audit.append({
      profileDirectory: this.deps.profileDirectory,
      instanceId: this.deps.instanceId,
      kind: "attach",
      detail: "extension",
    });
    this.deps.onStatusChange();
  }

  /** Wire an already-upgraded CDP client socket. */
  attachCdp(ws: RelaySocket): void {
    if (this.cdp) {
      ws.close(1000, "Another CDP client already connected");
      return;
    }
    this.cdp = ws;
    ws.on("message", ((data: unknown) => this._onCdpData(data)) as never);
    ws.on("close", (() => this._onCdpClose()) as never);
    ws.on("error", (() => this._onCdpClose()) as never);

    if (this.handshakeDone) {
      this._clearCdpAttachTimer();
    } else {
      // Spec: a CDP client that arrives before the extension is held, but only
      // for 30 s — otherwise a dead agent leaves a socket pinned forever.
      this.cdpAttachTimer = this.timers.setTimeout(() => {
        this.cdpAttachTimer = undefined;
        this._closeCdp("Extension not connected");
        this.close("no-extension");
      }, this.cdpAttachTimeoutMs);
    }
    this.deps.onStatusChange();
  }

  private _onHandshake(): void {
    if (this.handshakeDone) return;
    this.handshakeDone = true;
    this.ready.resolve();
    this._clearCdpAttachTimer();
    if (!this.cdp) {
      // Spec X3: handshake done, agent never attached → the tab group would sit
      // in the user's Chrome forever. Close it and say why in the audit.
      this.cdpAttachTimer = this.timers.setTimeout(() => {
        this.cdpAttachTimer = undefined;
        this.deps.audit.append({
          profileDirectory: this.deps.profileDirectory,
          instanceId: this.deps.instanceId,
          kind: "detach",
          detail: "no-cdp-client",
        });
        this.close("no-cdp-client");
      }, this.cdpAttachTimeoutMs);
    }
    this.deps.onStatusChange();
  }

  private _onExtensionMessage(method: string, params: unknown): void {
    if (method === "chrome.debugger.onDetach") this._captureDetach(params);
    else if (method === "chrome.tabs.onCreated") this._captureTabCreated(params);
    else if (method === "chrome.tabs.onRemoved") this._captureTabRemoved(params);
    this.protocol.handleExtensionEvent(method, params);
  }

  /**
   * `chrome.debugger.onDetach` carries the REASON, which the vendored
   * `ExtensionProtocolV2` deliberately drops when it forwards to the model. The
   * DevTools overlay needs it, so capture it before delegating. The relay
   * SESSION id is recorded (not the tab id): the model drops the tab session
   * while processing this very event, so a later tabId→session lookup could
   * never match an inbound command that still references the dead session.
   */
  private _captureDetach(params: unknown): void {
    const [source, reason] = (params ?? []) as [{ tabId?: number }, unknown];
    if (reason !== DEVTOOLS_DETACH_REASON || typeof source?.tabId !== "number") return;
    const detachedSession = this.sessionIdForTab(source.tabId);
    if (detachedSession) this.devtoolsDetachedSessions.add(detachedSession);
    this.devtoolsDetachedTabs.add(source.tabId);
    this.tap.markDetached(source.tabId);
    this.deps.logger.info(
      `[browser-relay] instance ${this.deps.profileDirectory} tab=${source.tabId} detached: devtools`,
    );
    this.deps.onStatusChange();
  }

  private _captureTabCreated(params: unknown): void {
    const [tab] = (params ?? []) as [{ id?: number }];
    if (typeof tab?.id === "number") this.knownTabs.add(tab.id);
  }

  private _captureTabRemoved(params: unknown): void {
    const [tabId] = (params ?? []) as [number];
    this.knownTabs.delete(tabId);
    // Spec X6: the last controlled tab closing ends the session.
    if (this.knownTabs.size === 0) {
      this.deps.logger.info(`[browser-relay] instance ${this.deps.profileDirectory} last tab closed`);
      this._closeExtension("All controlled tabs detached");
    }
  }

  private _onExtensionClose(reason: string): void {
    this.protocol.onExtensionDisconnect(reason);
    this._finalize(`extension-closed:${reason}`, `Extension disconnected: ${reason}`, reason);
  }

  private _closeExtension(reason: string): void {
    this.extension?.close(reason);
  }

  // ── CDP client side ────────────────────────────────────────────────────────

  private _onCdpData(data: unknown): void {
    const text = typeof data === "string" ? data : String(data);
    let message: WireCommand;
    try {
      message = JSON.parse(text) as WireCommand;
    } catch {
      return; // malformed frame from the client: drop it, keep the socket
    }
    void this._handleCdp(message);
  }

  private async _handleCdp(message: WireCommand): Promise<void> {
    const { id, sessionId, method, params } = message;
    if (typeof id !== "number" || typeof method !== "string") return;

    if (this._tabDetachedFor(sessionId)) {
      this._sendToCdp({ id, sessionId, error: { code: -32000, message: "Target detached: devtools" } });
      return;
    }
    if (this._refuseDenied(id, sessionId, method, params)) return;
    if (this._trackClientScreencast(id, sessionId, method)) return;

    try {
      if (!this.handshakeDone) await this.ready.promise;
      let result: unknown;
      if (method === "Browser.getVersion") {
        result = {
          protocolVersion: "1.3",
          product: "Chrome/Extension-Bridge",
          userAgent: "CDP-Bridge-Server/1.0.0",
        };
      } else {
        const handled = await this.protocol.handleCDPCommand(method, params, sessionId);
        result = handled ? handled.result : await this.protocol.forwardToExtension(method, params, sessionId);
        this._auditNavigation(method, params);
      }
      this._sendToCdp({ id, sessionId, result });
    } catch (err) {
      this._sendToCdp({ id, sessionId, error: { message: (err as Error).message } });
    }
  }

  /** Answer a policy-denied verb with a CDP error. Returns true when refused. */
  private _refuseDenied(id: number, sessionId: string | undefined, method: string, params: unknown): boolean {
    const denied = deniedMethod(method, params, this.deps.allowedDomains);
    if (!denied) return false;
    this.deps.audit.append({
      profileDirectory: this.deps.profileDirectory,
      instanceId: this.deps.instanceId,
      kind: "denied",
      detail: denied,
    });
    this.deps.logger.warn(`[browser-relay] denied ${denied} profile=${this.deps.profileDirectory}`);
    this._sendToCdp({ id, sessionId, error: denyError(denied) });
    return true;
  }

  /**
   * Track the client's own screencast so a viewer subscribe can be refused
   * rather than fighting it for the tab (E27), and refuse a client
   * `Page.startScreencast` on a session a TAP owns (E26). Returns true when the
   * command was refused.
   */
  private _trackClientScreencast(id: number, sessionId: string | undefined, method: string): boolean {
    if (!sessionId) return false;
    if (method === "Page.startScreencast" && this.tap.handlesSession(sessionId)) {
      this.deps.audit.append({
        profileDirectory: this.deps.profileDirectory,
        instanceId: this.deps.instanceId,
        kind: "denied",
        detail: method,
      });
      this._sendToCdp({ id, sessionId, error: denyError(method) });
      return true;
    }
    if (method === "Page.startScreencast") this.clientScreencasts.add(sessionId);
    if (method === "Page.stopScreencast") this.clientScreencasts.delete(sessionId);
    return false;
  }

  private _auditNavigation(method: string, params: unknown): void {
    if (method !== "Page.navigate" && method !== "Target.createTarget") return;
    const url = (params as { url?: unknown } | undefined)?.url;
    this.deps.audit.append({
      profileDirectory: this.deps.profileDirectory,
      instanceId: this.deps.instanceId,
      kind: method === "Page.navigate" ? "navigate" : "createTarget",
      detail: typeof url === "string" ? url : "",
    });
  }

  private _tabDetachedFor(sessionId: string | undefined): boolean {
    return sessionId !== undefined && this.devtoolsDetachedSessions.has(sessionId);
  }

  private _onModelOutput(message: CDPMessage): void {
    // Frames for a tapped session belong to the viewers, never to the client.
    if (message.method === "Page.screencastFrame" && this.tap.onEvent(message.sessionId, message.method, message.params)) {
      return;
    }
    this._sendToCdp(message);
  }

  private _sendToCdp(message: CDPMessage): void {
    if (!this.cdp || this.cdp.readyState !== WS_OPEN) return;
    try {
      this.cdp.send(JSON.stringify(message));
    } catch (err) {
      this.deps.logger.warn("[browser-relay] cdp send failed", err);
    }
  }

  private _onCdpClose(): void {
    // Playwright disconnecting means the agent's task is over: release the tab
    // group rather than leaving it in the user's Chrome (design D3).
    this._finalize("cdp-closed", "cdp-closed", "CDP client disconnected");
  }

  private clientScreencastActive(tabId: number): boolean {
    const sessionId = this.sessionIdForTab(tabId);
    return sessionId !== undefined && this.clientScreencasts.has(sessionId);
  }

  private _closeCdp(reason: string): void {
    if (this.cdp && this.cdp.readyState === WS_OPEN) this.cdp.close(1000, reason);
  }

  private _clearCdpAttachTimer(): void {
    if (this.cdpAttachTimer !== undefined) {
      this.timers.clearTimeout(this.cdpAttachTimer);
      this.cdpAttachTimer = undefined;
    }
  }

  // ── Viewer plane (delegated to the tap) ────────────────────────────────────

  subscribe(viewer: RelaySocket, tabId: number): { ok: boolean; state?: TapTabState | "detached" } {
    const result = this.tap.subscribe(viewer, tabId);
    return result.ok ? { ok: true } : { ok: false, state: result.state };
  }

  unsubscribe(viewer: RelaySocket, tabId: number): void {
    this.tap.unsubscribe(viewer, tabId);
  }

  unsubscribeAll(viewer: RelaySocket): void {
    this.tap.unsubscribeAll(viewer);
  }

  input(viewer: RelaySocket, tabId: number, msg: unknown, remoteAddress?: string): Promise<void> {
    return this.tap.input(viewer, tabId, msg, remoteAddress);
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  /**
   * Idempotent single teardown. Closes both sockets, stops taps, and notifies
   * the manager exactly once.
   *
   * `closedReason` is set BEFORE either socket is closed on purpose: closing
   * one socket fires the other side's close handler SYNCHRONOUSLY, and that
   * handler must see the winner already recorded — otherwise the reciprocating
   * close would claim the cause and the manager would be told the wrong reason
   * (the extension dying would be reported as `cdp-closed`). Whoever initiates
   * the teardown owns the reason.
   */
  close(reason: string): void {
    this._finalize(reason, reason, reason);
  }

  private _finalize(reason: string, cdpReason: string, extensionReason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    this._clearCdpAttachTimer();
    this.ready.reject(new Error(reason));
    this.tap.closeAll();
    this._closeCdp(cdpReason);
    this._closeExtension(extensionReason);
    this.deps.logger.info(
      `[browser-relay] instance ${this.deps.profileDirectory} close (${reason})`,
    );
    this.deps.onClosed(reason);
  }
}
