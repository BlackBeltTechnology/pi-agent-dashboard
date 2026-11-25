/**
 * Admit / refuse bookkeeping does not leak across churn (D13): 5,000 capabilities of EVERY tier are minted, admitted, then
 * expired / revoked / evicted. The store indexes, the observer's "first admit" set (shrunk by `onDelete`, as `server.ts` wires it)
 * and its refuse limiter stay bounded the whole way and are empty at the end; tier-5 pids drain too.
 *
 * SCALED: the 10 min wall window is a fake clock (hours of capability lifetime pass in milliseconds); heap is RECORDED, never asserted (Q48).
 *
 * See change: serve-live-previews-on-capability-origin (D13; test-plan #P18).
 */
import { describe, expect, it } from "vitest";
import { type CapabilityPrincipal, LiveCapabilityStore } from "../live-server/live-capability.js";
import { createPreviewObserver, MAX_TRACKED } from "../live-server/preview-observe.js";
import { hashPreviewKey, previewLogHash } from "../live-server/preview-origin.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";

const HOUR = 3_600_000;
const TOTAL = 5_000;
const PRINCIPALS = 120;
const dev = (i: number): CapabilityPrincipal => ({ kind: "device", tier: "control", deviceId: `d${i % PRINCIPALS}` });
const POLICY = { policy: { egress: "restricted", scripts: false } } as const;

const bind = (tier: 1 | 2 | 4) => ({
  preview: {
    tier,
    ancestors: ["http://localhost:8000"],
    buildOrigin: (l: string) => {
      const originHost = tier === 1 ? `${l}.localhost:8000` : tier === 2 ? `${l}.preview.example.com` : `${l}.1-2-3-4.sslip.io:8000`;
      return { origin: `http://${originHost}`, originHost };
    },
  },
});

describe("T.P18 / #P18 — admit/refuse state does not leak across churn", () => {
  it("5,000 capabilities across all tiers: indexes + observer sets stay bounded, empty after churn; heap recorded", () => {
    let clock = 1_000_000;
    const lines: string[] = [];
    const observer = createPreviewObserver({ sink: (l) => lines.push(l), now: () => clock });
    // the server.ts wiring: the store's onDelete shrinks the observer's per-entry state
    const store = new LiveCapabilityStore({
      now: () => clock,
      isTargetLive: () => true,
      onDelete: (entry) => {
        if (entry.label) observer.forget(previewLogHash(entry.label));
      },
    });
    const paths = new PreviewPathStore({ now: () => clock });
    const heapBefore = process.memoryUsage().heapUsed;

    let maxStore = 0;
    let maxIndex = 0;
    let maxAdmit = 0;
    let maxRefuse = 0;
    let maxPids = 0;
    let admitsLogged = 0;
    const sample = () => {
      maxStore = Math.max(maxStore, store.size());
      maxIndex = Math.max(maxIndex, store.admittedHostCount());
      maxAdmit = Math.max(maxAdmit, observer.size().admit);
      maxRefuse = Math.max(maxRefuse, observer.size().refuse);
      maxPids = Math.max(maxPids, paths.size());
    };

    for (let i = 0; i < TOTAL; i++) {
      const kind = i % 6; // 0:tier1 1:tier2 2:tier3 3:tier4 4:legacy 5:tier5
      const principal = dev(i);
      if (kind === 5) {
        paths.mint(`t${i % 200}`, principal, POLICY);
      } else if (kind === 2) {
        store.mint("vite-5173", principal, {
          preview: { tier: 3, ancestors: ["http://192.168.1.5:8000"], fixed: { origin: `http://192.168.1.5:${20_000 + (i % 3000)}`, originHost: `192.168.1.5:${20_000 + (i % 3000)}`, poolPort: 20_000 + (i % 3000) } },
        });
      } else if (kind === 4) {
        store.mint("vite-5173", principal);
      } else {
        const tier = kind === 0 ? 1 : kind === 1 ? 2 : 4;
        const m = store.mint("vite-5173", principal, bind(tier));
        // admit: the dispatcher's lookup, then the observer's "first admit"
        const host = m.originHost as string;
        const found = store.lookupByHost(hashPreviewKey(m.token), host, true);
        expect(found.ok).toBe(true);
        const before = lines.length;
        observer.admitted(previewLogHash(m.token), tier);
        observer.admitted(previewLogHash(m.token), tier); // second admit of the same entry: never logged
        admitsLogged += lines.length - before;
      }
      // a refusal for a label that was never minted (probe traffic) every iteration
      observer.refused("unknown", `${(i * 2654435761 >>> 0).toString(16).padStart(8, "0")}`);

      // deletion paths, interleaved: revoke by device, absolute / idle expiry (fake clock + sweep), natural eviction (64/principal)
      if (i % 7 === 3) store.revokeByDevice(`d${i % PRINCIPALS}`);
      if (i % 500 === 499) {
        clock += 13 * HOUR; // everything minted so far is past its 12 h absolute limit
        store.mint("vite-5173", { kind: "local" }); // the store's own sweep collects the expired
        paths.sweep();
      }
      if (i % 50 === 0) sample();
      clock += 10; // < the 60 s refuse window: the limiter keeps tracking until its own cap evicts
    }
    sample();

    // ---- bounds held during the churn
    expect(maxStore).toBeLessThanOrEqual(1024 + 1); // MAX_TOKENS hard cap (+ the sweep-trigger mint)
    expect(maxIndex).toBeLessThanOrEqual(maxStore);
    expect(maxAdmit).toBeLessThanOrEqual(MAX_TRACKED * 4);
    expect(maxRefuse).toBeLessThanOrEqual(MAX_TRACKED);
    expect(maxPids).toBeLessThanOrEqual(256); // MAX_PIDS_TOTAL
    // first admit is logged once per ENTRY (re-mints of a live entry reuse its label), never once per request
    const admitLines = lines.filter((l) => l.startsWith("[live-preview] admit "));
    expect(admitLines).toHaveLength(admitsLogged);
    expect(new Set(admitLines).size).toBe(admitLines.length);
    expect(admitLines.length).toBeGreaterThan(500);

    // ---- drained after the churn
    clock += 13 * HOUR;
    store.mint("vite-5173", { kind: "local" });
    paths.sweep();
    store.close();
    expect(store.size()).toBe(0);
    expect(store.admittedHostCount()).toBe(0);
    expect(store.allowOnceSize()).toBe(0);
    expect(paths.size()).toBe(0);
    expect(observer.size().admit).toBe(0); // every admitted entry's bookkeeping was released by onDelete
    expect(observer.size().refuse).toBeLessThanOrEqual(MAX_TRACKED);

    // ---- a re-admitted entry-hash is a "first admit" again (state really was dropped, not just capped)
    const before = lines.length;
    observer.admitted("deadbeef", 1);
    observer.forget("deadbeef");
    observer.admitted("deadbeef", 1);
    expect(lines.length - before).toBe(2);

    // heap: trend only — recorded, deliberately not asserted
    const heapAfter = process.memoryUsage().heapUsed;
    console.info(`[P18] heap delta after ${TOTAL} churned capabilities: ${Math.round((heapAfter - heapBefore) / 1024)} KiB (recorded, not asserted)`);
    expect(Number.isFinite(heapAfter)).toBe(true);
  });
});
