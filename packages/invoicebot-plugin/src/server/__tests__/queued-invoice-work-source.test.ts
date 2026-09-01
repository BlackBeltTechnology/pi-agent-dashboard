/**
 * The queued-invoice work source — the invoice-side half of automation fan-out.
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
import { createQueuedInvoiceWorkSource } from "../queued-invoice-work-source.js";

const CWD = "/w";

function makeSource(queued: string[], opts: { visibilityTimeoutMs?: number } = {}) {
  let now = 1_000_000;
  const calls: string[] = [];
  const state = { queued: [...queued] };
  const source = createQueuedInvoiceWorkSource({
    listQueued: async (cwd) => {
      calls.push(cwd);
      return [...state.queued];
    },
    now: () => now,
    ...(opts.visibilityTimeoutMs ? { visibilityTimeoutMs: opts.visibilityTimeoutMs } : {}),
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
