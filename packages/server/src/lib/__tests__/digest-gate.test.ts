import { describe, expect, it } from "vitest";
import { createDigestGate, type DigestLane } from "../digest-gate.js";

describe("createDigestGate", () => {
  it("never runs more than max holders", async () => {
    const gate = createDigestGate(2);
    const a = await gate.acquire("verify");
    const b = await gate.acquire("verify");
    let third = false;
    const p = gate.acquire("verify").then((r) => {
      third = true;
      return r;
    });
    await Promise.resolve();
    expect(third).toBe(false);
    expect(gate.stats()).toMatchObject({ active: 2, queued: 1 });
    a();
    (await p)();
    b();
    expect(gate.stats().peakActive).toBe(2);
  });

  it("serves a queued baseline before any queued verify", async () => {
    const order: DigestLane[] = [];
    const gate = createDigestGate(1, (l) => order.push(l));
    const hold = await gate.acquire("verify");
    const waiters = [
      ...[1, 2, 3, 4].map(() => gate.acquire("verify").then((r) => r())),
      gate.acquire("baseline").then((r) => r()),
    ];
    hold();
    await Promise.all(waiters);
    expect(order).toEqual(["verify", "baseline", "verify", "verify", "verify", "verify"]);
  });

  it("an aborted waiter leaves the queue and never takes a slot", async () => {
    const gate = createDigestGate(1);
    const hold = await gate.acquire("verify");
    const ac = new AbortController();
    const waiting = gate.acquire("verify", ac.signal);
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(gate.stats().queued).toBe(0);
    hold();
    expect(gate.stats().active).toBe(0);
  });

  it("release is idempotent", async () => {
    const gate = createDigestGate(1);
    const r = await gate.acquire("verify");
    r();
    r();
    expect(gate.stats().active).toBe(0);
  });

  it("rejects immediately when already aborted", async () => {
    const gate = createDigestGate(1);
    const ac = new AbortController();
    ac.abort();
    await expect(gate.acquire("baseline", ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
