/**
 * Tier 5 — the stable `/preview/<pid>/` capability (D8). One CURRENT pid per port target, so the upstream can be
 * started once under one base and every viewer / reservation reaches the same site. The pid is a secret (128 bits,
 * base64url, 22 chars): only `hash(pid)` is indexed, the plaintext lives in memory and is returned only to a holder.
 *
 *  - Holders: `mint` holders admit requests and contribute policy; `revocation` holders only exist so that revoking
 *    ANY holder's device / session drops the shared pid for everyone who knows it (D-U7). Liveness is re-checked at
 *    use, so no extra revocation wiring is needed.
 *  - A mint inside the last 20 minutes of the absolute lifetime issues a NEW pid (the viewer re-mints at 10 min lead);
 *    the superseded pid keeps serving until its own absolute expiry and is never returned by a mint again.
 *  - Bounds: 32 pids created per principal, 256 in total. At a cap the mint is REFUSED (caller falls back to legacy);
 *    live pids are never evicted. Joining an existing pid creates nothing and is always allowed.
 *
 *  - Reservations (D9): a reserved-but-unadopted pid lives in a SEPARATE map, so it is indistinguishable from an unknown
 *    pid at every road (`validate` never sees it). A control-tier tier-5 mint for the same port adopts the newest one.
 *
 * See change: serve-live-previews-on-capability-origin (D8, D9).
 */
import crypto from "node:crypto";
import { CAPABILITY_IDLE_MS, CAPABILITY_MAX_MS, type CapabilityPrincipal, type LiveCapabilityGrant, type LiveExposure, type LivePolicy, principalKeyOf } from "./live-capability.js";
import { hashPreviewKey } from "./preview-origin.js";
import { PID_SHAPE } from "./preview-path.js";

/** A mint with this much (or less) absolute lifetime left issues a new pid: twice the 10-minute client re-mint lead. */
const SUPERSEDE_WITHIN_MS = 20 * 60_000;
const MAX_PIDS_PER_PRINCIPAL = 32;
const MAX_PIDS_TOTAL = 256;
const SWEEP_INTERVAL_MS = 60_000;

/** Unbound reservations: 8 per principal, 64 in total; a replacement for the same (principal, port) is free. */
const MAX_RESERVATIONS_PER_PRINCIPAL = 8;
const MAX_RESERVATIONS_TOTAL = 64;
/** An unbound reservation lives 10 min from creation, or up to 12 h while a target for its port exists. */
const RESERVATION_NO_TARGET_MS = 10 * 60_000;
const RESERVATION_WITH_TARGET_MS = 12 * 3_600_000;
/** Who reserved: a REST principal or an authenticated bridge connection (`key` = the server-known identity). */
export interface Reserver {
  key: string;
  principal?: CapabilityPrincipal;
  /** Liveness of a non-principal reserver (a bridge session); absent ⇒ always live. */
  isLive?: () => boolean;
}
interface Reservation {
  pid: string;
  port: number;
  reserver: Reserver;
  /** Bridge `requestId`, so a late `preview_path_release` can drop exactly this reservation. */
  requestId?: string;
  createdAt: number;
}
export type ReserveResult =
  | { ok: true; pid: string; expiresAt: number; reserved: boolean }
  | { ok: false; reason: "principal-cap" | "total-cap" };
interface Holder {
  kind: "mint" | "revocation";
  principal: CapabilityPrincipal;
  /** Liveness of a holder that is not a CapabilityPrincipal (a bridge-session reserver). */
  isLive?: () => boolean;
  localBound: boolean;
  policy: LivePolicy;
  exposure: LiveExposure;
}

interface PathEntry {
  pid: string;
  tokenId: string;
  targetId: string;
  /** `principalKey` of the principal that created or adopted the pid: the cap counts against it only. */
  creator: string;
  holders: Map<string, Holder>;
  mintedAt: number;
  lastUsedAt: number;
}

export interface PreviewPathMintOptions {
  /** The target's loopback port: lets the mint adopt a reservation made for it (D9). */
  port?: number;
  policy: LivePolicy;
  localBound?: boolean;
  exposure?: LiveExposure;
}

export type PreviewPathMint =
  | {
      ok: true;
      pid: string;
      tokenId: string;
      expiresAt: number;
      policy: LivePolicy;
      /** The mint returned the existing current pid (this principal joined / refreshed as a mint holder). */
      reused: boolean;
      /** A previous pid of this target was superseded: the running site was started under the OLD base. */
      restartRequired: boolean;
    }
  | { ok: false; reason: "principal-cap" | "total-cap" | "adoption-refused" };

