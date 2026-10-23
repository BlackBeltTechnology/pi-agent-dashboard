/**
 * Relay manager: guid lifecycle, per-profile instances, connect flow (change:
 * add-browser-relay, tasks 2.4 / 2.8 / 2.9 / 2.10b, design D3).
 *
 * ADDRESSING MODEL — the part worth reading before changing anything:
 *
 *  - A **guid** is 128 bits of randomness minted per connect. It is the socket
 *    CREDENTIAL (it appears in the path of both relay endpoints) and it is never
 *    logged, never persisted, and never sent to a client.
 *  - An **`instanceId`** is a short, non-secret public handle used by the UI and
 *    the audit. It cannot open a socket. Keeping the two separate is what lets
 *    `browser_relay_status` and `GET /api/browser/audit` be broadcast to every
 *    authenticated client without leaking something usable to reach a tab group.
 *  - There is deliberately **no lookup endpoint**. The dashboard has no
 *    per-pi-session identity on REST calls, so "give me my cdpUrl" keyed by
 *    profile could hand one local process another session's tab group. The
 *    caller keeps the `cdpUrl` returned by `connect` for the task's duration.
 *
 * LIFETIME — three independent ends, because each is a real leak otherwise:
 *  1. a minted guid never claimed within the connect timeout (60 s);
 *  2. an instance whose extension socket closes;
 *  3. an instance whose CDP client closes (the agent's task is over), or that
 *     never gets a CDP client within 30 s of the handshake (agent crashed, or
 *     the pi session runs on another host and cannot dial 127.0.0.1).
 * Without (3) a live tab group would sit in the user's Chrome forever.
 */
import crypto from "node:crypto";
import type { AuditRing } from "../audit.js";
import type { DedicatedAvailability } from "../capability.js";
import { buildConnectUrl, openChromeProfile } from "../connect.js";
import { RelayTicketStore, type RelayTicketRole } from "./relay-ticket.js";
import type { DedicatedChrome } from "../dedicated/chrome-process.js";
import { DedicatedChromeError } from "../dedicated/chrome-process.js";
import { checkOpenUrl } from "../dedicated/dedicated-deny.js";
import { DEDICATED_PROFILE, type DedicatedHolder, DedicatedInstance } from "../dedicated/dedicated-instance.js";
import { createEphemeralContext, disposeEphemeralContext } from "../dedicated/ephemeral-context.js";
import { type HiddenTargets, openHiddenTab as openHiddenTabOnPipe } from "../dedicated/hidden-targets.js";
import { pipeCall } from "../dedicated/pipe-call.js";
import { type HostBinding, OperatorHostRegistry, type OperatorHostsDeps, safeHostId } from "../operator-hosts.js";
import type { ProfileSource } from "../profiles.js";
import { type RelaySocket, WS_OPEN } from "./extension-socket.js";
import { FakeRelayInstance } from "./fake-relay-instance.js";
import { LinkSocket } from "./link-socket.js";
import type { RelayInstance, RelayLogger, RelayTabView, RelayTimers } from "./relay-instance.js";
import { RelayInstance as RelayInstanceClass } from "./relay-instance.js";

const CONNECT_TIMEOUT_MS = 60_000;
/** A dedicated instance whose CDP client never attaches closes after this long (D4). */
const DEDICATED_NO_CLIENT_MS = 30_000;
const GUID_EXPIRY_MS = 60_000;
/** Operator consent window (the host's dialog auto-denies at 55 s). */
const CONSENT_TIMEOUT_MS = 60_000;
/** Per-host caps (design D5/D6). */
const MAX_LINKS_PER_HOST = 8;
const MAX_PENDING_PER_HOST = 2;
/** Recently-closed link/request ids remembered so a trailing message is not audited as hostile. */
const RECENTLY_CLOSED_MAX = 32;

/** 32 lowercase hex chars = 128 bits. */
const GUID_PATTERN = /^[0-9a-f]{32}$/;

export function isValidGuid(guid: string): boolean {
  return GUID_PATTERN.test(guid);
}

export interface BrowserProfileConfig {
  token?: string;
  zeroDialog?: boolean;
  allowedDomains?: string[];
}

export interface RelayConfig {
  enabled?: boolean;
  allowMultipleInstancesPerProfile?: boolean;
  defaultBrowser?: string;
  /** Agent-browsing settings (change: add-dedicated-agent-browser, D6). */
  realProfile?: string;
  onUnavailable?: "ask" | "next" | "stop";
  idleDisconnectMinutes?: 0 | 5 | 30 | 120;
  openLiveViewOnConnect?: boolean;
  allowedDomains?: string[];
  browsers?: Record<string, BrowserProfileConfig>;
}

/** The surface the manager needs from an instance (real or fake). */
export interface RelayLike {
  instanceId: string;
  profileDirectory: string;
  tabList(): RelayTabView[];
  statusState(): "connected" | "no-cdp-client";
  /** `"dashboard"` or the operator `hostId`; absent ⇒ `"dashboard"`. */
  readonly host?: string;
  subscribe(viewer: RelaySocket, tabId: number, opts?: { local?: boolean }): { ok: boolean; state?: string };
  unsubscribe(viewer: RelaySocket, tabId: number): void;
  unsubscribeAll(viewer: RelaySocket): void;
  input(viewer: RelaySocket, tabId: number, msg: unknown, remoteAddress?: string): Promise<void>;
  close(reason: string): void;
}

/** `RelayInstance` is structurally a `RelayLike`. */
const REAL_TIMERS: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RelayManagerDeps {
  audit: AuditRing;
  logger: RelayLogger;
  getConfig(): RelayConfig;
  /** The dashboard's own listening port — the extension dials `127.0.0.1:<port>`. */
  getPort(): number;
  canOpenChrome(): boolean;
  listProfiles(): Promise<{ profiles: ProfileSource[]; warning?: string }>;
  /** Injectable opener (tests assert argv without spawning Chrome). */
  openChrome?(profileDirectory: string, url: string): void;
  onStatusChange(): void;
  /** Coalescing status emit for tab title/URL changes. See change: add-browser-editor-pane-tab. */
  onTabMetaChange?(): void;
  /** Fired when an instance is removed (close / expiry). See change: add-browser-editor-pane-tab. */
  onInstanceClosed?(instanceId: string): void;
  /**
   * An AGENT-created tab appeared on a live instance (relay or dedicated): live
   * view on connect. Never fired for hidden sign-in tabs. See change: add-dedicated-agent-browser (D7).
   */
  onAgentTabCreated?(instanceId: string, tabId: number): void;
  timers?: RelayTimers;
  connectTimeoutMs?: number;
  guidExpiryMs?: number;
  randomGuid?(): string;
  randomInstanceId?(): string;
  /** Seed a socket-less fake instance (PI_BROWSER_RELAY_FAKE=1). */
  fake?: boolean;
  /**
   * Operator-host registry wiring (pin file + this server's own instanceId).
   * Without `getServerId` every hello is refused. See change: add-operator-browser-relay.
   */
  operatorHosts?: Pick<OperatorHostsDeps, "pinsPath" | "getServerId" | "now" | "randomNonce">;
  /** Display-only server label sent to the operator (`host:port` as this server knows it). */
  getServerLabel?(): string;
  consentTimeoutMs?: number;
  randomLinkId?(): string;
  randomRequestId?(): string;
  /** Dedicated agent browser (change: add-dedicated-agent-browser). */
  dedicated?: DedicatedDeps;
  /** Injectable ticket store (tests drive the clock). See change: close-container-loopback-impersonation. */
  tickets?: RelayTicketStore;
}

