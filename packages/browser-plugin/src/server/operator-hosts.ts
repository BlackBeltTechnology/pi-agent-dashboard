/**
 * Operator host registry (change: add-operator-browser-relay, task 7.1;
 * design D2, D10b, D11).
 *
 * An operator machine's Electron main registers as a *host* through the
 * dashboard SPA's own authenticated `/ws` (the "carrier"):
 *
 *   hello {hostId, publicKey}
 *     → challenge {nonce, serverId}        (32 random bytes + OUR `/api/health` instanceId)
 *   register {hostId, signature, label, platform, canOpenChrome, profiles}
 *     → registered {hostId}
 *
 * The signature (Ed25519, over `"pi-browser-host-v1\n"+nonce+"\n"+serverId`)
 * proves possession of the private key and binds the proof to THIS server's
 * identity rather than an origin string, so it is stable behind tunnels and
 * proxies. `hostId` must derive from the key (`host-` + 32 hex of SHA-256), and
 * the first verified key per `hostId` is pinned in `operator-hosts.json`
 * (prune > 90 days, cap 256). Reading a `hostId` (it is listed on REST) is
 * harmless: registering it needs the private key.
 *
 * Bindings are in memory only. One host per socket. A newcomer never evicts a
 * live host: a second socket for a `hostId` that still has links or pending
 * connects is refused `host-active`; otherwise it re-binds. A carrier close
 * drops the binding and tells the manager (`onHostGone`), which closes every
 * instance hosted through it.
 *
 * Refusals are silent on the wire (there is no error message type) and are
 * audited under profile key `host:<hostId>` plus logged. Nothing secret — nonce,
 * signature, public key — is ever logged or audited (D11).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  HOST_ID_PATTERN,
  hostIdFromPublicKey,
  verifyHostSignature,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import type { BrowserHostProfileRow } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { AuditRing } from "./audit.js";
import { type RelaySocket, WS_OPEN } from "./relay/extension-socket.js";

const PIN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const PIN_MAX_COUNT = 256;

const MAX_LABEL = 128;
const MAX_PLATFORM = 64;
const MAX_PROFILES = 64;
const MAX_PROFILE_DIR = 128;
const MAX_PROFILE_LABEL = 256;
const MAX_EMAIL = 254;
/** An Ed25519 SPKI key is 44 bytes (60 base64 chars); allow headroom, not megabytes. */
const MAX_PUBLIC_KEY = 128;
const MAX_SIGNATURE = 256;

interface HostLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface OperatorHostsDeps {
  /** `operator-hosts.json`; omitted ⇒ pins live in memory only. */
  pinsPath?: string;
  /** This server's own `/api/health` `instanceId`. A rejection refuses the hello. */
  getServerId(): string | Promise<string>;
  audit: AuditRing;
  logger: HostLogger;
  now?: () => number;
  randomNonce?: () => string;
  /** A bound host's carrier closed (manager closes its instances / pending connects). */
  onHostGone(hostId: string, socket: RelaySocket): void;
  /** True while `hostId` has a live link or a pending connect (`host-active` guard). */
  hasActivity(hostId: string): boolean;
}

interface Pin {
  publicKey: string;
  lastSeen: number;
}

interface Challenge {
  hostId: string;
  publicKey: string;
  nonce: string;
  serverId: string;
}

export interface HostBinding {
  hostId: string;
  socket: RelaySocket;
  label: string;
  platform: string;
  canOpenChrome: boolean;
  profiles: BrowserHostProfileRow[];
}

/** One row of `GET /api/browser/profiles` `operatorHosts` (before `instances` is added). */
export interface OperatorHostInfo {
  hostId: string;
  label: string;
  platform: string;
  online: true;
  canOpenChrome: boolean;
  profiles: BrowserHostProfileRow[];
}

type PinState = "new" | "ok";

/** A hostId that is safe to log / use as an audit key; anything else is `invalid`. */
export function safeHostId(raw: unknown): string {
  return typeof raw === "string" && HOST_ID_PATTERN.test(raw) ? raw : "invalid";
}