export interface PreviewPathStoreOptions {
  /** The registered port target's id for a loopback port, or `undefined` (reserve returns its live pid; lifetime). */
  targetIdForPort?: (port: number) => string | undefined;
  /** The SSRF gate (loopback port target, never an `ownPorts` port): re-run at adoption (TOCTOU). */
  isPortAllowed?: (port: number) => boolean;
  now?: () => number;
  isTargetLive?: (targetId: string) => boolean;
  isPrincipalLive?: (p: CapabilityPrincipal) => boolean;
  /** `previewOrigins.enabled`: when false every pid is revoked at the next use / sweep. */
  isEnabled?: () => boolean;
  sweepIntervalMs?: number;
}

/** The effective policy of a pid: the NARROWEST of its mint holders (scripts off beats on, restricted beats open). */
function intersect(holders: Iterable<Holder>): LivePolicy {
  let egress: LivePolicy["egress"] = "open";
  let scripts = true;
  let any = false;
  for (const h of holders) {
    if (h.kind !== "mint") continue;
    any = true;
    if (h.policy.egress === "restricted") egress = "restricted";
    if (!h.policy.scripts) scripts = false;
  }
  return any ? { egress, scripts } : { egress: "restricted", scripts: false };
}

export class PreviewPathStore {
  /** `hash(pid)` → entry. */
  private readonly entries = new Map<string, PathEntry>();
  /** targetId → `hash(pid)` of its CURRENT pid (the one a mint returns). */
  private readonly current = new Map<string, string>();
  private readonly now: () => number;
  private readonly isTargetLive: (id: string) => boolean;
  private readonly isPrincipalLive: (p: CapabilityPrincipal) => boolean;
  private readonly isEnabled: () => boolean;
  private readonly sweepIntervalMs: number;
  private readonly targetIdForPort: (port: number) => string | undefined;
  private readonly isPortAllowed: (port: number) => boolean;
  /** `hash(pid)` → unbound reservation. Insertion order = age (newest last). */
  private readonly reservations = new Map<string, Reservation>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(opts: PreviewPathStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.isTargetLive = opts.isTargetLive ?? (() => true);
    this.isPrincipalLive = opts.isPrincipalLive ?? (() => true);
    this.isEnabled = opts.isEnabled ?? (() => true);
    this.sweepIntervalMs = opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
    this.targetIdForPort = opts.targetIdForPort ?? (() => undefined);
    this.isPortAllowed = opts.isPortAllowed ?? (() => true);
  }

  /** Unbound reservations currently held (introspection / bounds tests). */
  reservationCount(): number {
    return this.reservations.size;
  }

  size(): number {
    return this.entries.size;
  }

  /** Start the store-owned (unref'd) sweep. Idempotent. */
  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweeper.unref?.();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  /** Mint (or join) the current pid of `targetId`. */
  mint(targetId: string, principal: CapabilityPrincipal, opts: PreviewPathMintOptions): PreviewPathMint {
    const now = this.now();
    this.sweep();
    const who = principalKeyOf(principal);
    const holder: Holder = {
      kind: "mint",
      principal,
      localBound: opts.localBound === true,
      policy: { ...opts.policy },
      exposure: opts.exposure ?? "exposed",
    };
    const currentKey = this.current.get(targetId);
    const cur = currentKey ? this.entries.get(currentKey) : undefined;
    // Precedence (D9): (1) a live pid of the target wins and every reservation for the port is discarded.
    if (cur && opts.port !== undefined) this.dropReservationsForPort(opts.port);
    if (cur && cur.mintedAt + CAPABILITY_MAX_MS - now > SUPERSEDE_WITHIN_MS) {
      // Join: refresh as a mint holder (an earlier revocation-only holder is upgraded). Re-insert so it is the newest.
      cur.holders.delete(who);
      cur.holders.set(who, holder);
      cur.lastUsedAt = now;
      return this.result(cur, true, false);
    }
    const created = [...this.entries.values()].filter((e) => e.creator === who).length;
    if (created >= MAX_PIDS_PER_PRINCIPAL) return { ok: false, reason: "principal-cap" };
    if (this.entries.size >= MAX_PIDS_TOTAL) return { ok: false, reason: "total-cap" };
    // (2) else adopt the newest reservation for the port (older ones are dropped); (3) else a new pid.
    const adopted = !cur && opts.port !== undefined ? this.newestReservation(opts.port) : undefined;
    if (adopted && !this.isPortAllowed(adopted.port)) {
      this.dropReservationsForPort(adopted.port); // the port can never adopt validly (Q35)
      return { ok: false, reason: "adoption-refused" };
    }
    const pid = adopted?.pid ?? crypto.randomBytes(16).toString("base64url");
    const entry: PathEntry = {
      pid,
      tokenId: crypto.randomBytes(12).toString("base64url"),
      targetId,
      creator: who,
      holders: new Map([[who, holder]]),
      mintedAt: now,
      lastUsedAt: now,
    };
    const key = hashPreviewKey(pid);
    this.entries.set(key, entry);
    this.current.set(targetId, key);
    if (adopted && opts.port !== undefined) {
      this.dropReservationsForPort(opts.port);
      // The reserver already knows the pid: it may revoke it (D-U7) but never admits requests through it.
      if (adopted.reserver.key !== who) this.addReserverHolder(entry, adopted.reserver);
    }
    return this.result(entry, false, cur !== undefined);
  }