/** Dedicated agent browser wiring (change: add-dedicated-agent-browser, D4). Absent ⇒ dedicated is unavailable. */
export interface DedicatedDeps {
  /** The ONE supervisor of the dashboard-owned Chrome. */
  chrome: DedicatedChrome;
  /** The ONE hidden-target registry, shared by every instance and the standalone open. */
  hidden: HiddenTargets;
  availability(): DedicatedAvailability;
  /** No-CDP-client timer (default 30 s). */
  noClientMs?: number;
}

export type DedicatedFailReason =
  | "disabled"
  | "busy"
  | "no-chrome"
  | "no-display"
  | "profile-in-use"
  | "launch-failed"
  | "owned-by-other-server"
  | "url-denied"
  | "open-failed"
  | "unknown-instance"
  | "unknown-tab";

export type DedicatedConnectResult =
  | { ok: true; cdpUrl: string; instanceId: string }
  | {
      ok: false;
      status: 403 | 409 | 503;
      reason: DedicatedFailReason;
      instanceId?: string;
      /** `busy` only: the holder's `sessionId` (browser_connect) or `client` label (REST). */
      holder?: string;
      message?: string;
    };

export type DedicatedOpenResult =
  | { ok: true; targetId: string }
  | { ok: false; status: 400 | 403 | 409 | 503; reason: DedicatedFailReason; message?: string };

/** Options of `connectDedicated` beyond the holder (change: add-gmail-auto-setup, `browser.dedicated` service). */
export interface DedicatedConnectOptions {
  client?: string;
  holder?: DedicatedHolder;
  /** Close the live holder and register this instance in the same synchronous step. */
  takeover?: boolean;
  /** Tabs excluded from the status composition; viewer subscribe refused. */
  private?: boolean;
  /** Own server-created browser context, discarded with the instance. */
  ephemeral?: boolean;
}

export type DedicatedResetResult = { ok: true } | { ok: false; status: 409; reason: "not-stopped"; message: string };

/** `GET /status` `dedicated` block. */
export interface DedicatedStatusBody {
  available: boolean;
  reason?: "no-chrome" | "no-display";
  state: "not-created" | "stopped" | "starting" | "running";
  dataDir: string;
  downloadsDir: string;
  sizeBytes?: number;
  lastUsed?: number;
  instanceId?: string;
  holder?: DedicatedHolder;
}

export type ConnectResult =
  | { ok: true; cdpUrl: string; instanceId: string }
  | {
      ok: false;
      status: 403 | 404 | 409 | 503 | 504;
      reason?:
        | "not-installed"
        | "busy"
        | "disabled"
        | "unknown-host"
        | "host-busy"
        | "operator-denied"
        | "no-chrome"
        | "launch-failed"
        | "consent-timeout"
        | "host-gone";
      instanceId?: string;
      message?: string;
    };

type ConsentOutcome = { kind: "result"; ok: boolean; reason?: string } | { kind: "timeout" } | { kind: "closed" };

/** The operator-link half of an entry (design D3): the guid never appears on it. */
interface HostLink {
  hostId: string;
  linkId: string;
  requestId: string;
  /** The carrier the connect was sent to — the only socket that may speak for this link. */
  socket: RelaySocket;
  phase: "consent" | "awaiting-open" | "open";
  settleConsent?: (outcome: ConsentOutcome) => void;
  link?: LinkSocket;
  /** True until the connect resolves (counts towards the pending cap). */
  connecting: boolean;
}

interface Entry {
  guid: string;
  instance: RelayLike;
  /** Guid minted for a connect that has not been claimed by an extension yet. */
  claimed: boolean;
  expiryTimer?: unknown;
  hostLink?: HostLink;
  /** Set by the instance's `onClosed` before the entry is removed. */
  closeReason?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A request-supplied token made safe for a one-line log (no newlines, bounded). */
function logToken(raw: string): string {
  return raw.replace(/[^\w.@ -]/g, "_").slice(0, 64);
}

export class RelayManager {
  private readonly deps: RelayManagerDeps;
  private readonly byGuid = new Map<string, Entry>();
  private readonly byInstanceId = new Map<string, Entry>();
  private readonly byLinkId = new Map<string, Entry>();
  private readonly byRequestId = new Map<string, Entry>();
  private readonly recentlyClosed = new Map<string, RelaySocket>();
  /** Operator hosts: identity, pins, bindings (design D2). */
  readonly hosts: OperatorHostRegistry;
  /** Bumped by every `setEnabled(false)`; a connect in flight re-checks it. */
  private disableEpoch = 0;
  /** True once `seedFake()` ran — re-enable must restore the harness instance. */
  private fakeSeeded = false;
  private readonly timers: RelayTimers;
  private readonly connectTimeoutMs: number;
  private readonly guidExpiryMs: number;
  private readonly randomGuid: () => string;
  private readonly randomInstanceId: () => string;
  private readonly openChrome: (profileDirectory: string, url: string) => void;
  private readonly consentTimeoutMs: number;
  private readonly randomLinkId: () => string;
  private readonly randomRequestId: () => string;
  /**
   * Single-use tickets carried by every relay URL this manager issues (`cdpUrl`, the extension's
   * `mcpRelayUrl`). The upgrade handler consumes one before it resolves a guid. In memory only.
   * See change: close-container-loopback-impersonation (D10).
   */
  private readonly tickets: RelayTicketStore;

