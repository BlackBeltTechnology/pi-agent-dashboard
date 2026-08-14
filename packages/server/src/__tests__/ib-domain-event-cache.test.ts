/**
 * IbDomainEventCache — latest-per-entity retention of app-level ib_domain_event
 * frames so a browser that connects after an event was broadcast can converge.
 *
 * See change: replay-invoice-domain-events.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { IbDomainEventCache } from "../ib-domain-event-cache.js";

function frame(eventType: string, data: unknown, sessionId = "s1") {
  return { type: "ib_domain_event" as const, sessionId, event: { eventType, data } };
}

describe("IbDomainEventCache", () => {
  let cache: IbDomainEventCache;
  beforeEach(() => {
    cache = new IbDomainEventCache();
  });

  it("retains only the latest event per invoice key", () => {
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1", state: "received" }));
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1", state: "partner_pending" }));
    const all = cache.getAll();
    const forInv1 = all.filter((f) => f.event.eventType === "ib_invoice_state_changed");
    expect(forInv1).toHaveLength(1);
    expect((forInv1[0].event.data as { state: string }).state).toBe("partner_pending");
  });

  it("caches distinct invoices independently", () => {
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1", state: "received" }));
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv2", state: "queued" }));
    expect(cache.getAll()).toHaveLength(2);
  });

  it("keys invoice lifecycle by invoice_id and non-invoice events by their own entity/type", () => {
    cache.set(frame("ib_invoice_progress", { invoice_id: "inv1", step: 1 }));
    cache.set(frame("ib_invoice_progress", { invoice_id: "inv1", step: 2 })); // supersedes
    cache.set(frame("ib_connector_health", { id: "gmail", reachable: true }));
    cache.set(frame("ib_connector_health", { id: "gmail", reachable: false })); // supersedes
    cache.set(frame("ib_intake_paused", { by: "operator" }));
    const all = cache.getAll();
    expect(all).toHaveLength(3);
    expect((all.find((f) => f.event.eventType === "ib_invoice_progress")!.event.data as { step: number }).step).toBe(2);
    expect((all.find((f) => f.event.eventType === "ib_connector_health")!.event.data as { reachable: boolean }).reachable).toBe(false);
  });

  it("bounds memory by evicting the oldest-inserted entry beyond the cap", () => {
    const small = new IbDomainEventCache(3);
    small.set(frame("ib_invoice_state_changed", { invoice_id: "a" }));
    small.set(frame("ib_invoice_state_changed", { invoice_id: "b" }));
    small.set(frame("ib_invoice_state_changed", { invoice_id: "c" }));
    small.set(frame("ib_invoice_state_changed", { invoice_id: "d" })); // evicts "a"
    const ids = small.getAll().map((f) => (f.event.data as { invoice_id: string }).invoice_id).sort();
    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("refreshes recency on update so an updated key is not the eviction victim", () => {
    const small = new IbDomainEventCache(2);
    small.set(frame("ib_invoice_state_changed", { invoice_id: "a", n: 1 }));
    small.set(frame("ib_invoice_state_changed", { invoice_id: "b", n: 1 }));
    small.set(frame("ib_invoice_state_changed", { invoice_id: "a", n: 2 })); // touch "a"
    small.set(frame("ib_invoice_state_changed", { invoice_id: "c", n: 1 })); // evicts "b" (now oldest)
    const ids = small.getAll().map((f) => (f.event.data as { invoice_id: string }).invoice_id).sort();
    expect(ids).toEqual(["a", "c"]);
  });

  it("clearForSession drops only entries originating from that session", () => {
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1" }, "sA"));
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv2" }, "sB"));
    cache.clearForSession("sA");
    const all = cache.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe("sB");
  });

  it("skips malformed frames without throwing and still caches well-formed ones", () => {
    expect(() => cache.set({ type: "ib_domain_event", sessionId: "s1", event: { eventType: "x", data: null } } as never)).not.toThrow();
    expect(() => cache.set({ type: "ib_domain_event", sessionId: "", event: { eventType: "x", data: {} } } as never)).not.toThrow();
    expect(() => cache.set({ type: "ib_domain_event", sessionId: "s1", event: { eventType: "", data: {} } } as never)).not.toThrow();
    expect(cache.getAll()).toHaveLength(0);
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "ok" }));
    expect(cache.getAll()).toHaveLength(1);
  });

  it("reset empties the cache", () => {
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1" }));
    cache.reset();
    expect(cache.getAll()).toHaveLength(0);
  });
});
