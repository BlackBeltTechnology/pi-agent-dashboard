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
import { buildConnectUrl, openChromeProfile } from "../connect.js";
import type { ProfileSource } from "../profiles.js";
import type { RelaySocket } from "./extension-socket.js";
import { FakeRelayInstance } from "./fake-relay-instance.js";
import type { RelayInstance, RelayLogger, RelayTabView, RelayTimers } from "./relay-instance.js";
import { RelayInstance as RelayInstanceClass } from "./relay-instance.js";

const CONNECT_TIMEOUT_MS = 60_000;
const GUID_EXPIRY_MS = 60_000;

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
  browsers?: Record<string, BrowserProfileConfig>;
}

/** The surface the manager needs from an instance (real or fake). */
export interface RelayLike {
  instanceId: string;
  profileDirectory: string;
  tabList(): RelayTabView[];
  statusState(): "connected" | "no-cdp-client";
  subscribe(viewer: RelaySocket, tabId: number): { ok: boolean; state?: string };
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
  timers?: RelayTimers;
  connectTimeoutMs?: number;
  guidExpiryMs?: number;
  randomGuid?(): string;
  randomInstanceId?(): string;
  /** Seed a socket-less fake instance (PI_BROWSER_RELAY_FAKE=1). */
  fake?: boolean;
}

export type ConnectResult =
  | { ok: true; cdpUrl: string; instanceId: string }
  | {
      ok: false;
      status: 403 | 409 | 503 | 504;
      reason?: "not-installed" | "busy" | "disabled";
      instanceId?: string;
      message?: string;
    };

interface Entry {
  guid: string;
  instance: RelayLike;
  /** Guid minted for a connect that has not been claimed by an extension yet. */
  claimed: boolean;
  expiryTimer?: unknown;
}

export class RelayManager {
  private readonly byGuid = new Map<string, Entry>();
  private readonly byInstanceId = new Map<string, Entry>();
  private readonly timers: RelayTimers;
  private readonly connectTimeoutMs: number;
  private readonly guidExpiryMs: number;
  private readonly randomGuid: () => string;
  private readonly randomInstanceId: () => string;
  private readonly openChrome: (profileDirectory: string, url: string) => void;

  constructor(private readonly deps: RelayManagerDeps) {
    this.timers = deps.timers ?? REAL_TIMERS;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.guidExpiryMs = deps.guidExpiryMs ?? GUID_EXPIRY_MS;
    this.randomGuid = deps.randomGuid ?? (() => crypto.randomBytes(16).toString("hex"));
    this.randomInstanceId = deps.randomInstanceId ?? (() => `inst-${crypto.randomBytes(6).toString("hex")}`);
    this.openChrome = deps.openChrome ?? ((profile, url) => openChromeProfile(profile, url));
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

  find(instanceId: string): RelayLike | undefined {
    return this.byInstanceId.get(instanceId)?.instance;
  }

  /** Resolve a live guid to its instance (used by both relay endpoints). */
  resolve(guid: string): { instance: RelayLike; claimed: boolean } | undefined {
    if (!isValidGuid(guid)) return undefined;
    const entry = this.byGuid.get(guid);
    return entry ? { instance: entry.instance, claimed: entry.claimed } : undefined;
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
  async connect(profileDirectory: string): Promise<ConnectResult> {
    if (!this.enabled) return { ok: false, status: 403, reason: "disabled" };
    if (!this.deps.canOpenChrome()) {
      return { ok: false, status: 503, message: "This host cannot open a URL in a Chrome profile" };
    }

    const { profiles } = await this.deps.listProfiles();
    const profile = profiles.find((p) => p.profileDirectory === profileDirectory);
    if (!profile) {
      return { ok: false, status: 409, reason: "not-installed", message: `Unknown profile ${profileDirectory}` };
    }
    if (!profile.installed) {
      return { ok: false, status: 409, reason: "not-installed" };
    }

    const existing = this.instances(profileDirectory);
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
      cdpUrl: `ws://127.0.0.1:${this.deps.getPort()}/ws/browser-cdp/${guid}`,
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
    if (enabled) return;
    for (const entry of [...this.byInstanceId.values()]) entry.instance.close("disabled");
  }

  /** Tear everything down (server shutdown / plugin disable). */
  closeAll(reason = "shutdown"): void {
    for (const entry of [...this.byInstanceId.values()]) entry.instance.close(reason);
  }

  /** Seed the test-only fake instance (PI_BROWSER_RELAY_FAKE=1). */
  seedFake(): RelayLike {
    const instance = new FakeRelayInstance({
      instanceId: this.randomInstanceId(),
      profileDirectory: "Fake",
      audit: this.deps.audit,
      logger: this.deps.logger,
      timers: this.timers,
    });
    const entry: Entry = { guid: this.randomGuid(), instance, claimed: true };
    this.byGuid.set(entry.guid, entry);
    this.byInstanceId.set(instance.instanceId, entry);
    return instance;
  }

  private _createInstance(
    instanceId: string,
    profileDirectory: string,
    allowedDomains: readonly string[],
  ): RelayLike {
    return new RelayInstanceClass({
      instanceId,
      profileDirectory,
      allowedDomains,
      audit: this.deps.audit,
      logger: this.deps.logger,
      timers: this.timers,
      onClosed: () => {
        const entry = this.byInstanceId.get(instanceId);
        if (entry) this._remove(entry);
      },
      onStatusChange: () => this.deps.onStatusChange(),
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

  private _remove(entry: Entry): void {
    this._clearExpiry(entry);
    this.byGuid.delete(entry.guid);
    this.byInstanceId.delete(entry.instance.instanceId);
    this.deps.onStatusChange();
  }

  /** Attach an already-upgraded extension socket for a live guid. */
  attachExtension(guid: string, ws: RelaySocket): boolean {
    const entry = this.byGuid.get(guid);
    if (!entry) return false;
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