  /**
   * Reserve a stable base for a loopback `port` (D9). A port whose target already has a live pid returns THAT pid and
   * creates nothing (the caller becomes a revocation holder). Otherwise an unbound reservation `{pid, port, reserver}` is made:
   * 8 per principal, 64 in total, never evicted; a repeat by the same reserver for the same port replaces the previous one.
   */
  reserve(port: number, reserver: Reserver, requestId?: string): ReserveResult {
    const now = this.now();
    this.sweep();
    const targetId = this.targetIdForPort(port);
    const live = targetId ? this.currentPid(targetId) : null;
    if (live) {
      const e = this.entries.get(hashPreviewKey(live));
      if (e) this.addReserverHolder(e, reserver);
      return { ok: true, pid: live, expiresAt: (e?.mintedAt ?? now) + CAPABILITY_MAX_MS, reserved: false };
    }
    for (const [k, r] of this.reservations) if (r.port === port && r.reserver.key === reserver.key) this.reservations.delete(k);
    const mine = [...this.reservations.values()].filter((r) => r.reserver.key === reserver.key).length;
    if (mine >= MAX_RESERVATIONS_PER_PRINCIPAL) return { ok: false, reason: "principal-cap" };
    if (this.reservations.size >= MAX_RESERVATIONS_TOTAL) return { ok: false, reason: "total-cap" };
    const pid = crypto.randomBytes(16).toString("base64url");
    const r: Reservation = { pid, port, reserver, createdAt: now, ...(requestId ? { requestId } : {}) };
    this.reservations.set(hashPreviewKey(pid), r);
    return { ok: true, pid, expiresAt: this.reservationDeadline(r), reserved: true };
  }

  /** Release an UNBOUND reservation by pid (reserver only). `false` for an unknown, adopted or foreign pid. */
  releaseReservation(pid: string, reserverKey: string): boolean {
    if (!PID_SHAPE.test(pid)) return false;
    const key = hashPreviewKey(pid);
    const r = this.reservations.get(key);
    if (!r || r.reserver.key !== reserverKey) return false;
    return this.reservations.delete(key);
  }

  /** Release the unbound reservation a bridge request made (late `preview_path_release`). Idempotent. */
  releaseByRequest(requestId: string, reserverKey: string): boolean {
    for (const [k, r] of this.reservations) {
      if (r.requestId === requestId && r.reserver.key === reserverKey) return this.reservations.delete(k);
    }
    return false;
  }

  /** Drop every unbound reservation of a reserver (its session ended / device revoked). */
  dropReservationsBy(reserverKey: string): number {
    let n = 0;
    for (const [k, r] of this.reservations) {
      if (r.reserver.key === reserverKey) {
        this.reservations.delete(k);
        n++;
      }
    }
    return n;
  }

  private reservationDeadline(r: Reservation): number {
    return r.createdAt + (this.targetIdForPort(r.port) !== undefined ? RESERVATION_WITH_TARGET_MS : RESERVATION_NO_TARGET_MS);
  }

  private reservationAlive(key: string, r: Reservation): boolean {
    const live = r.reserver.principal ? this.isPrincipalLive(r.reserver.principal) : (r.reserver.isLive?.() ?? true);
    if (!this.isEnabled() || !live || this.now() >= this.reservationDeadline(r)) {
      this.reservations.delete(key);
      return false;
    }
    return true;
  }

  private newestReservation(port: number): Reservation | undefined {
    let found: Reservation | undefined;
    for (const [k, r] of this.reservations) if (r.port === port && this.reservationAlive(k, r)) found = r;
    return found;
  }

