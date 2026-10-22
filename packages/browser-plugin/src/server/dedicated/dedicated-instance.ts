/**
 * `DedicatedInstance` — one agent CDP client bridged to the dashboard-owned
 * Chrome's debugging pipe (change: add-dedicated-agent-browser, D4/D5, tasks
 * 3.1–3.4). Implements `RelayLike`, so the manager, status and the viewer plane
 * treat it like a relay instance.
 *
 * DATA FLOW
 *   client socket ──(deny checks, id rewrite)──▶ DedicatedChrome pipe (browser level)
 *   client socket ◀──(hidden filter, cookie scrub, id restore)── pipe
 *   The pipe is ONE browser-level session. Per-target sessions are flattened
 *   sessions the SERVER attached via its own browser-level
 *   `Target.setAutoAttach {flatten, waitForDebuggerOnStart:true}`; the proxy hands
 *   a visible target's session to the client (one session per target) and answers
 *   `Target.setDiscoverTargets` / `setAutoAttach` / `attachToTarget` /
 *   `detachFromTarget` itself. Hidden targets (server-owned sign-in tabs, their
 *   popups/frames, WebUI pages) are resumed and never announced; any client
 *   command or session naming one fails like a nonexistent id.
 *
 * COMMAND ORDER (per client message)
 *   session validity → hidden params → relay deny-list (global allowed domains
 *   only; exact `about:blank` is exempt, Playwright's `newPage` needs it) →
 *   dedicated deny set + classification (`dedicated-deny.ts`) → ack-and-drop →
 *   proxy-served browser-level verbs → forward with a rewritten id.
 *
 * IDS: client ids are rewritten from the shared counter in `pipe-call.ts`
 * (always < CHROME_INTERNAL_ID_BASE, never reused across instances); server-owned
 * commands use the same counter.
 *
 * WHAT THE MANAGER MUST WIRE (task 3.5+)
 *   - construct with the ONE `HiddenTargets` of the `DedicatedChrome` (call
 *     `hidden.bindChrome(chrome)` once) and the `DedicatedChrome` as `chrome`;
 *   - `attachCdp(ws)` when `/ws/browser-cdp/<guid>` upgrades; Chrome keeps running
 *     when the instance closes;
 *   - the 30 s no-client timer: if `!hasCdpClient` fire `closeWithDetach("no-cdp-client")`;
 *   - the idle sweep (D8): compare `lastActivity` (client commands + viewer input)
 *     with the threshold and call `closeWithDetach("idle")`;
 *   - sign-in tabs: `openHiddenTab(url)` while an instance is live (audits `open`);
 *     otherwise the standalone `openHiddenTab(chrome, hidden, url)` from
 *     `hidden-targets.ts` (the route then audits `open` itself);
 *   - on Chrome exit this instance closes itself (`detach` `closed:chrome-exited`
 *     for an unexpected exit) and calls `onClosed`.
 *
 * Browser-level events other than `Target.*` (e.g. `Browser.downloadProgress`) are
 * not forwarded. A hidden→visible flip (WebUI page navigates away) re-announces the
 * target; a visible→hidden flip tells the client `detachedFromTarget` +
 * `targetDestroyed`. Disabling auto-attach from the client does not detach already
 * announced sessions.
 */
import type { AuditRing } from "../audit.js";
import { redactExtensionUrl } from "../redact.js";
import { deniedMethod, denyError, effectiveAllowedDomains } from "../relay/deny-list.js";
import { type RelaySocket, WS_OPEN } from "../relay/extension-socket.js";
import type { RelayLogger, RelayTabView, RelayTimers } from "../relay/relay-instance.js";
import type { RelayLike } from "../relay/relay-manager.js";
import { ScreencastTap, type SubscribeOptions, type TapTabState } from "../relay/screencast-tap.js";
import {
  carriesCookies,
  checkOpenUrl,
  DEDICATED_ACK_AND_DROP_METHODS,
  dedicatedDenied,
  isBlankNavigation,
  isWebUiUrl,
  scrubCookies,
} from "./dedicated-deny.js";
import { disposeEphemeralContext } from "./ephemeral-context.js";
import { HiddenTargets, openHiddenTab as openHiddenTabOnPipe } from "./hidden-targets.js";
import { type CdpError, nextCdpId, PipeCallError, type PipeLike } from "./pipe-call.js";
import { TabIdMap } from "./tab-id-map.js";
import { TapAdapter } from "./tap-adapter.js";

export const DEDICATED_PROFILE = "@dedicated";

const REAL_TIMERS: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const NO_TARGET_ERROR: CdpError = { code: -32000, message: "No target with given id found" };
const NO_SESSION_ERROR: CdpError = { code: -32001, message: "Session with given id not found." };
const INTERNAL_CALL_TIMEOUT_MS = 15_000;
/** Target types never shown to an agent client (Chrome's own default `getTargets` filter). */
const CLIENT_HIDDEN_TYPES: ReadonlySet<string> = new Set(["browser", "tab"]);
/** `params` keys that name a target / frame / session. */
const TARGET_PARAM_KEYS: readonly string[] = ["targetId", "frameId", "openerId"];

export interface DedicatedHolder {
  /** The `browser_connect` caller. */
  sessionId?: string;
  /** The REST body `client` label. */
  client?: string;
}