  constructor(deps: RelayManagerDeps) {
    this.deps = deps;
    this.tickets = deps.tickets ?? new RelayTicketStore();
    this.timers = deps.timers ?? REAL_TIMERS;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.guidExpiryMs = deps.guidExpiryMs ?? GUID_EXPIRY_MS;
    this.randomGuid = deps.randomGuid ?? (() => crypto.randomBytes(16).toString("hex"));
    this.randomInstanceId = deps.randomInstanceId ?? (() => `inst-${crypto.randomBytes(6).toString("hex")}`);
    this.openChrome = deps.openChrome ?? ((profile, url) => openChromeProfile(profile, url));
    this.consentTimeoutMs = deps.consentTimeoutMs ?? CONSENT_TIMEOUT_MS;
    this.randomLinkId = deps.randomLinkId ?? (() => crypto.randomBytes(16).toString("hex"));
    this.randomRequestId = deps.randomRequestId ?? (() => crypto.randomBytes(8).toString("hex"));
    this.hosts = new OperatorHostRegistry({
      pinsPath: deps.operatorHosts?.pinsPath,
      getServerId:
        deps.operatorHosts?.getServerId ?? (() => Promise.reject(new Error("server id unavailable"))),
      now: deps.operatorHosts?.now,
      randomNonce: deps.operatorHosts?.randomNonce,
      audit: deps.audit,
      logger: deps.logger,
      onHostGone: (hostId, socket) => this._onHostGone(hostId, socket),
      hasActivity: (hostId) => this._hostEntries(hostId).length > 0,
    });
    // Chrome's exit ends every server-owned hidden target (they die with it).
    deps.dedicated?.hidden.bindChrome(deps.dedicated.chrome);
  }

  get enabled(): boolean {
    // `enabled` is plugin config and defaults FALSE (kill-switch schema default);
    // the manifest's defaultEnabled is a separate, loader-level switch.
    return this.deps.getConfig().enabled === true;
  }

  profileConfig(profileDirectory: string): BrowserProfileConfig {
    return this.deps.getConfig().browsers?.[profileDirectory] ?? {};
  }

  /** Live instances, optionally narrowed to one profile. */
  instances(profileDirectory?: string): RelayLike[] {
    const all = [...this.byInstanceId.values()].map((e) => e.instance);
    return profileDirectory === undefined
      ? all
      : all.filter((i) => i.profileDirectory === profileDirectory);
  }

  /** Live instances on one host (`"dashboard"` or an operator `hostId`). */
  instancesOn(host: string, profileDirectory?: string): RelayLike[] {
    return this.instances(profileDirectory).filter((i) => (i.host ?? "dashboard") === host);
  }

  find(instanceId: string): RelayLike | undefined {
    return this.byInstanceId.get(instanceId)?.instance;
  }

  /** Resolve a live guid to its instance (used by both relay endpoints). */
  resolve(guid: string): { instance: RelayLike; claimed: boolean; operator: boolean; dedicated: boolean } | undefined {
    if (!isValidGuid(guid)) return undefined;
    const entry = this.byGuid.get(guid);
    return entry
      ? {
          instance: entry.instance,
          claimed: entry.claimed,
          operator: entry.hostLink !== undefined,
          dedicated: entry.instance instanceof DedicatedInstance,
        }
      : undefined;
  }

  /** Mark a guid claimed by its extension socket; false when already claimed. */
  claim(guid: string): boolean {
    const entry = this.byGuid.get(guid);
    if (!entry || entry.claimed) return false;
    entry.claimed = true;
    this._clearExpiry(entry);
    return true;
  }

  /**
   * Mint a guid + instance for `profileDirectory` and open the extension's
   * connect page. Resolves once the extension handshake completes; the caller
   * receives the `cdpUrl` and keeps it.
   */
  async connect(profileDirectory: string, host?: string): Promise<ConnectResult> {
    // Omitted or "dashboard" = today's path, unchanged; anything else targets an operator host.
    if (host !== undefined && host !== "dashboard") return this._connectHost(host, profileDirectory);
    if (!this.enabled) return { ok: false, status: 403, reason: "disabled" };
    // Capture the disable epoch: a concurrent `setEnabled(false)` (or the config
    // write that precedes it) must not be overtaken by a connect already past
    // its first check — otherwise a real Chrome tab group opens on a relay the
    // user just switched off (the kill switch iterates an empty map and reports
    // success before this instance exists). Re-checked after every await.
    const epoch = this.disableEpoch;
    const disabledSince = (): boolean => !this.enabled || this.disableEpoch !== epoch;
    if (!this.deps.canOpenChrome()) {
      return { ok: false, status: 503, message: "This host cannot open a URL in a Chrome profile" };
    }

    const { profiles } = await this.deps.listProfiles();
    if (disabledSince()) return { ok: false, status: 403, reason: "disabled" };
    const profile = profiles.find((p) => p.profileDirectory === profileDirectory);
    if (!profile) {
      return { ok: false, status: 409, reason: "not-installed", message: `Unknown profile ${profileDirectory}` };
    }
    if (!profile.installed) {
      return { ok: false, status: 409, reason: "not-installed" };
    }

    // Busy is keyed (host, profile): an operator's `Default` never collides with ours.
    const existing = this.instancesOn("dashboard", profileDirectory);
    if (existing.length > 0 && !this.deps.getConfig().allowMultipleInstancesPerProfile) {
      return { ok: false, status: 409, reason: "busy", instanceId: existing[0].instanceId };
    }

    const config = this.profileConfig(profileDirectory);
    const guid = this.randomGuid();
    const instanceId = this.randomInstanceId();
    const instance = this._createInstance(instanceId, profileDirectory, config.allowedDomains ?? []);
    const entry: Entry = { guid, instance, claimed: false };
    this.byGuid.set(guid, entry);
    this.byInstanceId.set(instanceId, entry);

    const url = buildConnectUrl({
      port: this.deps.getPort(),
      guid,
      ticket: this.tickets.mint(guid, "ext"),
      profileToken: config.token,
      zeroDialog: config.zeroDialog === true,
    });

    entry.expiryTimer = this.timers.setTimeout(() => {
      // Never claimed: the user never allowed, or the token mismatched.
      this._remove(entry);
    }, this.guidExpiryMs);

    const openedAt = Date.now();
    try {
      this.openChrome(profileDirectory, url);
      this.deps.logger.info(`[browser-relay] instance ${profileDirectory} open (connect)`);
      await this._withTimeout(this._awaitHandshake(entry), this.connectTimeoutMs);
    } catch {
      // Token mismatch, Reject and "never answered" are indistinguishable here
      // (research §7) — one 504, and the guid dies with the attempt.
      entry.instance.close("connect-timeout");
      this._remove(entry);
      return { ok: false, status: 504, message: "Extension did not connect within the timeout" };
    }

    this.deps.logger.info(
      `[browser-relay] instance ${profileDirectory} connected in ${Date.now() - openedAt}ms`,
    );
    return {
      ok: true,
      cdpUrl: this._cdpUrl(guid),
      instanceId,
    };
  }