  private dropReservationsForPort(port: number): void {
    for (const [k, r] of this.reservations) if (r.port === port) this.reservations.delete(k);
  }

  private addReserverHolder(e: PathEntry, reserver: Reserver): void {
    if (e.holders.has(reserver.key)) return;
    e.holders.set(reserver.key, {
      kind: "revocation",
      principal: reserver.principal ?? { kind: "local" },
      ...(reserver.isLive ? { isLive: reserver.isLive } : {}),
      localBound: false,
      policy: { egress: "restricted", scripts: false },
      exposure: "exposed",
    });
  }

  /** Tell the pid to a principal that only needs to be able to revoke it (reserver, tier 1-4 `base` minter). */
  addRevocationHolder(pid: string, principal: CapabilityPrincipal): boolean {
    const e = this.entries.get(hashPreviewKey(pid));
    if (!e) return false;
    const who = principalKeyOf(principal);
    if (!e.holders.has(who)) {
      e.holders.set(who, { kind: "revocation", principal, localBound: false, policy: { egress: "restricted", scripts: false }, exposure: "exposed" });
    }
    return true;
  }

  /** The live pid of `targetId`, or `null`. Does not touch. */
  currentPid(targetId: string): string | null {
    const key = this.current.get(targetId);
    const e = key ? this.entries.get(key) : undefined;
    return e && this.alive(key as string, e) ? e.pid : null;
  }

  /**
   * The grant behind `pid`, or `null`. `touch` extends the idle expiry (an accepted request); a preflight peeks.
   * A `localBound` mint holder admits only genuinely local requests; the request is admitted when ANY mint holder does.
   */
  validate(pid: string, ctx: { genuinelyLocal: boolean }, touch = true): LiveCapabilityGrant | null {
    if (!PID_SHAPE.test(pid)) return null;
    const key = hashPreviewKey(pid);
    const e = this.entries.get(key);
    if (!e || !this.alive(key, e)) return null;
    let admitting: Holder | undefined;
    for (const h of e.holders.values()) {
      if (h.kind === "mint" && (!h.localBound || ctx.genuinelyLocal)) admitting = h; // last = most recently refreshed
    }
    if (!admitting) return null;
    if (touch) e.lastUsedAt = this.now();
    return {
      targetId: e.targetId,
      tokenId: e.tokenId,
      kind: "port",
      policy: intersect(e.holders.values()),
      minterKey: principalKeyOf(admitting.principal),
      principal: admitting.principal,
      tier: 5,
      ancestors: [],
    };
  }

  /** Drop every pid of a target (target removed / evicted). */
  revokeByTarget(targetId: string): void {
    for (const [key, e] of this.entries) if (e.targetId === targetId) this.remove(key, e);
  }

  /** Drop every pid (`previewOrigins.enabled` turned off, shutdown). */
  revokeAll(): void {
    this.entries.clear();
    this.current.clear();
    this.reservations.clear();
  }

  /** Remove expired / revoked entries; revoke everything while previews are disabled. */
  sweep(): void {
    if (!this.isEnabled()) {
      this.revokeAll();
      return;
    }
    for (const [key, e] of this.entries) this.alive(key, e);
    for (const [key, r] of this.reservations) this.reservationAlive(key, r);
  }

  private result(e: PathEntry, reused: boolean, restartRequired: boolean): PreviewPathMint {
    return {
      ok: true,
      pid: e.pid,
      tokenId: e.tokenId,
      expiresAt: e.mintedAt + CAPABILITY_MAX_MS,
      policy: intersect(e.holders.values()),
      reused,
      restartRequired,
    };
  }

  /** Is the entry still valid? Removes it (for every holder) when expired, its target is gone or any holder was revoked. */
  private alive(key: string, e: PathEntry): boolean {
    const now = this.now();
    if (!this.isEnabled()) {
      this.revokeAll();
      return false;
    }
    if (now - e.mintedAt >= CAPABILITY_MAX_MS || now - e.lastUsedAt >= CAPABILITY_IDLE_MS) return this.remove(key, e);
    if (!this.isTargetLive(e.targetId)) return this.remove(key, e);
    for (const h of e.holders.values()) if (!(h.isLive ? h.isLive() : this.isPrincipalLive(h.principal))) return this.remove(key, e);
    return true;
  }

  private remove(key: string, e: PathEntry): false {
    this.entries.delete(key);
    if (this.current.get(e.targetId) === key) this.current.delete(e.targetId);
    return false;
  }
}
