/**
 * In-memory leases (D3). `ensure` creates one only when it returns `healthy`;
 * `heartbeat` extends it by the TTL (300 s default); `release` ends it; an
 * expired lease is gone. Leases are deliberately NOT persisted: after a server
 * restart every `heartbeat` / `release` answers `lease-unknown` and the CLI
 * re-ensures transparently.
 * See change: add-service-registry-core.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_LEASE_TTL_SEC } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";

export interface Lease {
  leaseId: string;
  serviceId: string;
  holder?: string;
  expiresAt: number;
}

export class LeaseTable {
  private readonly leases = new Map<string, Lease>();
  /** serviceId → when its last live lease ended (release or expiry). */
  private readonly lastEnded = new Map<string, number>();

  constructor(readonly ttlMs = DEFAULT_LEASE_TTL_SEC * 1000) {}

  create(serviceId: string, now: number, holder?: string): Lease {
    const lease: Lease = { leaseId: randomUUID(), serviceId, expiresAt: now + this.ttlMs, ...(holder ? { holder } : {}) };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  /** Live lease for `leaseId` (expired counts as unknown). */
  get(leaseId: string, now: number): Lease | undefined {
    const l = this.leases.get(leaseId);
    return l && now < l.expiresAt ? l : undefined;
  }

  heartbeat(leaseId: string, now: number): Lease | undefined {
    const l = this.get(leaseId, now);
    if (!l) return undefined;
    l.expiresAt = now + this.ttlMs;
    return l;
  }

  release(leaseId: string, now: number): Lease | undefined {
    const l = this.get(leaseId, now);
    if (!l) return undefined;
    this.leases.delete(leaseId);
    if (this.live(l.serviceId, now) === 0) this.lastEnded.set(l.serviceId, now);
    return l;
  }

  live(serviceId: string, now: number): number {
    let n = 0;
    for (const l of this.leases.values()) if (l.serviceId === serviceId && now < l.expiresAt) n++;
    return n;
  }

  /** Remove expired leases; record when each service's last lease ended. */
  sweep(now: number): void {
    for (const [id, l] of this.leases) {
      if (now >= l.expiresAt) {
        this.leases.delete(id);
        if (this.live(l.serviceId, now) === 0) {
          const prev = this.lastEnded.get(l.serviceId) ?? 0;
          this.lastEnded.set(l.serviceId, Math.max(prev, l.expiresAt));
        }
      }
    }
  }

  lastEndedAt(serviceId: string): number | undefined {
    return this.lastEnded.get(serviceId);
  }

  dropService(serviceId: string): void {
    for (const [id, l] of this.leases) if (l.serviceId === serviceId) this.leases.delete(id);
    this.lastEnded.delete(serviceId);
  }

  servicesWithLiveLeases(now: number): Set<string> {
    const s = new Set<string>();
    for (const l of this.leases.values()) if (now < l.expiresAt) s.add(l.serviceId);
    return s;
  }
}