export interface DedicatedInstanceDeps {
  instanceId: string;
  /** The `DedicatedChrome` (or a `FakeChromePipe`). */
  chrome: PipeLike;
  /** Live global `allowedDomains` (the dedicated profile has no list of its own). */
  globalAllowedDomains?: () => readonly string[];
  audit: AuditRing;
  logger: RelayLogger;
  /** Shared registry of server-owned hidden targets; default: private. */
  hidden?: HiddenTargets;
  holder?: DedicatedHolder;
  /**
   * Private (change: add-gmail-auto-setup): no tabs in the status composition, every viewer
   * subscribe/input refused and audited `viewer-subscribe-refused`.
   */
  private?: boolean;
  /**
   * Server-created browser context of an ephemeral instance: client `createTarget` is pinned
   * into it, discovery shows only its targets, the client may neither create nor dispose
   * contexts, and it is disposed when the instance closes.
   */
  ephemeralContextId?: string;
  /** Fired exactly once when the instance dies; the manager removes the guid. */
  onClosed(reason: string): void;
  /** Fired on any instance/tab/state change so status can be rebroadcast. */
  onStatusChange(): void;
  /** Coalescing variant for title/URL changes; falls back to `onStatusChange`. */
  onTabMetaChange?(): void;
  /**
   * The CLIENT created a page (`Target.createTarget` answered ok) — live view on
   * connect. Never fired for server-owned hidden tabs. May throw; swallowed.
   */
  onAgentTabCreated?(tabId: number): void;
  timers?: RelayTimers;
  now?: () => number;
  /** Timeout of a server-owned command (default 15 s). */
  callTimeoutMs?: number;
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
  openerId?: string;
  openerFrameId?: string;
  parentFrameId?: string;
  [key: string]: unknown;
}

interface TargetEntry {
  info: TargetInfo;
  tabId?: number;
  hidden: boolean;
  /** The server's flattened session on this target (auto-attach). */
  sessionId?: string;
  /** Chrome paused the target for the debugger and nobody resumed it yet. */
  waiting: boolean;
  /** The client was told about `sessionId` (`attachedToTarget`). */
  announced: boolean;
  /** The client got `Target.targetCreated`. */
  discovered: boolean;
}

interface SessionRec {
  targetId: string;
  /** Set for a child (frame/worker) session: the session it was attached under. */
  parent?: string;
}

type Transform = (result: unknown) => { result: unknown } | { error: CdpError };

type Pending =
  | { kind: "client"; id: number; sessionId?: string; transform?: Transform }
  | {
      kind: "internal";
      method: string;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    };

interface WireCommand {
  id?: unknown;
  sessionId?: string;
  method?: unknown;
  params?: unknown;
}

interface ChromeMessage {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  sessionId?: string;
  result?: unknown;
  error?: CdpError;
}

export class DedicatedInstance implements RelayLike {
  readonly profileDirectory = DEDICATED_PROFILE;
  /** Who holds the single dedicated slot (for the 409 `busy` body and status). */
  readonly holder: DedicatedHolder | undefined;
  readonly createdAt: number;

  private readonly deps: DedicatedInstanceDeps;
  private readonly chrome: PipeLike;
  private readonly hidden: HiddenTargets;
  private readonly timers: RelayTimers;
  private readonly now: () => number;
  private readonly tap: ScreencastTap;
  private readonly tapAdapter: TapAdapter;
  private readonly tabIds = new TabIdMap();

  private cdp?: RelaySocket;
  private started = false;
  private closedReason?: string;
  private chromeGone = false;
  private readonly unsubscribers: Array<() => void> = [];

  private readonly pending = new Map<number, Pending>();
  private readonly targets = new Map<string, TargetEntry>();
  private readonly sessions = new Map<string, SessionRec>();
  private held: ChromeMessage[] = [];

  private discoveryOn = false;
  private autoAttach = { on: false, wait: false };
  private readonly createdTargets = new Set<string>();
  private readonly createdContexts = new Set<string>();
  private readonly clientScreencasts = new Set<string>();
  private readonly agentEmulationSessions = new Set<string>();

  private _lastActivity: number;

  constructor(deps: DedicatedInstanceDeps) {
    this.deps = deps;
    this.chrome = deps.chrome;
    this.hidden = deps.hidden ?? new HiddenTargets();
    this.timers = deps.timers ?? REAL_TIMERS;
    this.now = deps.now ?? (() => Date.now());
    this.holder = deps.holder;
    this.createdAt = this.now();
    this._lastActivity = this.createdAt;

    this.tapAdapter = new TapAdapter({
      targetForTab: (tabId) => this.visibleSessionTarget(tabId),
      call: (method, params, sessionId) => this.call(method, params, sessionId),
      onEvent: (sessionId, method, params) => this.tap.onEvent(sessionId, method, params),
    });
    this.tap = new ScreencastTap({
      profileDirectory: DEDICATED_PROFILE,
      instanceId: deps.instanceId,
      audit: deps.audit,
      logger: deps.logger,
      sessionIdForTab: (tabId) => this.tapAdapter.sessionIdForTab(tabId),
      sendToTab: (sessionId, method, params) => this.tapAdapter.sendToTab(sessionId, method, params),
      clientScreencastActive: (tabId) => this.clientScreencastActive(tabId),
      agentEmulationActive: (tabId) => this.agentEmulationActive(tabId),
      onStatusChange: () => deps.onStatusChange(),
      timers: this.timers,
    });

    this.unsubscribers.push(
      this.chrome.onMessage((msg) => this.onChromeMessage(msg)),
      this.chrome.onExit((info) => this.onChromeExit(info.expected)),
      this.hidden.onRelease(() => this.onHiddenRelease()),
    );
  }

  // ── RelayLike surface ──────────────────────────────────────────────────────