  /** Close one instance by its public handle. */
  disconnect(instanceId: string): boolean {
    const entry = this.byInstanceId.get(instanceId);
    if (!entry) return false;
    entry.instance.close("disconnect");
    return true;
  }

  /**
   * Kill switch. Resolves only AFTER every instance has closed, so a `PUT
   * {enabled:false}` response is a real guarantee that no tab group is left.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      // The kill switch closes every instance, including the harness Fake. A
      // later live-view scenario re-enables the relay and needs an instance to
      // stream from, so re-seed when one was seeded before (F5 after F3).
      if (this.fakeSeeded && this.instances("Fake").length === 0) {
        this.seedFake();
        this.deps.onStatusChange();
      }
      return;
    }
    this.disableEpoch += 1;
    for (const entry of [...this.byInstanceId.values()]) entry.instance.close("disabled");
    // The dedicated Chrome exits BEFORE the response: `Browser.close`, then the group kill after the grace.
    await this._stopChrome();
  }

  /** Tear everything down (server shutdown / plugin disable). Also asks the dedicated Chrome to exit. */
  closeAll(reason = "shutdown"): void {
    for (const entry of [...this.byInstanceId.values()]) entry.instance.close(reason);
    void this._stopChrome();
  }

  private async _stopChrome(): Promise<void> {
    const chrome = this.deps.dedicated?.chrome;
    if (!chrome) return;
    try {
      await chrome.stop();
    } catch (err) {
      this.deps.logger.warn("[browser-relay] dedicated Chrome stop failed", (err as Error).message);
    }
  }

  // ── Dedicated agent browser (change: add-dedicated-agent-browser, D4/D11) ──

  /** Live global `allowedDomains` (read per command: a settings change applies without reconnecting). */
  private globalAllowedDomains(): readonly string[] {
    const list = this.deps.getConfig().allowedDomains;
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
  }

  /** The live dedicated instance, if any (at most one). */
  liveDedicated(): DedicatedInstance | undefined {
    for (const entry of this.byInstanceId.values()) if (entry.instance instanceof DedicatedInstance) return entry.instance;
    return undefined;
  }

  /** Epoch ms of the last client command / viewer input of a live instance; `undefined` when it keeps none. */
  activityOf(instanceId: string): number | undefined {
    const last = (this.byInstanceId.get(instanceId)?.instance as { lastActivity?: unknown } | undefined)?.lastActivity;
    return typeof last === "number" ? last : undefined;
  }

  /** Map a launch error to a connect/open refusal. */
  private _launchFailure(err: unknown): { status: 409 | 503; reason: DedicatedFailReason; message: string } {
    if (err instanceof DedicatedChromeError) {
      if (err.code === "owned-by-other-server") return { status: 409, reason: "owned-by-other-server", message: err.message };
      if (err.code === "profile-in-use") return { status: 503, reason: "profile-in-use", message: err.message };
      return { status: 503, reason: "launch-failed", message: err.message };
    }
    return { status: 503, reason: "launch-failed", message: "dedicated Chrome failed to start" };
  }

  /** Availability + enabled gate shared by connect and open. */
  private _dedicatedGate(): { ok: true; ded: DedicatedDeps } | { ok: false; status: 403 | 503; reason: DedicatedFailReason } {
    if (!this.enabled) return { ok: false, status: 403, reason: "disabled" };
    const ded = this.deps.dedicated;
    if (!ded) return { ok: false, status: 503, reason: "no-chrome" };
    const av = ded.availability();
    if (!av.available) return { ok: false, status: 503, reason: av.reason ?? "no-chrome" };
    return { ok: true, ded };
  }

  /** `holder` as the 409 body names it. */
  private static _holderLabel(holder: DedicatedHolder | undefined): string | undefined {
    return holder?.sessionId ?? holder?.client;
  }

  /** The 409 `busy` refusal naming the live holder. */
  private static _busy(live: DedicatedInstance): DedicatedConnectResult {
    const holder = RelayManager._holderLabel(live.holder);
    return { ok: false, status: 409, reason: "busy", instanceId: live.instanceId, ...(holder ? { holder } : {}) };
  }

  /** Synchronous: `busy` while another instance holds the slot, unless `takeover` — then close that holder and report free. */
  private _claimSlot(takeover: boolean | undefined): DedicatedConnectResult | undefined {
    const live = this.liveDedicated();
    if (!live) return undefined;
    if (!takeover) return RelayManager._busy(live);
    live.closeWithDetach("takeover");
    return undefined;
  }

  /** Server-created ephemeral context of an ephemeral connect (create + per-context downloads dir). */
  private async _createContext(ded: DedicatedDeps): Promise<{ ok: true; id: string } | { ok: false; refusal: DedicatedConnectResult }> {
    try {
      return { ok: true, id: await createEphemeralContext(ded.chrome, ded.chrome.downloadsDir) };
    } catch (err) {
      this.deps.logger.warn("[browser-relay] dedicated connect refused reason=launch-failed (context)", (err as Error).message);
      return { ok: false, refusal: { ok: false, status: 503, reason: "launch-failed", message: "could not create the browser context" } };
    }
  }

