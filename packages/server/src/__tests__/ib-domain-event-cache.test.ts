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

/**
 * Greeting-stream retention (change: restore-assistant-greeting-stream): greeting
 * frames are EXEMPT from latest-per-key convergence and retained as a bounded,
 * per-session, insertion-ordered stream replayed IN ORDER on connect.
 */
function greeting(id: string, state: string, sessionId = "s1", content = "hi") {
  return frame("ib_greeting", { id, state, content }, sessionId);
}

describe("IbDomainEventCache greeting stream", () => {
  let cache: IbDomainEventCache;
  beforeEach(() => {
    cache = new IbDomainEventCache();
  });

  it("retains greetings as an ordered stream, not collapsed to newest, and exempt from getAll()", () => {
    cache.set(greeting("g1", "partner_pending"));
    cache.set(greeting("g2", "pending_approval"));
    cache.set(greeting("g3", "exported"));
    // Not in the latest-per-key map at all.
    expect(cache.getAll()).toHaveLength(0);
    const stream = cache.getGreetingsForConnect();
    expect(stream.map((g) => (g.frame.event.data as { state: string }).state)).toEqual([
      "partner_pending",
      "pending_approval",
      "exported",
    ]);
    // Each carries a stable id + a monotonic ordering key.
    expect(stream.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(stream[0].order).toBeLessThan(stream[1].order);
    expect(stream[1].order).toBeLessThan(stream[2].order);
  });

  it("is idempotent by stable id: a re-delivered greeting updates in place, no duplicate", () => {
    cache.set(greeting("g1", "partner_pending", "s1", "first"));
    cache.set(greeting("g2", "exported"));
    cache.set(greeting("g1", "partner_pending", "s1", "updated")); // same id
    const stream = cache.getGreetingsForConnect();
    expect(stream).toHaveLength(2);
    const g1 = stream.find((g) => g.id === "g1")!;
    expect((g1.frame.event.data as { content: string }).content).toBe("updated");
    // Order preserved: g1 stays before g2 despite the late update.
    expect(stream.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("non-greeting frames still use latest-per-key convergence alongside greetings", () => {
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1", state: "received" }));
    cache.set(frame("ib_invoice_state_changed", { invoice_id: "inv1", state: "exported" }));
    cache.set(greeting("g1", "exported"));
    // Card state collapsed to newest; greeting kept separately.
    expect(cache.getAll()).toHaveLength(1);
    expect((cache.getAll()[0].event.data as { state: string }).state).toBe("exported");
    expect(cache.getGreetingsForConnect()).toHaveLength(1);
  });

  it("session death clears that session's retained greetings only", () => {
    cache.set(greeting("a1", "exported", "sA"));
    cache.set(greeting("b1", "exported", "sB"));
    cache.clearForSession("sA");
    const stream = cache.getGreetingsForConnect();
    expect(stream).toHaveLength(1);
    expect(stream[0].frame.sessionId).toBe("sB");
  });

  it("bounds each session's stream, evicting the oldest greeting first", () => {
    const small = new IbDomainEventCache(500, 3);
    small.set(greeting("g1", "a"));
    small.set(greeting("g2", "b"));
    small.set(greeting("g3", "c"));
    small.set(greeting("g4", "d")); // evicts g1
    const ids = small.getGreetingsForConnect().map((g) => g.id);
    expect(ids).toEqual(["g2", "g3", "g4"]);
  });

  it("orders greetings across sessions by global emission order", () => {
    cache.set(greeting("a1", "s", "sA"));
    cache.set(greeting("b1", "s", "sB"));
    cache.set(greeting("a2", "s", "sA"));
    const ids = cache.getGreetingsForConnect().map((g) => g.id);
    expect(ids).toEqual(["a1", "b1", "a2"]);
  });

  it("synthesizes a positional id when a greeting frame lacks one, no collapse", () => {
    cache.set(frame("ib_greeting", { state: "a", content: "1" }));
    cache.set(frame("ib_greeting", { state: "b", content: "2" }));
    const stream = cache.getGreetingsForConnect();
    expect(stream).toHaveLength(2);
    expect(new Set(stream.map((g) => g.id)).size).toBe(2);
  });

  it("reset also empties the greeting stream", () => {
    cache.set(greeting("g1", "exported"));
    cache.reset();
    expect(cache.getGreetingsForConnect()).toHaveLength(0);
  });
});