  get instanceId(): string {
    return this.deps.instanceId;
  }

  get isClosed(): boolean {
    return this.closedReason !== undefined;
  }

  get hasCdpClient(): boolean {
    return this.cdp !== undefined;
  }

  /** Epoch ms of the last client command or viewer input (idle sweep, D8). */
  get lastActivity(): number {
    return this._lastActivity;
  }

  get tapState(): ScreencastTap {
    return this.tap;
  }

  statusState(): "connected" | "no-cdp-client" {
    return this.cdp ? "connected" : "no-cdp-client";
  }

  /** Visible agent tabs only: hidden targets never appear; a private instance lists none. */
  tabList(): RelayTabView[] {
    if (this.deps.private) return [];
    const states = this.tap.tabStates();
    const out: RelayTabView[] = [];
    for (const entry of this.targets.values()) {
      if (entry.hidden || entry.info.type !== "page" || entry.tabId === undefined) continue;
      const tabId = entry.tabId;
      const noSession = entry.sessionId === undefined;
      const clientScreencast = this.clientScreencastActive(tabId);
      const state: RelayTabView["state"] = noSession
        ? "detached"
        : (states.get(tabId) ?? (clientScreencast ? "client-screencast-active" : "live"));
      out.push({
        tabId,
        title: entry.info.title,
        url: redactExtensionUrl(entry.info.url),
        state,
        ...(noSession ? { reason: "no-session" as const } : {}),
        ...(this.agentEmulationActive(tabId) ? { agentEmulation: true } : {}),
      });
    }
    return out.sort((a, b) => a.tabId - b.tabId);
  }

  /** Numeric tab id of a target (hidden pages have one too, so a viewer subscribe can be refused). */
  tabIdForTarget(targetId: string): number | undefined {
    return this.tabIds.tabIdFor(targetId);
  }

  /** Viewer subscribe: hidden tabs are refused and audited. */
  subscribe(viewer: RelaySocket, tabId: number, opts?: SubscribeOptions): { ok: boolean; state?: TapTabState | "detached" } {
    if (this.deps.private) {
      this.audit("viewer-subscribe-refused", `tab:${tabId} reason:private`);
      return { ok: false, state: "detached" };
    }
    const entry = this.entryForTab(tabId);
    if (entry?.hidden) {
      this.audit("viewer-subscribe-refused", `tab:${tabId} reason:hidden`);
      return { ok: false, state: "detached" };
    }
    const result = this.tap.subscribe(viewer, tabId, opts);
    if (!result.ok) this.audit("viewer-subscribe-refused", `tab:${tabId} reason:${result.reason}`);
    return result.ok ? { ok: true } : { ok: false, state: result.state };
  }

  unsubscribe(viewer: RelaySocket, tabId: number): void {
    this.tap.unsubscribe(viewer, tabId);
  }

  unsubscribeAll(viewer: RelaySocket): void {
    this.tap.unsubscribeAll(viewer);
  }

  input(viewer: RelaySocket, tabId: number, msg: unknown, remoteAddress?: string): Promise<void> {
    if (this.deps.private) {
      this.audit("viewer-subscribe-refused", `tab:${tabId} reason:private via:input`);
      return Promise.resolve();
    }
    if (this.entryForTab(tabId)?.hidden) {
      this.audit("viewer-subscribe-refused", `tab:${tabId} reason:hidden via:input`);
      return Promise.resolve();
    }
    this._lastActivity = this.now(); // viewer input counts for idle, not for `lastUsed`
    return this.tap.input(viewer, tabId, msg, remoteAddress);
  }

  /** Close the instance. Chrome keeps running. Idempotent. */
  close(reason: string): void {
    this.finalize(reason);
  }

  /** Audit a `detach` with `detail` then close with it (`no-cdp-client`, `idle`). */
  closeWithDetach(detail: string): void {
    if (this.closedReason) return;
    this.audit("detach", detail);
    this.finalize(detail);
  }

  // ── Server-owned hidden tab ────────────────────────────────────────────────

  /**
   * Open a sign-in tab the agent can never see (`dedicated/open`). The URL must be
   * `https:` and pass the effective allowed domains (else throws `url-denied`).
   * Appends the `open` audit row; stamps `lastUsed`.
   */
  async openHiddenTab(url: string): Promise<{ targetId: string }> {
    const check = checkOpenUrl(url, this.effectiveDomains());
    if (!check.ok) {
      const err = new Error(check.reason) as Error & { code: string };
      err.code = "url-denied";
      throw err;
    }
    this.chrome.touch?.();
    const result = await openHiddenTabOnPipe(
      this.chrome,
      this.hidden,
      url,
      this.deps.ephemeralContextId ? { browserContextId: this.deps.ephemeralContextId } : {},
    );
    this.audit("open", url);
    return result;
  }

  // ── CDP client side ────────────────────────────────────────────────────────

  /** Wire an already-upgraded CDP client socket (same contract as `RelayInstance.attachCdp`). */
  attachCdp(ws: RelaySocket): void {
    if (this.closedReason) {
      ws.close(1000, "Instance closed");
      return;
    }
    if (this.cdp) {
      ws.close(1000, "Another CDP client already connected");
      return;
    }
    this.cdp = ws;
    ws.on("message", ((data: unknown) => this.onCdpData(data)) as never);
    ws.on("close", (() => this.onCdpClose()) as never);
    ws.on("error", (() => this.onCdpClose()) as never);
    this.startServerSession();
    this.deps.onStatusChange();
  }