  /**
   * Mint a dedicated instance: ensure Chrome (single-flight), register under
   * `@dedicated`, start the 30 s no-client timer. No handshake — the agent's CDP
   * client dials `cdpUrl` itself.
   */
  async connectDedicated(opts: DedicatedConnectOptions = {}): Promise<DedicatedConnectResult> {
    const gate = this._dedicatedGate();
    if (!gate.ok) return gate;
    const ded = gate.ded;
    // Same epoch rule as `connect()`: a kill switch that completed while Chrome
    // was starting must not be overtaken by this connect.
    const epoch = this.disableEpoch;
    const disabledSince = (): boolean => !this.enabled || this.disableEpoch !== epoch;

    const early = this.liveDedicated();
    if (early && !opts.takeover) return RelayManager._busy(early);

    try {
      await ded.chrome.ensureRunning();
    } catch (err) {
      if (disabledSince()) return { ok: false, status: 403, reason: "disabled" };
      const f = this._launchFailure(err);
      this.deps.logger.warn(`[browser-relay] dedicated connect refused reason=${f.reason}`);
      return { ok: false, ...f };
    }
    // The ephemeral context is created BEFORE the holder is touched: a failure here must not cost a takeover its victim.
    const context = opts.ephemeral ? await this._createContext(ded) : undefined;
    if (context && !context.ok) return context.refusal;
    const ephemeralContextId = context?.id;
    const discardContext = (): void => {
      if (ephemeralContextId) disposeEphemeralContext(ded.chrome, ephemeralContextId);
    };
    if (disabledSince()) {
      discardContext();
      await this._stopChrome();
      return { ok: false, status: 403, reason: "disabled" };
    }
    // From here to the registration below there is NO await: a takeover closes the holder and registers
    // the new instance in one synchronous step, so a reconnect fired by the close (or any other connect)
    // sees the new holder, never a free slot. A concurrent connect may also have registered while Chrome started.
    const refused = this._claimSlot(opts.takeover);
    if (refused) {
      discardContext();
      return refused;
    }

    const holder: DedicatedHolder | undefined =
      opts.holder ?? (opts.client !== undefined ? { client: opts.client } : undefined);
    const guid = this.randomGuid();
    const instanceId = this.randomInstanceId();
    const instance = new DedicatedInstance({
      instanceId,
      chrome: ded.chrome,
      hidden: ded.hidden,
      globalAllowedDomains: () => this.globalAllowedDomains(),
      audit: this.deps.audit,
      logger: this.deps.logger,
      timers: this.timers,
      holder,
      private: opts.private,
      ephemeralContextId,
      onClosed: (reason) => {
        const entry = this.byInstanceId.get(instanceId);
        if (!entry) return;
        entry.closeReason = reason;
        this._remove(entry);
      },
      onStatusChange: () => this.deps.onStatusChange(),
      onTabMetaChange: () => (this.deps.onTabMetaChange ?? this.deps.onStatusChange)(),
      onAgentTabCreated: (tabId) => this.deps.onAgentTabCreated?.(instanceId, tabId),
    });
    const entry: Entry = { guid, instance, claimed: true };
    this.byGuid.set(guid, entry);
    this.byInstanceId.set(instanceId, entry);
    // Chrome stays up when the instance dies; only the slot is released.
    entry.expiryTimer = this.timers.setTimeout(() => {
      entry.expiryTimer = undefined;
      if (!instance.hasCdpClient) instance.closeWithDetach("no-cdp-client");
    }, ded.noClientMs ?? DEDICATED_NO_CLIENT_MS);
    this.deps.onStatusChange();
    this.deps.logger.info(`[browser-relay] instance ${DEDICATED_PROFILE} open (dedicated connect)`);
    return { ok: true, cdpUrl: this._cdpUrl(guid), instanceId };
  }

  /**
   * `dedicated/open`: a hidden, server-owned tab (sign-in window). `https:` only
   * and the effective allowed domains, else 400 before anything starts.
   */
  async openDedicated(url: string, instanceId?: string): Promise<DedicatedOpenResult> {
    const gate = this._dedicatedGate();
    if (!gate.ok) return gate;
    const ded = gate.ded;
    const check = checkOpenUrl(url, this.globalAllowedDomains());
    if (!check.ok) return { ok: false, status: 400, reason: "url-denied", message: check.reason };
    // With an `instanceId` the tab opens in THAT instance's context: no such live instance → refuse before launching.
    const unknownInstance = (): DedicatedOpenResult | undefined =>
      instanceId !== undefined && this.liveDedicated()?.instanceId !== instanceId
        ? { ok: false, status: 409, reason: "unknown-instance" }
        : undefined;
    const missing = unknownInstance();
    if (missing) return missing;
    const epoch = this.disableEpoch;
    const disabledSince = (): boolean => !this.enabled || this.disableEpoch !== epoch;

    try {
      await ded.chrome.ensureRunning();
    } catch (err) {
      if (disabledSince()) return { ok: false, status: 403, reason: "disabled" };
      const f = this._launchFailure(err);
      return { ok: false, ...f };
    }
    if (disabledSince()) {
      await this._stopChrome();
      return { ok: false, status: 403, reason: "disabled" };
    }
    const gone = unknownInstance();
    if (gone) return gone;
    try {
      const live = this.liveDedicated();
      if (live) return { ok: true, ...(await live.openHiddenTab(url)) }; // audits `open`, stamps lastUsed
      ded.chrome.touch();
      const opened = await openHiddenTabOnPipe(ded.chrome, ded.hidden, url);
      // No instance to audit through: the open is audited here, exactly once.
      this.deps.audit.append({ profileDirectory: DEDICATED_PROFILE, instanceId: "dedicated", kind: "open", detail: url });
      return { ok: true, ...opened };
    } catch (err) {
      this.deps.logger.warn("[browser-relay] dedicated open failed", (err as Error).message);
      return { ok: false, status: 503, reason: "open-failed", message: "could not open the sign-in tab" };
    }
  }

  /** Origin (never path/query) of a server-owned hidden tab; `null` when it is closed, unknown or Chrome is down. */
  async dedicatedTabOrigin(tabId: string): Promise<string | null> {
    const ded = this.deps.dedicated;
    if (!this.enabled || !ded || ded.chrome.state() !== "running" || !ded.hidden.isOwned(tabId)) return null;
    try {
      const res = (await pipeCall(ded.chrome, "Target.getTargetInfo", { targetId: tabId })) as { targetInfo?: { url?: unknown } } | undefined;
      const url = res?.targetInfo?.url;
      const origin = typeof url === "string" ? new URL(url).origin : "null";
      return origin === "null" ? null : origin;
    } catch {
      return null; // Chrome answers an error for a closed target
    }
  }

  /** Bring a server-owned hidden tab to the front. */
  async focusDedicatedTab(tabId: string): Promise<{ ok: true } | { ok: false; status: 403 | 404; reason: DedicatedFailReason }> {
    const ded = this.deps.dedicated;
    if (!this.enabled) return { ok: false, status: 403, reason: "disabled" };
    if (ded?.chrome.state() !== "running" || !ded.hidden.isOwned(tabId)) return { ok: false, status: 404, reason: "unknown-tab" };
    try {
      await pipeCall(ded.chrome, "Target.activateTarget", { targetId: tabId });
      return { ok: true };
    } catch {
      return { ok: false, status: 404, reason: "unknown-tab" };
    }
  }