/** Audit profile key for host-level events (readable via `GET /audit?profile=host:<hostId>`). */
function hostAuditKey(hostId: unknown): string {
  return `host:${safeHostId(hostId)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One profile row, validated and copied to its four wire fields; null on any violation. */
function parseProfileRow(raw: unknown): BrowserHostProfileRow | null {
  if (!isRecord(raw)) return null;
  const { profileDirectory, label, email, installed } = raw;
  if (typeof profileDirectory !== "string" || profileDirectory.length === 0) return null;
  if (profileDirectory.length > MAX_PROFILE_DIR || /[\\/]/.test(profileDirectory)) return null;
  if (typeof label !== "string" || label.length > MAX_PROFILE_LABEL) return null;
  if (typeof installed !== "boolean") return null;
  if (email !== undefined && (typeof email !== "string" || email.length > MAX_EMAIL)) return null;
  return {
    profileDirectory,
    label,
    installed,
    ...(typeof email === "string" && email.length > 0 ? { email } : {}),
  };
}

/** Validate + copy the register payload's bounded fields; null on any violation (D2 bounds). */
function parseRegistration(
  msg: Record<string, unknown>,
): Pick<HostBinding, "label" | "platform" | "canOpenChrome" | "profiles"> | null {
  const { label, platform, canOpenChrome, profiles } = msg;
  if (typeof label !== "string" || label.length > MAX_LABEL) return null;
  if (typeof platform !== "string" || platform.length > MAX_PLATFORM) return null;
  if (typeof canOpenChrome !== "boolean") return null;
  if (!Array.isArray(profiles) || profiles.length > MAX_PROFILES) return null;
  const rows = new Map<string, BrowserHostProfileRow>();
  for (const raw of profiles) {
    const row = parseProfileRow(raw);
    if (!row) return null;
    if (!rows.has(row.profileDirectory)) rows.set(row.profileDirectory, row);
  }
  return { label, platform, canOpenChrome, profiles: [...rows.values()] };
}

export class OperatorHostRegistry {
  private readonly deps: OperatorHostsDeps;
  private readonly now: () => number;
  private readonly randomNonce: () => string;
  private readonly pins = new Map<string, Pin>();
  private readonly bindings = new Map<string, HostBinding>();
  private readonly bySocket = new Map<RelaySocket, string>();
  private readonly challenges = new Map<RelaySocket, Challenge>();
  private readonly closeTracked = new WeakSet<object>();

  constructor(deps: OperatorHostsDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.randomNonce = deps.randomNonce ?? (() => randomBytes(32).toString("hex"));
    this._loadPins();
  }

  /** Handle `browser_host_hello` / `browser_host_register` from `ws`. */
  async handle(msg: unknown, ws: RelaySocket): Promise<void> {
    if (!isRecord(msg)) return;
    this._trackClose(ws);
    if (msg.type === "browser_host_hello") await this._onHello(msg, ws);
    else if (msg.type === "browser_host_register") this._onRegister(msg, ws);
  }

  get(hostId: string): HostBinding | undefined {
    return this.bindings.get(hostId);
  }

  hostOfSocket(ws: RelaySocket): string | undefined {
    return this.bySocket.get(ws);
  }

  /** Online hosts only (a closed carrier is omitted). */
  list(): OperatorHostInfo[] {
    return [...this.bindings.values()].map((b) => ({
      hostId: b.hostId,
      label: b.label,
      platform: b.platform,
      online: true,
      canOpenChrome: b.canOpenChrome,
      profiles: b.profiles,
    }));
  }

  /** `DELETE /api/browser/operator-hosts/:hostId` — forget the pin (reinstalled operator). */
  deletePin(hostId: string): boolean {
    if (!this.pins.delete(hostId)) return false;
    this._savePins();
    return true;
  }

  /** A refused / dropped `browser_host_*` message, audited under `host:<hostId>`. */
  denied(hostId: unknown, detail: string, instanceId = "unknown"): void {
    this.deps.audit.append({
      profileDirectory: hostAuditKey(hostId),
      instanceId,
      kind: "denied",
      detail,
    });
  }

  // ── registration steps ─────────────────────────────────────────────────────

  private async _onHello(msg: Record<string, unknown>, ws: RelaySocket): Promise<void> {
    const { hostId, publicKey } = msg;
    this.challenges.delete(ws);
    if (typeof hostId !== "string" || !HOST_ID_PATTERN.test(hostId)) {
      this._refuse(hostId, "bad-host-id");
      return;
    }
    if (typeof publicKey !== "string" || publicKey.length === 0 || publicKey.length > MAX_PUBLIC_KEY) {
      this._refuse(hostId, "bad-key");
      return;
    }
    if (hostIdFromPublicKey(publicKey) !== hostId) {
      this._refusePin(hostId, 0);
      return;
    }
    const pinned = this.pins.get(hostId);
    if (pinned && pinned.publicKey !== publicKey) {
      this._refusePin(hostId, 0);
      return;
    }
    let serverId: string;
    try {
      serverId = await this.deps.getServerId();
    } catch {
      this._refuse(hostId, "server-id-unavailable");
      return;
    }
    if (!serverId || ws.readyState !== WS_OPEN) return;
    const nonce = this.randomNonce();
    this.challenges.set(ws, { hostId, publicKey, nonce, serverId });
    this._send(ws, { type: "browser_host_challenge", nonce, serverId });
  }

  private _onRegister(msg: Record<string, unknown>, ws: RelaySocket): void {
    const claimed = msg.hostId;
    const challenge = this.challenges.get(ws);
    this.challenges.delete(ws); // a challenge is single-use, success or not
    if (!challenge || claimed !== challenge.hostId) {
      this._refuse(claimed, "no-challenge");
      return;
    }
    const hostId = challenge.hostId;
    const fields = parseRegistration(msg);
    if (!fields) {
      this._refuse(hostId, "invalid");
      return;
    }
    const pinned = this.pins.get(hostId);
    if (pinned && pinned.publicKey !== challenge.publicKey) {
      this._refusePin(hostId, fields.profiles.length);
      return;
    }
    const signature = msg.signature;
    if (
      typeof signature !== "string" ||
      signature.length === 0 ||
      signature.length > MAX_SIGNATURE ||
      !verifyHostSignature(challenge.publicKey, challenge.nonce, challenge.serverId, signature)
    ) {
      this._refuse(hostId, "bad-signature");
      return;
    }
    const boundTo = this.bySocket.get(ws);
    if (boundTo !== undefined && boundTo !== hostId) {
      this._refuse(hostId, "socket-bound");
      return;
    }
    const existing = this.bindings.get(hostId);
    if (existing && existing.socket !== ws && existing.socket.readyState === WS_OPEN && this.deps.hasActivity(hostId)) {
      this._refuse(hostId, "host-active");
      return;
    }
    if (existing && existing.socket !== ws) this.bySocket.delete(existing.socket);

    const pin: PinState = pinned ? "ok" : "new";
    this.pins.set(hostId, { publicKey: challenge.publicKey, lastSeen: this.now() });
    this._savePins();
    this.bindings.set(hostId, { hostId, socket: ws, ...fields });
    this.bySocket.set(ws, hostId);
    this.deps.logger.info(
      `[browser-host] register host=${hostId} profiles=${fields.profiles.length} pin=${pin}`,
    );
    this._send(ws, { type: "browser_host_registered", hostId });
  }

  private _refuse(claimed: unknown, reason: string): void {
    const hostId = safeHostId(claimed);
    this.denied(hostId, "browser_host:register");
    this.deps.logger.warn(`[browser-host] register refused host=${hostId} reason=${reason}`);
  }

  private _refusePin(hostId: string, profiles: number): void {
    this.denied(hostId, "browser_host:register");
    this.deps.logger.warn(`[browser-host] register host=${hostId} profiles=${profiles} pin=mismatch`);
  }

  // ── carrier lifecycle ──────────────────────────────────────────────────────

  private _trackClose(ws: RelaySocket): void {
    if (this.closeTracked.has(ws)) return;
    this.closeTracked.add(ws);
    ws.on("close", (() => this._onClose(ws)) as never);
  }

  private _onClose(ws: RelaySocket): void {
    this.challenges.delete(ws);
    const hostId = this.bySocket.get(ws);
    if (hostId === undefined) return;
    this.bySocket.delete(ws);
    if (this.bindings.get(hostId)?.socket !== ws) return;
    this.bindings.delete(hostId);
    this.deps.onHostGone(hostId, ws);
  }

  private _send(ws: RelaySocket, msg: Record<string, unknown>): void {
    if (ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* carrier died mid-send: its close handler finishes the teardown */
    }
  }

  // ── pin store (plugin data dir, `operator-hosts.json`) ─────────────────────

  private _loadPins(): void {
    const path = this.deps.pinsPath;
    if (!path) return;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { pins?: unknown };
      if (!isRecord(parsed.pins)) return;
      for (const [hostId, raw] of Object.entries(parsed.pins)) {
        if (!HOST_ID_PATTERN.test(hostId)) continue;
        if (!isRecord(raw) || typeof raw.publicKey !== "string" || typeof raw.lastSeen !== "number") continue;
        this.pins.set(hostId, { publicKey: raw.publicKey, lastSeen: raw.lastSeen });
      }
      this._prunePins();
    } catch {
      /* missing or corrupt ⇒ empty; the next register rewrites it */
    }
  }

  /** Drop pins unseen for 90 days, then keep the 256 most recently seen. */
  private _prunePins(): void {
    const cutoff = this.now() - PIN_MAX_AGE_MS;
    for (const [hostId, pin] of this.pins) if (pin.lastSeen < cutoff) this.pins.delete(hostId);
    if (this.pins.size <= PIN_MAX_COUNT) return;
    const keep = [...this.pins.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, PIN_MAX_COUNT);
    this.pins.clear();
    for (const [hostId, pin] of keep) this.pins.set(hostId, pin);
  }

  private _savePins(): void {
    const path = this.deps.pinsPath;
    if (!path) return;
    this._prunePins();
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ pins: Object.fromEntries(this.pins) }), { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      this.deps.logger.warn("[browser-host] pin file not written", err instanceof Error ? err.message : "");
    }
  }
}