  /** Server-side discovery + auto-attach, re-armed (false→true) so existing targets re-attach. */
  private startServerSession(): void {
    this.started = true;
    this.fire("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    this.fire("Target.setDiscoverTargets", { discover: true });
    this.fire("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  }

  private onCdpData(data: unknown): void {
    let message: WireCommand;
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data)) as WireCommand;
    } catch {
      return; // malformed frame: drop it, keep the socket
    }
    if (message === null || typeof message !== "object") return;
    this.handleClient(message);
  }

  private handleClient(message: WireCommand): void {
    const { id, sessionId, method } = message;
    if (typeof id !== "number" || typeof method !== "string") return;
    const params = this.pinContext(method, message.params);
    this._lastActivity = this.now();
    this.chrome.touch?.();

    if (sessionId !== undefined && !this.isClientSession(sessionId)) {
      this.sendToCdp({ id, sessionId, error: NO_SESSION_ERROR });
      return;
    }
    const hiddenError = this.hiddenParamError(params);
    if (hiddenError) {
      this.audit("denied", `${method} reason:hidden`);
      this.sendToCdp({ id, sessionId, error: hiddenError });
      return;
    }
    if (this.refuseDenied(id, sessionId, method, params)) return;
    if (this.ackAndDrop(id, sessionId, method)) return;
    if (sessionId === undefined && this.handleBrowserLevel(id, method, params)) return;

    this.trackSessionCommand(sessionId, method);
    this.auditNavigation(method, params);
    this.forward(id, sessionId, method, params);
  }

  /** Ephemeral instance: every `Target.createTarget` lands in the instance's own context, whatever the client asked for. */
  private pinContext(method: string, params: unknown): unknown {
    const ctx = this.deps.ephemeralContextId;
    if (ctx === undefined || method !== "Target.createTarget") return params;
    return { ...(typeof params === "object" && params !== null ? params : {}), browserContextId: ctx };
  }

  /** A target outside the ephemeral context is never shown to the client (fails closed when Chrome names no context). */
  private foreignContext(info: TargetInfo): boolean {
    const ctx = this.deps.ephemeralContextId;
    return ctx !== undefined && info.browserContextId !== ctx;
  }

  /** A CDP error when `params` names a hidden target or a session the client does not own. */
  private hiddenParamError(params: unknown): CdpError | undefined {
    if (typeof params !== "object" || params === null) return undefined;
    const p = params as Record<string, unknown>;
    for (const key of TARGET_PARAM_KEYS) {
      const value = p[key];
      if (typeof value === "string" && this.isHiddenTarget(value)) return NO_TARGET_ERROR;
    }
    const session = p.sessionId;
    if (typeof session === "string" && this.sessions.has(session) && !this.isClientSession(session)) return NO_SESSION_ERROR;
    return undefined;
  }

  private effectiveDomains(): readonly string[] {
    return effectiveAllowedDomains([], this.deps.globalAllowedDomains?.() ?? []);
  }

  private refuseDenied(id: number, sessionId: string | undefined, method: string, params: unknown): boolean {
    const relay = isBlankNavigation(method, params) ? null : deniedMethod(method, params, this.effectiveDomains());
    const denied = relay ?? dedicatedDenied(method, params, sessionId) ?? this.ephemeralDenied(method);
    if (!denied) return false;
    this.audit("denied", denied);
    this.deps.logger.warn(`[browser-relay] denied ${denied} profile=${DEDICATED_PROFILE}`);
    this.sendToCdp({ id, sessionId, error: denyError(denied) });
    return true;
  }

  /** An ephemeral client cannot manage browser contexts: the server owns the one it has. */
  private ephemeralDenied(method: string): string | null {
    if (this.deps.ephemeralContextId === undefined) return null;
    return method === "Target.createBrowserContext" || method === "Target.disposeBrowserContext" ? method : null;
  }

  private ackAndDrop(id: number, sessionId: string | undefined, method: string): boolean {
    if (!DEDICATED_ACK_AND_DROP_METHODS.includes(method)) return false;
    this.audit("dropped", method);
    this.sendToCdp({ id, sessionId, result: {} });
    return true;
  }

  private auditNavigation(method: string, params: unknown): void {
    if (method !== "Page.navigate" && method !== "Target.createTarget") return;
    const url = (params as { url?: unknown } | undefined)?.url;
    this.audit(method === "Page.navigate" ? "navigate" : "createTarget", typeof url === "string" ? url : "");
  }

  /** Browser-level verbs the proxy serves. Returns true when handled. */
  private handleBrowserLevel(id: number, method: string, params: unknown): boolean {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    switch (method) {
      case "Target.setDiscoverTargets":
        return this.serveSetDiscover(id, p);
      case "Target.setAutoAttach":
        return this.serveSetAutoAttach(id, p);
      case "Target.attachToTarget":
        return this.serveAttach(id, p);
      case "Target.detachFromTarget":
        return this.serveDetach(id, p);
      case "Target.getTargets":
        this.forward(id, undefined, method, params, (result) => this.filterTargets(result));
        return true;
      case "Target.getTargetInfo":
        this.forward(id, undefined, method, params, (result) => this.filterTargetInfo(result));
        return true;
      case "Target.createTarget":
        this.auditNavigation(method, params);
        this.forward(id, undefined, method, params, (result) => {
          const tracked = this.trackCreated(this.createdTargets, "targetId", result);
          this.notifyAgentTab(result);
          return tracked;
        });
        return true;
      case "Target.createBrowserContext":
        this.forward(id, undefined, method, params, (result) => this.trackCreated(this.createdContexts, "browserContextId", result));
        return true;
      case "Target.disposeBrowserContext":
        if (typeof p.browserContextId === "string") this.createdContexts.delete(p.browserContextId);
        return false;
      default:
        return false;
    }
  }

