/**
 * The queued-invoice work source — the invoice-side half of automation fan-out.
 *
 * TWO LAYERS, both exercised here:
 *   1. `createInMemoryQueuedInvoiceSource` — the FIXTURE lease store the Fake
 *      engine binding uses (CI / worktree / release-cut, where the `file:`
 *      sibling is absent). Its semantics MIRROR the real engine's SQLite source,
 *      so these tests pin the contract both bindings must honour.
 *   2. `createQueuedInvoiceWorkSource` — the registered wrapper that routes each
 *      vend to the ENGINE's workspace-bound source and routes `ack`/`nack` back
 *      to the workspace that vended. It holds NO leases: the engine owns them
 *      (fenced in SQLite, cross-process, restart-durable), and a second lease
 *      authority in the host would race into two-children-one-invoice.
 *
 * These are the INVOICE guarantees the retired per-invoice engine fan-out used
 * to assert inside the generic automation plugin. They now live with the source
 * that owns invoice knowledge:
 *   - one leased handle per invoice (⇒ one invoice per spawned session);
 *   - each concurrent lease is a DISTINCT invoice (never a shared record);
 *   - an invoice with a live lease is never re-vended, and a targeted `take`
 *     for it is REFUSED (single-flight across both dispatch paths);
 *   - an empty queue vends ZERO handles (⇒ the engine spawns nothing);
 *   - the bound is respected and the excess DEFERS (no truncation);
 *   - `ack` drops the invoice, `nack` returns it, and a lease left dangling by
 *     a lost run expires so the invoice is never stranded;
 *   - `idempotencyKey` is the invoice's own id (stable across redelivery).
 *
 * See change: relocate-fanout-to-work-source.
 */
import { describe, expect, it } from "vitest";
import type { EngineWorkSource } from "../engine/port.js";
import {
  createInMemoryQueuedInvoiceSource,
  createQueuedInvoiceWorkSource,
} from "../queued-invoice-work-source.js";

const CWD = "/w";

/** The fixture lease store, wrapped so the registered-source API is under test
 *  end to end (routing wrapper → per-cwd engine source). */