  /** `dedicated/stop`: close the live instance, then the Chrome (graceful, 5 s, group kill). */
  async stopDedicated(): Promise<void> {
    this.liveDedicated()?.close("dedicated-stop");
    await this._stopChrome();
  }

  /** `dedicated/reset`: delete the profile; only while Chrome is stopped. */
  async resetDedicated(): Promise<DedicatedResetResult> {
    const chrome = this.deps.dedicated?.chrome;
    if (!chrome) return { ok: true };
    if (this.liveDedicated()) return { ok: false, status: 409, reason: "not-stopped", message: "stop the dedicated browser first" };
    try {
      await chrome.reset();
      return { ok: true };
    } catch (err) {
      if (err instanceof DedicatedChromeError && err.code === "not-stopped") {
        return { ok: false, status: 409, reason: "not-stopped", message: err.message };
      }
      throw err;
    }
  }

  /** The `GET /status` `dedicated` block; `undefined` when the plugin has no dedicated wiring. */
  async dedicatedStatus(): Promise<DedicatedStatusBody | undefined> {
    const ded = this.deps.dedicated;
    if (!ded) return undefined;
    const av = ded.availability();
    const live = this.liveDedicated();
    const sizeBytes = await ded.chrome.sizeBytes();
    const lastUsed = ded.chrome.lastUsed;
    return {
      available: av.available,
      ...(av.reason ? { reason: av.reason } : {}),
      state: ded.chrome.state(),
      dataDir: ded.chrome.dataDir,
      downloadsDir: ded.chrome.downloadsDir,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(lastUsed !== undefined ? { lastUsed } : {}),
      ...(live ? { instanceId: live.instanceId } : {}),
      ...(live?.holder ? { holder: { ...live.holder } } : {}),
    };
  }

  /** The slice of dedicated status the `browser_connect` policy reads (sync, no I/O). */
  dedicatedPolicyStatus(): { available: boolean; reason?: string; instanceId?: string; holder?: string } {
    if (!this.enabled) return { available: false, reason: "disabled" };
    const ded = this.deps.dedicated;
    if (!ded) return { available: false, reason: "no-chrome" };
    const av = ded.availability();
    const live = this.liveDedicated();
    return {
      available: av.available,
      ...(av.reason ? { reason: av.reason } : {}),
      ...(live ? { instanceId: live.instanceId } : {}),
      ...(live?.holder?.sessionId ? { holder: live.holder.sessionId } : {}),
    };
  }

  /** Seed the test-only fake instance (PI_BROWSER_RELAY_FAKE=1). */
  seedFake(): RelayLike {
    const instance = new FakeRelayInstance({
      instanceId: this.randomInstanceId(),
      profileDirectory: "Fake",
      audit: this.deps.audit,
      logger: this.deps.logger,
      timers: this.timers,
      onClosed: () => {
        const entry = this.byInstanceId.get(instance.instanceId);
        if (entry) this._remove(entry);
      },
    });
    const entry: Entry = { guid: this.randomGuid(), instance, claimed: true };
    this.byGuid.set(entry.guid, entry);
    this.byInstanceId.set(instance.instanceId, entry);
    this.fakeSeeded = true;
    return instance;
  }

  private _createInstance(
    instanceId: string,
    profileDirectory: string,
    allowedDomains: readonly string[],
    operator?: { hostId: string; linkId: string; carrier: RelaySocket },
  ): RelayLike {
    return new RelayInstanceClass({
      instanceId,
      profileDirectory,
      allowedDomains,
      globalAllowedDomains: () => this.globalAllowedDomains(),
      audit: this.deps.audit,
      logger: this.deps.logger,
      timers: this.timers,
      operator,
      onAgentTabCreated: (tabId) => this.deps.onAgentTabCreated?.(instanceId, tabId),
      onClosed: (reason) => {
        const entry = this.byInstanceId.get(instanceId);
        if (!entry) return;
        entry.closeReason = reason;
        this._remove(entry);
      },
      onStatusChange: () => this.deps.onStatusChange(),
      onTabMetaChange: () => (this.deps.onTabMetaChange ?? this.deps.onStatusChange)(),
    });
  }

  private _awaitHandshake(entry: Entry): Promise<void> {
    const instance = entry.instance;
    if (!(instance instanceof RelayInstanceClass)) return Promise.resolve();
    return instance.waitForHandshake();
  }