  private notifyAgentTab(result: unknown): void {
    const hook = this.deps.onAgentTabCreated;
    const targetId = (result as { targetId?: unknown } | undefined)?.targetId;
    if (!hook || typeof targetId !== "string") return;
    const entry = this.targets.get(targetId);
    if (!entry || entry.hidden || entry.tabId === undefined) return; // not a visible page of ours
    try {
      hook(entry.tabId);
    } catch (err) {
      this.deps.logger.warn("[browser-relay] live view hook failed", (err as Error).message);
    }
  }

  private trackCreated(into: Set<string>, key: string, result: unknown): { result: unknown } {
    const created = (result as Record<string, unknown> | undefined)?.[key];
    if (typeof created === "string") into.add(created);
    return { result };
  }

  private serveSetDiscover(id: number, p: Record<string, unknown>): boolean {
    this.discoveryOn = p.discover === true;
    for (const entry of this.targets.values()) {
      if (this.discoveryOn) this.syncDiscovered(entry);
      else entry.discovered = false;
    }
    this.sendToCdp({ id, result: {} });
    return true;
  }

  private serveSetAutoAttach(id: number, p: Record<string, unknown>): boolean {
    this.autoAttach = { on: p.autoAttach === true, wait: p.waitForDebuggerOnStart === true };
    if (this.autoAttach.on) for (const entry of this.targets.values()) this.settle(entry);
    this.sendToCdp({ id, result: {} });
    return true;
  }

  private serveAttach(id: number, p: Record<string, unknown>): boolean {
    const entry = typeof p.targetId === "string" ? this.targets.get(p.targetId) : undefined;
    if (p.flatten !== true) {
      this.sendToCdp({ id, error: { code: -32000, message: "Only flattened sessions are supported" } });
    } else if (!entry || entry.hidden || entry.sessionId === undefined || CLIENT_HIDDEN_TYPES.has(entry.info.type)) {
      this.sendToCdp({ id, error: NO_TARGET_ERROR });
    } else {
      this.announceAttach(entry, false);
      this.sendToCdp({ id, result: { sessionId: entry.sessionId } });
    }
    return true;
  }

  private serveDetach(id: number, p: Record<string, unknown>): boolean {
    const sid = typeof p.sessionId === "string" ? p.sessionId : undefined;
    const rec = sid ? this.sessions.get(sid) : undefined;
    if (!sid || !rec) {
      this.sendToCdp({ id, error: NO_SESSION_ERROR });
      return true;
    }
    const entry = rec.parent ? undefined : this.targets.get(rec.targetId);
    if (!entry || entry.sessionId !== sid) return false; // a child session: Chrome owns it
    // The server keeps its own session; only the client's view ends.
    if (entry.announced) {
      entry.announced = false;
      this.sendToCdp({ method: "Target.detachedFromTarget", params: { sessionId: sid, targetId: entry.info.targetId } });
    }
    this.sendToCdp({ id, result: {} });
    return true;
  }

  private filterTargets(result: unknown): { result: unknown } {
    const infos = (result as { targetInfos?: unknown } | undefined)?.targetInfos;
    if (!Array.isArray(infos)) return { result };
    const out: TargetInfo[] = [];
    for (const raw of infos as TargetInfo[]) {
      if (typeof raw?.targetId !== "string") continue;
      const entry = this.noteTarget(raw, true);
      if (entry.hidden || CLIENT_HIDDEN_TYPES.has(entry.info.type)) continue;
      out.push({ ...entry.info, attached: entry.announced });
    }
    return { result: { ...(result as object), targetInfos: out } };
  }

  private filterTargetInfo(result: unknown): { result: unknown } | { error: CdpError } {
    const info = (result as { targetInfo?: TargetInfo } | undefined)?.targetInfo;
    if (!info || typeof info.targetId !== "string" || info.type === "browser") return { result };
    const entry = this.noteTarget(info, true);
    if (entry.hidden) return { error: NO_TARGET_ERROR };
    return { result: { ...(result as object), targetInfo: { ...entry.info, attached: entry.announced } } };
  }

  /** Session-bound commands whose effect the instance mirrors. */
  private trackSessionCommand(sessionId: string | undefined, method: string): void {
    if (!sessionId) return;
    switch (method) {
      case "Page.startScreencast":
        this.clientScreencasts.add(sessionId);
        break;
      case "Page.stopScreencast":
        this.clientScreencasts.delete(sessionId);
        break;
      case "Emulation.setDeviceMetricsOverride": {
        this.agentEmulationSessions.add(sessionId);
        const tabId = this.entryForSession(sessionId)?.tabId;
        if (tabId !== undefined) this.tap.releaseRelayOverride(tabId);
        this.deps.onStatusChange();
        break;
      }
      case "Emulation.clearDeviceMetricsOverride":
        if (this.agentEmulationSessions.delete(sessionId)) this.deps.onStatusChange();
        break;
      case "Runtime.runIfWaitingForDebugger": {
        const entry = this.entryForSession(sessionId);
        if (entry) entry.waiting = false;
        break;
      }
      default:
        break;
    }
  }