function makeSource(queued: string[], opts: { visibilityTimeoutMs?: number } = {}) {
  let now = 1_000_000;
  const calls: string[] = [];
  const state = { queued: [...queued] };
  const perCwd = new Map<string, EngineWorkSource>();
  const source = createQueuedInvoiceWorkSource({
    sourceFor: (cwd) => {
      const hit = perCwd.get(cwd);
      if (hit) return hit;
      const src = createInMemoryQueuedInvoiceSource({
        listQueued: async () => {
          calls.push(cwd);
          return [...state.queued];
        },
        now: () => now,
        ...(opts.visibilityTimeoutMs ? { visibilityTimeoutMs: opts.visibilityTimeoutMs } : {}),
      });
      perCwd.set(cwd, src);
      return src;
    },
  });
  return {
    source,
    state,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("queued-invoice work source — vending", () => {
  it("leases up to n DISTINCT queued invoices, keyed by invoice id", async () => {
    const h = makeSource(["inv-1", "inv-2", "inv-3"]);

    const handles = await h.source.next(3, { cwd: CWD });

    expect(handles.map((x) => x.item)).toEqual(["inv-1", "inv-2", "inv-3"]);
    expect(new Set(handles.map((x) => x.item)).size).toBe(3);
    // the idempotency key is the invoice identity, NOT the lease token
    expect(handles.map((x) => x.idempotencyKey)).toEqual(["inv-1", "inv-2", "inv-3"]);
    expect(new Set(handles.map((x) => x.leaseToken)).size).toBe(3);
    expect(h.calls).toEqual([CWD]);
  });

  it("respects the bound and DEFERS the rest to a later vend", async () => {
    const h = makeSource(["inv-1", "inv-2", "inv-3"]);

    const first = await h.source.next(2, { cwd: CWD });
    expect(first.map((x) => x.item)).toEqual(["inv-1", "inv-2"]);

    // The deferred invoice is still queued and vends next time; the two already
    // leased are NOT vended again.
    const second = await h.source.next(2, { cwd: CWD });
    expect(second.map((x) => x.item)).toEqual(["inv-3"]);
  });

  it("an EMPTY queue vends nothing (the engine then spawns nothing)", async () => {
    const h = makeSource([]);
    expect(await h.source.next(4, { cwd: CWD })).toEqual([]);
  });

  it("vends nothing when the engine supplies no workspace", async () => {
    const h = makeSource(["inv-1"]);
    expect(await h.source.next(4)).toEqual([]);
    expect(h.calls).toEqual([]); // never guesses a workspace
  });

  it("skips a non-string / empty id defensively", async () => {
    const h = makeSource(["", "inv-1"]);
    const handles = await h.source.next(4, { cwd: CWD });
    expect(handles.map((x) => x.item)).toEqual(["inv-1"]);
  });
});

describe("queued-invoice work source — single flight", () => {
  it("refuses a targeted take for an invoice a vend already leased", async () => {
    const h = makeSource(["inv-1", "inv-2"]);
    await h.source.next(2, { cwd: CWD });

    expect(await h.source.take("inv-1", { cwd: CWD })).toBeNull();
    expect(await h.source.take("inv-2", { cwd: CWD })).toBeNull();
  });

  it("never re-vends an invoice a targeted take leased", async () => {
    const h = makeSource(["inv-1", "inv-2"]);

    const taken = await h.source.take("inv-1", { cwd: CWD });
    expect(taken?.item).toBe("inv-1");

    const handles = await h.source.next(4, { cwd: CWD });
    expect(handles.map((x) => x.item)).toEqual(["inv-2"]);
  });

  it("refuses a second targeted take for the same invoice", async () => {
    const h = makeSource(["inv-1"]);
    expect((await h.source.take("inv-1", { cwd: CWD }))?.item).toBe("inv-1");
    expect(await h.source.take("inv-1", { cwd: CWD })).toBeNull();
  });

  it("a targeted take does not block a DIFFERENT invoice", async () => {
    const h = makeSource(["inv-1", "inv-2"]);
    expect((await h.source.take("inv-1", { cwd: CWD }))?.item).toBe("inv-1");
    expect((await h.source.take("inv-2", { cwd: CWD }))?.item).toBe("inv-2");
  });
});

describe("queued-invoice work source — release", () => {
  it("nack returns the invoice: re-vendable immediately (no stranding)", async () => {
    const h = makeSource(["inv-1"]);
    const [handle] = await h.source.next(1, { cwd: CWD });

    h.source.nack(handle!.leaseToken);

    const again = await h.source.next(1, { cwd: CWD });
    expect(again.map((x) => x.item)).toEqual(["inv-1"]);
  });

  it("ack drops the lease; the invoice returns only if the store still queues it", async () => {
    const h = makeSource(["inv-1"]);
    const [handle] = await h.source.next(1, { cwd: CWD });

    h.source.ack(handle!.leaseToken);
    // A processed invoice leaves the queued state in the engine's own store.
    h.state.queued = [];

    expect(await h.source.next(1, { cwd: CWD })).toEqual([]);
  });

  it("is fenced: a stale/unknown token is a no-op for ack and nack", async () => {
    const h = makeSource(["inv-1"]);
    const [handle] = await h.source.next(1, { cwd: CWD });

    h.source.nack(handle!.leaseToken);
    h.source.nack(handle!.leaseToken); // stale — must not double-release
    h.source.ack("never-issued");

    const re = await h.source.next(4, { cwd: CWD });
    expect(re.map((x) => x.item)).toEqual(["inv-1"]);
  });

  it("reclaims a lease whose run died without any terminal signal", async () => {
    const h = makeSource(["inv-1"], { visibilityTimeoutMs: 1_000 });
    await h.source.next(1, { cwd: CWD });

    // Still inside the visibility window: the invoice stays in flight.
    h.advance(999);
    expect(await h.source.next(1, { cwd: CWD })).toEqual([]);
    expect(await h.source.take("inv-1", { cwd: CWD })).toBeNull();

    // Past it: reclaimed, and dispatchable again.
    h.advance(2);
    const handles = await h.source.next(1, { cwd: CWD });
    expect(handles.map((x) => x.item)).toEqual(["inv-1"]);
  });
});

describe("registered wrapper — the engine owns the leases, the host only routes", () => {
  /** A recording stand-in for the ENGINE's workspace-bound source. */
  let sourceSeq = 0;
  function engineSource(items: string[], opts: { withTake?: boolean } = {}) {
    const calls: Array<{ op: string; arg: unknown }> = [];
    const leased = new Set<string>();
    // Globally-unique tokens, as the engine mints (UUIDs) — the host's release
    // routing depends on it, and this fixture must not be more forgiving.
    const tag = `s${++sourceSeq}`;
    let seq = 0;
    const src: EngineWorkSource = {
      next: (n) => {
        calls.push({ op: "next", arg: n });
        const out = items
          .filter((i) => !leased.has(i))
          .slice(0, n)
          .map((item) => {
            leased.add(item);
            seq += 1;
            return { item, leaseToken: `${tag}-t${seq}`, idempotencyKey: item };
          });
        return out;
      },
      ack: (t) => calls.push({ op: "ack", arg: t }),
      nack: (t) => calls.push({ op: "nack", arg: t }),
      ...(opts.withTake === false
        ? {}
        : { take: (id: string) => (leased.has(id) ? null : (leased.add(id), { item: id, leaseToken: `${tag}-k-${id}`, idempotencyKey: id })) }),
    };
    return { src, calls };
  }

  it("routes each vend to the workspace the engine bound, and caches per cwd", async () => {
    const a = engineSource(["inv-a"]);
    const b = engineSource(["inv-b"]);
    const built: string[] = [];
    const source = createQueuedInvoiceWorkSource({
      sourceFor: (cwd) => {
        built.push(cwd);
        return cwd === "/wa" ? a.src : b.src;
      },
    });

    expect((await source.next(4, { cwd: "/wa" })).map((h) => h.item)).toEqual(["inv-a"]);
    expect((await source.next(4, { cwd: "/wb" })).map((h) => h.item)).toEqual(["inv-b"]);
    await source.next(4, { cwd: "/wa" });

    // one construction per workspace (the engine source is cached, not rebuilt)
    expect(built).toEqual(["/wa", "/wb"]);
  });

  it("routes ack/nack back to the workspace that vended the token", async () => {
    const a = engineSource(["inv-a"]);
    const b = engineSource(["inv-b"]);
    const source = createQueuedInvoiceWorkSource({
      sourceFor: (cwd) => (cwd === "/wa" ? a.src : b.src),
    });

    const [ha] = await source.next(1, { cwd: "/wa" });
    const [hb] = await source.next(1, { cwd: "/wb" });
    source.ack(ha!.leaseToken);
    source.nack(hb!.leaseToken);

    expect(a.calls.filter((c) => c.op === "ack").map((c) => c.arg)).toEqual([ha!.leaseToken]);
    expect(a.calls.some((c) => c.op === "nack")).toBe(false);
    expect(b.calls.filter((c) => c.op === "nack").map((c) => c.arg)).toEqual([hb!.leaseToken]);
  });

  it("an unknown/stale token is a no-op, never sent to a random workspace", async () => {
    const a = engineSource(["inv-a"]);
    const source = createQueuedInvoiceWorkSource({ sourceFor: () => a.src });

    const [h] = await source.next(1, { cwd: CWD });
    source.ack(h!.leaseToken);
    source.ack(h!.leaseToken); // stale — the engine must not see a second ack
    source.nack("never-issued");

    expect(a.calls.filter((c) => c.op === "ack" || c.op === "nack")).toHaveLength(1);
  });

  it("vends nothing when the engine binding exposes no source (never mints its own lease)", async () => {
    const warnings: string[] = [];
    const source = createQueuedInvoiceWorkSource({
      sourceFor: () => undefined,
      warn: (m) => warnings.push(m),
    });

    expect(await source.next(4, { cwd: CWD })).toEqual([]);
    // `take` REJECTS rather than resolving null: null would be reported to the
    // operator as "already in flight" (409), which would be a lie.
    await expect(source.take("inv-a", { cwd: CWD })).rejects.toThrow(/unavailable/);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("reports unavailable when the engine cannot lease ONE named invoice", async () => {
    // No `take` on the engine source ⇒ the targeted path must NOT be emulated by
    // leasing others and releasing them (single-flight would depend on timing).
    const a = engineSource(["inv-a", "inv-b"], { withTake: false });
    const source = createQueuedInvoiceWorkSource({ sourceFor: () => a.src });

    await expect(source.take("inv-a", { cwd: CWD })).rejects.toThrow(/takeQueued/);
    expect(a.calls.some((c) => c.op === "next")).toBe(false); // nothing leased
  });

  it("survives a throwing engine binding without vending", async () => {
    const warnings: string[] = [];
    const source = createQueuedInvoiceWorkSource({
      sourceFor: () => {
        throw new Error("store locked");
      },
      warn: (m) => warnings.push(m),
    });

    expect(await source.next(2, { cwd: CWD })).toEqual([]);
    expect(warnings.some((w) => w.includes("store locked"))).toBe(true);
  });
});