  private _withTimeout(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const handle = this.timers.setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        () => {
          this.timers.clearTimeout(handle);
          resolve();
        },
        (err: Error) => {
          this.timers.clearTimeout(handle);
          reject(err);
        },
      );
    });
  }

  private _clearExpiry(entry: Entry): void {
    if (entry.expiryTimer !== undefined) {
      this.timers.clearTimeout(entry.expiryTimer);
      entry.expiryTimer = undefined;
    }
  }

  /** `ws://…/ws/browser-cdp/<guid>?ticket=<single-use>`: the URL a CDP client dials exactly once. */
  private _cdpUrl(guid: string): string {
    return `ws://127.0.0.1:${this.deps.getPort()}/ws/browser-cdp/${guid}?ticket=${this.tickets.mint(guid, "cdp")}`;
  }

  /**
   * Consume the single-use ticket for (guid, role). True exactly once for the value this manager issued;
   * checked by the upgrade handler BEFORE it resolves the guid, so an unknown guid and a bad ticket are
   * the same refusal. See change: close-container-loopback-impersonation (D10).
   */
  consumeTicket(guid: string, role: RelayTicketRole, ticket: string | null | undefined): boolean {
    return this.tickets.consume(guid, role, ticket);
  }

  private _remove(entry: Entry): void {
    this.tickets.revoke(entry.guid);
    this._clearExpiry(entry);
    this.byGuid.delete(entry.guid);
    this.byInstanceId.delete(entry.instance.instanceId);
    const hl = entry.hostLink;
    if (hl) {
      this.byLinkId.delete(hl.linkId);
      this.byRequestId.delete(hl.requestId);
      this._rememberClosed(hl.linkId, hl.socket);
      this._rememberClosed(hl.requestId, hl.socket);
      hl.settleConsent?.({ kind: "closed" });
      if (hl.phase === "open") {
        this.deps.logger.info(
          `[browser-host] link close host=${hl.hostId} reason=${logToken(entry.closeReason ?? "closed")}`,
        );
      }
    }
    this.deps.onInstanceClosed?.(entry.instance.instanceId);
    this.deps.onStatusChange();
  }

  /** Attach an already-upgraded extension socket for a live guid. */
  attachExtension(guid: string, ws: RelaySocket): boolean {
    const entry = this.byGuid.get(guid);
    if (!entry) return false;
    // An operator guid is never dialled directly: its extension arrives as a
    // link over the carrier (`browser_host_ext_open`), never on this endpoint.
    if (entry.hostLink) return false;
    if (entry.claimed) {
      // Spec: a second extension socket on a claimed guid is closed 1000 with
      // the upstream reason, so the extension's own error text is preserved.
      ws.close(1000, "Another extension connection already established");
      return true;
    }
    this.claim(guid);
    (entry.instance as RelayInstance).attachExtension(ws);
    return true;
  }

  // ── Operator hosts (change: add-operator-browser-relay, design D3–D6) ──────

  private _hostEntries(hostId: string): Entry[] {
    return [...this.byInstanceId.values()].filter((e) => e.hostLink?.hostId === hostId);
  }

  private _sendCarrier(socket: RelaySocket, msg: Record<string, unknown>): void {
    if (socket.readyState !== WS_OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* carrier died mid-send: its close handler finishes the teardown */
    }
  }

  private _rememberClosed(id: string, socket: RelaySocket): void {
    this.recentlyClosed.set(id, socket);
    if (this.recentlyClosed.size > RECENTLY_CLOSED_MAX) {
      const oldest = this.recentlyClosed.keys().next().value;
      if (oldest !== undefined) this.recentlyClosed.delete(oldest);
    }
  }

  /** The carrier closed: every instance hosted through it ends, pending connects fail `host-gone`. */
  private _onHostGone(hostId: string, socket: RelaySocket): void {
    for (const entry of this._hostEntries(hostId)) {
      if (entry.hostLink?.socket === socket) entry.instance.close("host-gone");
    }
  }

  /** The D6 checks that need no I/O: host bound, profile offered + installed, not busy, under the caps. */
  private _hostPreflight(
    hostId: string,
    profileDirectory: string,
  ):
    | { ok: true; binding: HostBinding }
    | { ok: false; status: 404 | 409; reason: "unknown-host" | "not-installed" | "busy" | "host-busy"; instanceId?: string } {
    const binding = this.hosts.get(hostId);
    if (!binding) return { ok: false, status: 404, reason: "unknown-host" };
    const row = binding.profiles.find((p) => p.profileDirectory === profileDirectory);
    if (!row?.installed) return { ok: false, status: 409, reason: "not-installed" };

    const onHost = this._hostEntries(hostId);
    const sameProfile = onHost.find((e) => e.instance.profileDirectory === profileDirectory);
    if (sameProfile) {
      // A live instance names itself; a pending connect has no public instance yet.
      const instanceId = sameProfile.hostLink?.connecting ? undefined : sameProfile.instance.instanceId;
      return { ok: false, status: 409, reason: "busy", ...(instanceId ? { instanceId } : {}) };
    }
    const pending = onHost.filter((e) => e.hostLink?.connecting).length;
    if (onHost.length - pending >= MAX_LINKS_PER_HOST || pending >= MAX_PENDING_PER_HOST) {
      return { ok: false, status: 409, reason: "host-busy" };
    }
    return { ok: true, binding };
  }

  /**
   * Host-targeted connect (D6). Resolves per the outcome table; every call
   * logs exactly one `[browser-host] connect` line. No guid/linkId/nonce ever
   * reaches a log, the audit, a body or a message to any client.
   */
  private async _connectHost(hostId: string, profileDirectory: string): Promise<ConnectResult> {
    const startedAt = Date.now();
    const finish = (r: ConnectResult): ConnectResult => {
      const outcome = r.ok ? "200" : (r.reason ?? String(r.status));
      this.deps.logger.info(
        `[browser-host] connect host=${safeHostId(hostId)} profile=${logToken(profileDirectory)} outcome=${outcome} ms=${Date.now() - startedAt}`,
      );
      return r;
    };
    const refuse = (
      status: 403 | 404 | 409 | 503 | 504,
      reason: NonNullable<Extract<ConnectResult, { ok: false }>["reason"]>,
      instanceId?: string,
    ): ConnectResult => finish({ ok: false, status, reason, ...(instanceId ? { instanceId } : {}) });

    if (!this.enabled) return refuse(403, "disabled");
    const epoch = this.disableEpoch;
    const disabledSince = (): boolean => !this.enabled || this.disableEpoch !== epoch;

    const preflight = this._hostPreflight(hostId, profileDirectory);
    if (!preflight.ok) return refuse(preflight.status, preflight.reason, preflight.instanceId);
    const binding = preflight.binding;

    const guid = this.randomGuid();
    const linkId = this.randomLinkId();
    const requestId = this.randomRequestId();
    const instanceId = this.randomInstanceId();
    // Operator instances get the relay deny-list only — never the server's
    // per-profile `allowedDomains` / token / zeroDialog (those are dashboard-host config).
    const instance = this._createInstance(instanceId, profileDirectory, [], {
      hostId,
      linkId,
      carrier: binding.socket,
    });
    const hl: HostLink = {
      hostId,
      linkId,
      requestId,
      socket: binding.socket,
      phase: "consent",
      connecting: true,
    };
    const entry: Entry = { guid, instance, claimed: false, hostLink: hl };
    this.byGuid.set(guid, entry);
    this.byInstanceId.set(instanceId, entry);
    this.byLinkId.set(linkId, entry);
    this.byRequestId.set(requestId, entry);

    this._sendCarrier(binding.socket, {
      type: "browser_host_connect",
      requestId,
      linkId,
      instanceId,
      profileDirectory,
      serverLabel: this.deps.getServerLabel?.() ?? `127.0.0.1:${this.deps.getPort()}`,
    });

    /** Abandon: tell the host (D4), end the instance, drop the link. */
    const abandon = (closeReason: string): void => {
      this._sendCarrier(binding.socket, { type: "browser_host_connect_cancel", requestId });
      hl.connecting = false;
      entry.instance.close(closeReason);
    };
    const closedOutcome = (): ConnectResult => {
      if (entry.closeReason === "host-gone") return refuse(503, "host-gone");
      if (entry.closeReason === "disabled" || disabledSince()) return refuse(403, "disabled");
      return refuse(503, "launch-failed");
    };

    // 1. Consent window: S waits up to 60 s for the operator's answer.
    const consent = await new Promise<ConsentOutcome>((resolve) => {
      let timer: unknown;
      hl.settleConsent = (outcome) => {
        if (!hl.settleConsent) return;
        hl.settleConsent = undefined;
        this.timers.clearTimeout(timer);
        resolve(outcome);
      };
      timer = this.timers.setTimeout(() => hl.settleConsent?.({ kind: "timeout" }), this.consentTimeoutMs);
    });
    if (consent.kind === "closed") return closedOutcome();
    if (consent.kind === "timeout") {
      abandon("consent-timeout");
      return refuse(504, "consent-timeout");
    }
    if (!consent.ok) {
      abandon("operator-denied");
      if (consent.reason === "denied") return refuse(403, "operator-denied");
      if (consent.reason === "no-chrome") return refuse(503, "no-chrome");
      return refuse(503, "launch-failed");
    }
    if (disabledSince()) {
      abandon("disabled");
      return refuse(403, "disabled");
    }

    // 2. Handshake window: starts at `ok:true`, not at the request.
    try {
      await this._withTimeout(this._awaitHandshake(entry), this.connectTimeoutMs);
    } catch {
      if (entry.closeReason !== undefined) return closedOutcome();
      abandon("connect-timeout");
      return finish({ ok: false, status: 504, message: "Extension did not connect within the timeout" });
    }
    hl.connecting = false;
    return finish({
      ok: true,
      cdpUrl: this._cdpUrl(guid),
      instanceId,
    });
  }

  /** Browser→server `browser_host_*` messages (registered on the gateway by `status.ts`). */
  handleHostMessage(msg: unknown, ws: RelaySocket): void {
    if (!isRecord(msg) || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "browser_host_hello":
      case "browser_host_register":
        this.hosts.handle(msg, ws).catch(() => this.hosts.denied(undefined, "browser_host:register"));
        return;
      case "browser_host_connect_result":
        this._onConnectResult(msg, ws);
        return;
      case "browser_host_ext_open":
        this._onExtOpen(msg, ws);
        return;
      case "browser_host_ext_data":
        this._onExtData(msg, ws);
        return;
      case "browser_host_ext_close":
        this._onExtClose(msg, ws);
        return;
      default:
        this._dropHostMessage(ws, msg.type);
    }
  }

  /**
   * Drop + audit a `browser_host_*` message under `host:<hostId>` (the link's
   * owner when known, else the sender's host). `detail` carries the TYPE only —
   * never an id, so a hostile sender cannot plant a linkId/requestId in the audit.
   */
  private _dropHostMessage(ws: RelaySocket, type: string, entry?: Entry): void {
    const hostId = entry?.hostLink?.hostId ?? this.hosts.hostOfSocket(ws);
    this.hosts.denied(hostId, `browser_host:${type.replace(/^browser_host_/, "").slice(0, 32)}`, entry?.instance.instanceId);
  }

  /** The entry for `id` iff `ws` owns it; otherwise drop + audit (D3). */
  private _owned(
    map: Map<string, Entry>,
    id: unknown,
    ws: RelaySocket,
    type: string,
    quietTail: boolean,
  ): Entry | undefined {
    const entry = typeof id === "string" ? map.get(id) : undefined;
    if (entry?.hostLink && entry.hostLink.socket === ws) return entry;
    // A trailing ext_data/ext_close/result for a link the server just closed or
    // abandoned is expected from its own owner — drop it without calling it hostile.
    if (quietTail && typeof id === "string" && this.recentlyClosed.get(id) === ws) return undefined;
    this._dropHostMessage(ws, type, entry);
    return undefined;
  }

  private _onConnectResult(msg: Record<string, unknown>, ws: RelaySocket): void {
    const entry = this._owned(this.byRequestId, msg.requestId, ws, "browser_host_connect_result", true);
    const hl = entry?.hostLink;
    if (!entry || !hl) return;
    if (hl.phase !== "consent" || typeof msg.ok !== "boolean") {
      this._dropHostMessage(ws, "browser_host_connect_result", entry);
      return;
    }
    // Move to `awaiting-open` synchronously: `ws` can deliver `connect_result` and
    // the following `ext_open` in the same tick, before `_connectHost` resumes.
    if (msg.ok) hl.phase = "awaiting-open";
    hl.settleConsent?.({
      kind: "result",
      ok: msg.ok,
      ...(typeof msg.reason === "string" ? { reason: msg.reason } : {}),
    });
  }

  private _onExtOpen(msg: Record<string, unknown>, ws: RelaySocket): void {
    const entry = this._owned(this.byLinkId, msg.linkId, ws, "browser_host_ext_open", false);
    const hl = entry?.hostLink;
    if (!entry || !hl) return;
    // Only after `connect_result {ok:true}`, and only once.
    if (hl.phase !== "awaiting-open" || hl.link) {
      this._dropHostMessage(ws, "browser_host_ext_open", entry);
      return;
    }
    const link = new LinkSocket({ linkId: hl.linkId, carrier: ws, timers: this.timers });
    hl.link = link;
    hl.phase = "open";
    entry.claimed = true;
    (entry.instance as RelayInstance).attachExtension(link);
  }

  private _onExtData(msg: Record<string, unknown>, ws: RelaySocket): void {
    const entry = this._owned(this.byLinkId, msg.linkId, ws, "browser_host_ext_data", true);
    const link = entry?.hostLink?.link;
    if (!entry || !link) {
      if (entry) this._dropHostMessage(ws, "browser_host_ext_data", entry);
      return;
    }
    if (typeof msg.data !== "string") {
      this._dropHostMessage(ws, "browser_host_ext_data", entry);
      return;
    }
    link.feed(msg.data);
  }

  private _onExtClose(msg: Record<string, unknown>, ws: RelaySocket): void {
    const entry = this._owned(this.byLinkId, msg.linkId, ws, "browser_host_ext_close", true);
    const link = entry?.hostLink?.link;
    if (!entry || !link) {
      if (entry) this._dropHostMessage(ws, "browser_host_ext_close", entry);
      return;
    }
    link.remoteClose(typeof msg.code === "number" ? msg.code : 1006);
  }

  /** Attach an already-upgraded CDP client socket for a live guid. */
  attachCdp(guid: string, ws: RelaySocket): boolean {
    const entry = this.byGuid.get(guid);
    if (!entry) return false;
    (entry.instance as RelayInstance).attachCdp(ws);
    return true;
  }

  /** True while a connect is awaiting its extension handshake. */
  isAwaitingHandshake(instanceId: string): boolean {
    const entry = this.byInstanceId.get(instanceId);
    return entry !== undefined && !entry.claimed;
  }
}