  private forward(id: number, sessionId: string | undefined, method: string, params: unknown, transform?: Transform): void {
    const rid = nextCdpId();
    this.pending.set(rid, { kind: "client", id, sessionId, transform });
    try {
      this.chrome.send({
        id: rid,
        method,
        ...(params !== undefined ? { params } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      });
    } catch (err) {
      this.pending.delete(rid);
      this.sendToCdp({ id, sessionId, error: { code: -32000, message: (err as Error).message } });
    }
  }

  // ── Server-owned commands ──────────────────────────────────────────────────

  private call(method: string, params?: object, sessionId?: string): Promise<unknown> {
    const rid = nextCdpId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(rid);
        reject(new PipeCallError(`${method} timed out`));
      }, this.deps.callTimeoutMs ?? INTERNAL_CALL_TIMEOUT_MS);
      this.pending.set(rid, {
        kind: "internal",
        method,
        resolve: (v) => {
          this.timers.clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          this.timers.clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.chrome.send({
          id: rid,
          method,
          ...(params ? { params } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
      } catch (err) {
        this.pending.delete(rid);
        this.timers.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** A server-owned command nobody awaits. */
  private fire(method: string, params?: object, sessionId?: string): void {
    this.call(method, params, sessionId).catch((err) =>
      this.deps.logger.warn(`[browser-relay] dedicated ${method} failed`, (err as Error).message),
    );
  }

  /** Best-effort write that never throws (teardown, pipe may be gone). */
  private sendRaw(method: string, params: object): void {
    try {
      this.chrome.send({ id: nextCdpId(), method, params });
    } catch {
      /* pipe closed */
    }
  }

  // ── Chrome → client ────────────────────────────────────────────────────────

  private onChromeMessage(raw: unknown): void {
    if (this.closedReason || raw === null || typeof raw !== "object") return;
    const msg = raw as ChromeMessage;
    if (typeof msg.id === "number") {
      this.onReply(msg);
      return;
    }
    if (typeof msg.method !== "string" || !this.started) return;
    // A hidden create is in flight: its auto-attach event may precede the reply
    // that registers the id, so hold events (in order) until the registry settles.
    if (this.hidden.pending > 0 || this.held.length > 0) {
      this.held.push(msg);
      return;
    }
    this.onEvent(msg);
  }

  private onHiddenRelease(): void {
    if (this.closedReason) return;
    for (const entry of [...this.targets.values()]) this.evaluate(entry, false);
    const queued = this.held;
    this.held = [];
    for (const msg of queued) {
      if (this.closedReason) return;
      this.onEvent(msg);
    }
  }

  private onReply(msg: ChromeMessage): void {
    const rid = msg.id as number;
    const pend = this.pending.get(rid);
    if (!pend) return; // a late reply of a previous instance, or an unknown id
    this.pending.delete(rid);
    if (pend.kind === "internal") {
      if (msg.error) pend.reject(new PipeCallError(msg.error.message ?? `${pend.method} failed`, msg.error));
      else pend.resolve(msg.result);
      return;
    }
    if (msg.error) {
      this.sendToCdp({ id: pend.id, sessionId: pend.sessionId, error: msg.error });
      return;
    }
    const out = pend.transform ? pend.transform(msg.result) : { result: msg.result };
    this.sendToCdp({ id: pend.id, sessionId: pend.sessionId, ...out });
  }

  private onEvent(msg: ChromeMessage): void {
    const method = msg.method as string;
    const params = msg.params as Record<string, unknown> | undefined;
    if (msg.sessionId === undefined) {
      if (method.startsWith("Target.")) this.onBrowserTargetEvent(method, params ?? {});
      return; // other browser-level events are not forwarded
    }
    this.onSessionEvent(msg.sessionId, method, params ?? {});
  }

  private onSessionEvent(sessionId: string, method: string, params: Record<string, unknown>): void {
    if (this.tapAdapter.isTapSession(sessionId)) {
      this.tapAdapter.onSessionEvent(sessionId, method, params);
      return;
    }
    if (!this.sessions.has(sessionId)) return;
    const owned = this.isClientSession(sessionId);
    const childSession = typeof params.sessionId === "string" ? params.sessionId : undefined;
    const childInfo = params.targetInfo as TargetInfo | undefined;
    if (method === "Target.attachedToTarget" && childSession && childInfo) {
      this.sessions.set(childSession, { targetId: childInfo.targetId, parent: sessionId });
      if (!owned) {
        // A child of a hidden page: resume it, never expose it.
        if (params.waitingForDebugger === true) this.fire("Runtime.runIfWaitingForDebugger", undefined, childSession);
        return;
      }
    }
    if (!owned) return;
    if (carriesCookies(method)) scrubCookies(params);
    this.sendToCdp({ method, params, sessionId });
    if (method === "Target.detachedFromTarget" && childSession) this.sessions.delete(childSession);
  }

  private onBrowserTargetEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "Target.targetCreated": {
        const info = params.targetInfo as TargetInfo | undefined;
        if (info && typeof info.targetId === "string") this.settle(this.noteTarget(info, false));
        return;
      }
      case "Target.targetInfoChanged":
        this.onTargetInfoChanged(params.targetInfo as TargetInfo | undefined);
        return;
      case "Target.targetDestroyed":
        if (typeof params.targetId === "string") this.onTargetDestroyed(params.targetId);
        return;
      case "Target.targetCrashed": {
        const entry = typeof params.targetId === "string" ? this.targets.get(params.targetId) : undefined;
        if (entry && !entry.hidden && entry.discovered) this.sendToCdp({ method, params });
        return;
      }
      case "Target.attachedToTarget":
        this.onServerAttach(params);
        return;
      case "Target.detachedFromTarget":
        this.onServerDetach(params);
        return;
      default:
        return;
    }
  }

  private onTargetInfoChanged(info: TargetInfo | undefined): void {
    if (!info || typeof info.targetId !== "string") return;
    const entry = this.noteTarget(info, false);
    if (entry.hidden) return;
    this.settle(entry);
    if (entry.discovered && this.discoveryOn) {
      this.sendToCdp({ method: "Target.targetInfoChanged", params: { targetInfo: { ...entry.info, attached: entry.announced } } });
    }
    (this.deps.onTabMetaChange ?? this.deps.onStatusChange)();
  }

  private onServerAttach(params: Record<string, unknown>): void {
    const sessionId = params.sessionId;
    const info = params.targetInfo as TargetInfo | undefined;
    if (typeof sessionId !== "string" || !info || typeof info.targetId !== "string") return;
    if (this.tapAdapter.claimAttach(sessionId, info.targetId)) return; // our own tap session
    const entry = this.noteTarget(info, false);
    entry.sessionId = sessionId;
    entry.waiting = params.waitingForDebugger === true;
    this.sessions.set(sessionId, { targetId: info.targetId });
    this.settle(entry);
    this.deps.onStatusChange();
  }

  private onServerDetach(params: Record<string, unknown>): void {
    const sessionId = params.sessionId;
    if (typeof sessionId !== "string") return;
    if (this.tapAdapter.onDetached(sessionId)) return;
    const rec = this.sessions.get(sessionId);
    this.dropSession(sessionId);
    this.clientScreencasts.delete(sessionId);
    this.agentEmulationSessions.delete(sessionId);
    const entry = rec && !rec.parent ? this.targets.get(rec.targetId) : undefined;
    if (!entry || entry.sessionId !== sessionId) return;
    if (entry.announced) {
      this.sendToCdp({ method: "Target.detachedFromTarget", params: { sessionId, targetId: entry.info.targetId } });
    }
    entry.announced = false;
    entry.sessionId = undefined;
    entry.waiting = false;
    this.deps.onStatusChange();
  }

  private onTargetDestroyed(targetId: string): void {
    const entry = this.targets.get(targetId);
    this.targets.delete(targetId);
    this.createdTargets.delete(targetId);
    this.hidden.forget(targetId);
    for (const [sid, rec] of [...this.sessions]) if (rec.targetId === targetId && !rec.parent) this.dropSession(sid);
    if (entry?.discovered && this.discoveryOn && !entry.hidden) {
      this.sendToCdp({ method: "Target.targetDestroyed", params: { targetId } });
    }
    this.deps.onStatusChange();
  }

  // ── Target table and hidden-ness ───────────────────────────────────────────

  /** Insert/update a target from Chrome info; applies hidden transitions unless `quiet`. */
  private noteTarget(info: TargetInfo, quiet: boolean): TargetEntry {
    let entry = this.targets.get(info.targetId);
    const isNew = entry === undefined;
    if (!entry) {
      entry = {
        info: { ...info },
        hidden: false,
        waiting: false,
        announced: false,
        discovered: false,
        ...(info.type === "page" ? { tabId: this.tabIds.assign(info.targetId) } : {}),
      };
      this.targets.set(info.targetId, entry);
    } else {
      entry.info = { ...info };
    }
    this.evaluate(entry, isNew || quiet);
    return entry;
  }

  private computeHidden(entry: TargetEntry): boolean {
    const id = entry.info.targetId;
    if (this.hidden.isStickyHidden(id)) return true;
    if (isWebUiUrl(entry.info.url)) return true;
    if (this.foreignContext(entry.info)) return true;
    for (const parent of [entry.info.openerId, entry.info.parentFrameId, entry.info.openerFrameId]) {
      if (typeof parent === "string" && parent !== "" && this.isHiddenTarget(parent)) {
        this.hidden.addDerived(id);
        return true;
      }
    }
    return false;
  }

  private isHiddenTarget(targetId: string): boolean {
    return (this.targets.get(targetId)?.hidden ?? false) || this.hidden.isStickyHidden(targetId);
  }

  /** Recompute hidden-ness. `quiet` skips the client notifications of a transition. */
  private evaluate(entry: TargetEntry, quiet: boolean): void {
    const was = entry.hidden;
    entry.hidden = this.computeHidden(entry);
    if (quiet || was === entry.hidden) return;
    if (entry.hidden) {
      // visible → hidden: the client forgets it.
      if (entry.announced && entry.sessionId) {
        this.sendToCdp({ method: "Target.detachedFromTarget", params: { sessionId: entry.sessionId, targetId: entry.info.targetId } });
      }
      entry.announced = false;
      if (entry.discovered && this.discoveryOn) {
        this.sendToCdp({ method: "Target.targetDestroyed", params: { targetId: entry.info.targetId } });
      }
      entry.discovered = false;
      this.resumeIfWaiting(entry);
      this.deps.onStatusChange();
    } else {
      this.settle(entry);
      this.deps.onStatusChange();
    }
  }

  /** Bring a target's client-facing state in line: resume, announce, discover. */
  private settle(entry: TargetEntry): void {
    if (entry.hidden) {
      this.resumeIfWaiting(entry);
      return;
    }
    this.syncDiscovered(entry);
    if (!this.announceAttach(entry, true) && entry.waiting && !entry.announced) this.resumeIfWaiting(entry);
  }

  private syncDiscovered(entry: TargetEntry): void {
    if (!this.discoveryOn || entry.hidden || entry.discovered || CLIENT_HIDDEN_TYPES.has(entry.info.type)) return;
    entry.discovered = true;
    this.sendToCdp({ method: "Target.targetCreated", params: { targetInfo: { ...entry.info, attached: entry.announced } } });
  }

  /**
   * Tell the client about the server's session on `entry`. `viaAutoAttach` obeys
   * the client's auto-attach flag and `waitForDebuggerOnStart`; an explicit
   * `Target.attachToTarget` announces regardless. True when an event was sent.
   */
  private announceAttach(entry: TargetEntry, viaAutoAttach: boolean): boolean {
    if (entry.hidden || entry.announced || entry.sessionId === undefined || CLIENT_HIDDEN_TYPES.has(entry.info.type)) return false;
    if (viaAutoAttach && !this.autoAttach.on) return false;
    const waiting = entry.waiting && viaAutoAttach && this.autoAttach.wait;
    entry.announced = true;
    this.syncDiscovered(entry);
    this.sendToCdp({
      method: "Target.attachedToTarget",
      params: { sessionId: entry.sessionId, targetInfo: { ...entry.info, attached: true }, waitingForDebugger: waiting },
    });
    if (entry.waiting && !waiting) this.resumeIfWaiting(entry);
    return true;
  }

  private resumeIfWaiting(entry: TargetEntry): void {
    if (!entry.waiting || entry.sessionId === undefined) return;
    entry.waiting = false;
    this.fire("Runtime.runIfWaitingForDebugger", undefined, entry.sessionId);
  }

  // ── Session lookups ────────────────────────────────────────────────────────

  /** Is `sessionId` one the CLIENT may address (announced, visible, or a child of one)? */
  private isClientSession(sessionId: string): boolean {
    const rec = this.sessions.get(sessionId);
    if (!rec) return false;
    if (rec.parent) return this.isClientSession(rec.parent);
    const entry = this.targets.get(rec.targetId);
    return entry?.announced === true && entry.sessionId === sessionId && !entry.hidden;
  }

  /** Forget a session and every child session attached under it. */
  private dropSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    for (const [sid, rec] of [...this.sessions]) if (rec.parent === sessionId) this.dropSession(sid);
  }

  private entryForSession(sessionId: string): TargetEntry | undefined {
    const rec = this.sessions.get(sessionId);
    return rec && !rec.parent ? this.targets.get(rec.targetId) : undefined;
  }

  private entryForTab(tabId: number): TargetEntry | undefined {
    const targetId = this.tabIds.targetFor(tabId);
    return targetId === undefined ? undefined : this.targets.get(targetId);
  }

  /** The target the tap may address: visible, with a server session. */
  private visibleSessionTarget(tabId: number): string | undefined {
    const entry = this.entryForTab(tabId);
    return entry && !entry.hidden && entry.sessionId !== undefined ? entry.info.targetId : undefined;
  }

  private clientScreencastActive(tabId: number): boolean {
    const sid = this.entryForTab(tabId)?.sessionId;
    return sid !== undefined && this.clientScreencasts.has(sid);
  }

  private agentEmulationActive(tabId: number): boolean {
    const sid = this.entryForTab(tabId)?.sessionId;
    return sid !== undefined && this.agentEmulationSessions.has(sid);
  }

  // ── Plumbing ───────────────────────────────────────────────────────────────

  private audit(kind: "denied" | "dropped" | "navigate" | "createTarget" | "detach" | "open" | "viewer-subscribe-refused", detail: string): void {
    this.deps.audit.append({ profileDirectory: DEDICATED_PROFILE, instanceId: this.deps.instanceId, kind, detail });
  }

  private sendToCdp(message: Record<string, unknown>): void {
    if (!this.cdp || this.cdp.readyState !== WS_OPEN) return;
    try {
      this.cdp.send(JSON.stringify(message));
    } catch (err) {
      this.deps.logger.warn("[browser-relay] dedicated cdp send failed", err);
    }
  }

  private onCdpClose(): void {
    this.finalize("cdp-closed");
  }

  private onChromeExit(expected: boolean): void {
    if (this.closedReason) return;
    this.chromeGone = true;
    if (!expected) {
      this.audit("detach", "closed:chrome-exited");
      this.finalize("chrome-exited");
    } else {
      this.finalize("chrome-stopped");
    }
  }

  /** Undo the server's browser-level state so the next instance starts clean. */
  private teardownChrome(): void {
    for (const targetId of this.createdTargets) {
      if (!this.hidden.isStickyHidden(targetId)) this.sendRaw("Target.closeTarget", { targetId });
    }
    for (const browserContextId of this.createdContexts) this.sendRaw("Target.disposeBrowserContext", { browserContextId });
    if (this.deps.ephemeralContextId) disposeEphemeralContext(this.chrome, this.deps.ephemeralContextId);
    if (this.started) {
      this.sendRaw("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
      this.sendRaw("Target.setDiscoverTargets", { discover: false });
    }
    for (const sessionId of this.tapAdapter.realSessions()) this.sendRaw("Target.detachFromTarget", { sessionId });
  }

  private finalize(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    this.tap.closeAll(); // sends the stop-screencast commands while the pipe is still ours
    this.tapAdapter.close();
    if (!this.chromeGone) this.teardownChrome();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const pend of this.pending.values()) if (pend.kind === "internal") pend.reject(new Error(`instance closed: ${reason}`));
    this.pending.clear();
    this.held = [];
    if (this.cdp && this.cdp.readyState === WS_OPEN) this.cdp.close(1000, reason);
    this.deps.logger.info(`[browser-relay] dedicated instance ${this.deps.instanceId} close (${reason})`);
    this.deps.onClosed(reason);
  }
}
