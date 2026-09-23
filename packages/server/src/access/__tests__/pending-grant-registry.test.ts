import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DenialInput,
  formatTransition,
  GRANT_BACKOFF_MS,
  GRANT_CHANNEL_MAX_ENTRIES,
  GRANT_DEFERRED_MAX_ENTRIES,
  GRANT_ENTRY_TTL_MS,
  GRANT_MAX_CONCURRENT_DIALOGS,
  GRANT_PLANE_PROMPTS_PER_MINUTE,
  GRANT_REGISTRY_CAPACITY,
  type GrantTransition,
  type PendingGrant,
  PendingGrantRegistry,
} from "../pending-grant-registry.js";
import { sourceChannel } from "../source-channel.js";

/**
 * Pending access-request registry (change: add-access-grant-dialog, tasks
 * 4.1-4.4 + 2b.6; test-plan #E10-#E12, #E14, #E20-#E23, #E47-#E49).
 */

const OK = { promptable: true } as const;
const T0 = 1_000_000;

let transitions: GrantTransition[];
let expired: PendingGrant[];
let reg: PendingGrantRegistry;

beforeEach(() => {
  transitions = [];
  expired = [];
  reg = new PendingGrantRegistry({
    onTransition: (t) => transitions.push(t),
    onExpire: (e) => expired.push(e),
  });
});

const fs = (subject: string, over: Partial<DenialInput> = {}): DenialInput => ({
  plane: "filesystem",
  subject,
  mode: "held",
  channel: "sock-A",
  store: "access-grants.json",
  ...over,
});

/** Answer an entry the way a browser would. */
const answer = (e: PendingGrant, verdict = "deny", subject = e.subject) => ({
  promptId: e.promptId,
  plane: e.plane,
  subject,
  verdict,
});

const promptedCount = () => transitions.filter((t) => t.transition === "prompted").length;

describe("4.1 record / take / expiry / capacity", () => {
  it("prompts a fresh eligible denial", () => {
    const out = reg.record(fs("/a"), OK, T0);
    expect(out.kind).toBe("prompt");
    expect(reg.size).toBe(1);
  });

  it("expiry removes the entry AND reports it, so a held request gets its denial", () => {
    const out = reg.record(fs("/a"), OK, T0);
    reg.expire(T0 + GRANT_ENTRY_TTL_MS + 1);
    expect(reg.size).toBe(0);
    expect(expired.map((e) => e.subject)).toEqual(["/a"]);
    expect(out.kind === "prompt" && out.entry.subject).toBe("/a");
  });

  it("an entry is not expired AT its ttl, only after it", () => {
    reg.record(fs("/a"), OK, T0);
    reg.expire(T0 + GRANT_ENTRY_TTL_MS);
    expect(reg.size).toBe(1);
  });

  it("an answer to an expired entry does not settle it", () => {
    const out = reg.record(fs("/a"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    const r = reg.settle(answer(out.entry, "allow-once"), T0 + GRANT_ENTRY_TTL_MS + 1);
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect(expired).toHaveLength(1);
  });

  it("#E10 at capacity-1, one more is accepted", () => {
    for (let i = 0; i < GRANT_REGISTRY_CAPACITY - 1; i++) reg.record(fs(`/s${i}`, { channel: `c${i}` }), OK, T0);
    const out = reg.record(fs("/last", { channel: "c-last" }), OK, T0);
    expect(out.kind).not.toBe("refused");
    expect(reg.size).toBe(GRANT_REGISTRY_CAPACITY);
  });

  it("#E11 at capacity, a new denial is refused and NO live entry is evicted", () => {
    for (let i = 0; i < GRANT_REGISTRY_CAPACITY; i++) reg.record(fs(`/s${i}`, { channel: `c${i}` }), OK, T0);
    const first = reg.list(T0)[0];
    const out = reg.record(fs("/overflow", { channel: "c-x" }), OK, T0);
    expect(out).toEqual({ kind: "refused", reason: "capacity" });
    expect(reg.size).toBe(GRANT_REGISTRY_CAPACITY);
    expect(reg.get(first.promptId)).toBeDefined();
  });

  it("malformed answers are discarded and counted, settling nothing", () => {
    const out = reg.record(fs("/a"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    for (const bad of [null, 42, {}, { promptId: out.entry.promptId }, { ...answer(out.entry), verdict: "yes" }]) {
      expect(reg.settle(bad, T0).ok).toBe(false);
    }
    expect(reg.settle({ ...answer(out.entry), promptId: "nope" }, T0)).toEqual({ ok: false, reason: "unknown" });
    expect(reg.size).toBe(1);
    expect(reg.snapshotStats().malformed).toBe(6);
  });

  it("forget releases an aborted request without reporting it as expired", () => {
    const out = reg.record(fs("/a"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    expect(reg.forget(out.entry.promptId)?.subject).toBe("/a");
    expect(reg.size).toBe(0);
    expect(expired).toHaveLength(0);
    expect(transitions.at(-1)?.transition).toBe("aborted");
  });
});

describe("take-once: the first well-formed answer wins (#E12)", () => {
  it("a second answer 10 ms later is a no-op, counted as a duplicate", () => {
    const out = reg.record(fs("/a"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    const first = reg.settle(answer(out.entry, "allow-always"), T0);
    const second = reg.settle(answer(out.entry, "deny"), T0 + 10);
    expect(first.ok && first.verdict).toBe("allow-always");
    expect(second).toEqual({ ok: false, reason: "duplicate" });
    expect(reg.snapshotStats().settled).toBe(1);
    expect(reg.snapshotStats().duplicates).toBe(1);
  });
});

describe("4.2 keyed by (plane, subject)", () => {
  it("a repeat denial joins the existing entry: one entry, one dialog", () => {
    reg.record(fs("/a"), OK, T0);
    const again = reg.record(fs("/a"), OK, T0 + 1);
    expect(again.kind).toBe("joined");
    expect(reg.size).toBe(1);
    expect(promptedCount()).toBe(1);
  });

  it("#E14 the same subject string on two planes is two entries; settling one leaves the other", () => {
    const f = reg.record(fs("/a/b"), OK, T0);
    const c = reg.record(fs("/a/b", { plane: "cwd", channel: "sock-B", store: "pinned-dirs" }), OK, T0);
    expect(reg.size).toBe(2);
    if (f.kind !== "prompt" || c.kind !== "prompt") throw new Error("expected prompts");
    expect(reg.settle(answer(f.entry), T0).ok).toBe(true);
    expect(reg.get(c.entry.promptId)).toBeDefined();
  });

  it("an answer naming the wrong plane is malformed", () => {
    const out = reg.record(fs("/a"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    expect(reg.settle({ ...answer(out.entry), plane: "cwd" }, T0)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("4.3 volume controls degrade to record-only", () => {
  it("a polling client raises exactly one dialog, before and after a deny", () => {
    const out = reg.record(fs("/poll"), OK, T0);
    for (let i = 1; i <= 20; i++) reg.record(fs("/poll"), OK, T0 + i * 100);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(out.entry, "deny"), T0 + 3_000);
    for (let i = 1; i <= 20; i++) reg.record(fs("/poll"), OK, T0 + 3_000 + i * 100);
    expect(promptedCount()).toBe(1);
  });

  it("a flood from distinct requesters never exceeds the global dialog cap", () => {
    for (let i = 0; i < 40; i++) reg.record(fs(`/f${i}`, { channel: `c${i}` }), OK, T0);
    expect(promptedCount()).toBe(GRANT_MAX_CONCURRENT_DIALOGS);
    expect(reg.snapshotStats().flooded["concurrent-cap"]).toBe(40 - GRANT_MAX_CONCURRENT_DIALOGS);
  });

  it("#E20 suppressed inside the 120 s backoff, prompts again after it", () => {
    const out = reg.record(fs("/r"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(out.entry, "deny"), T0);
    const at119 = reg.record(fs("/r"), OK, T0 + 119_000);
    expect(at119).toMatchObject({ kind: "recorded", reason: "backoff" });
    const at121 = reg.record(fs("/r"), OK, T0 + GRANT_BACKOFF_MS + 1_000);
    expect(at121.kind).toBe("prompt");
    expect(reg.size).toBe(1);
  });

  it("the per-plane rate caps prompts per minute, then recovers", () => {
    let t = T0;
    for (let i = 0; i < GRANT_PLANE_PROMPTS_PER_MINUTE; i++) {
      const out = reg.record(fs(`/p${i}`, { channel: `c${i}` }), OK, t);
      if (out.kind !== "prompt") throw new Error(`expected prompt #${i}`);
      reg.settle(answer(out.entry), t);
      t += 1_000;
    }
    expect(reg.record(fs("/p-over", { channel: "c-over" }), OK, t)).toMatchObject({ reason: "plane-rate" });
    expect(reg.record(fs("/p-later", { channel: "c-later" }), OK, T0 + 61_000).kind).toBe("prompt");
  });

  it("an ineligible first denial is promoted when an eligible one joins", () => {
    reg.record(fs("/a"), { promptable: false, reason: "ineligible" }, T0);
    expect(reg.record(fs("/a"), OK, T0 + 1).kind).toBe("prompt");
    expect(reg.size).toBe(1);
  });
});

describe("D9 resolved: rotating remote sources cannot starve held prompts", () => {
  const net = (ip: string): DenialInput => ({
    plane: "network",
    subject: ip,
    mode: "deferred",
    channel: sourceChannel(ip),
    store: "config.trustedNetworks",
  });

  it("an IPv6 peer rotating within its /64 is one requester, bounded by the channel share", () => {
    const out = Array.from({ length: 40 }, (_, i) => reg.record(net(`2001:db8:1:2::${(i + 1).toString(16)}`), OK, T0));
    expect(out.filter((o) => o.kind !== "refused")).toHaveLength(GRANT_CHANNEL_MAX_ENTRIES);
  });

  it("deferred entries from many allocations stop at the deferred share; held prompts still land", () => {
    const out = Array.from({ length: 40 }, (_, i) => reg.record(net(`2001:db8:${i + 1}::1`), OK, T0));
    expect(out.filter((o) => o.kind !== "refused")).toHaveLength(GRANT_DEFERRED_MAX_ENTRIES);
    expect(out.at(-1)).toEqual({ kind: "refused", reason: "deferred-share" });
    expect(reg.record(fs("/mine", { channel: "sock-op" }), OK, T0).kind).not.toBe("refused");
    expect(reg.snapshotStats().flooded["deferred-share"]).toBe(40 - GRANT_DEFERRED_MAX_ENTRIES);
  });
});

describe("2b.6 per-channel bounds isolate requesters", () => {
  it("#E21 one channel past its entry share gets no entry at all", () => {
    for (let i = 0; i < GRANT_CHANNEL_MAX_ENTRIES; i++) {
      expect(reg.record(fs(`/a${i}`), OK, T0).kind).not.toBe("refused");
    }
    expect(reg.record(fs("/a-over"), OK, T0)).toEqual({ kind: "refused", reason: "channel-share" });
    expect(reg.size).toBe(GRANT_CHANNEL_MAX_ENTRIES);
  });

  it("#E22 requester A at its bound does not stop requester B from prompting", () => {
    for (let i = 0; i < GRANT_CHANNEL_MAX_ENTRIES + 3; i++) reg.record(fs(`/a${i}`), OK, T0);
    const b = reg.record(fs("/b", { channel: "sock-B" }), OK, T0);
    expect(b.kind).toBe("prompt");
    expect(reg.record(fs("/a-again"), OK, T0).kind).toBe("refused");
  });

  it("no single requester holds both dialog slots", () => {
    reg.record(fs("/a1"), OK, T0);
    expect(reg.record(fs("/a2"), OK, T0)).toMatchObject({ kind: "recorded", reason: "channel-concurrent" });
    expect(reg.record(fs("/b1", { channel: "sock-B" }), OK, T0).kind).toBe("prompt");
  });

  it("#E23 per-channel suppression is distinguishable from the global cap", () => {
    reg.record(fs("/a1"), OK, T0);
    reg.record(fs("/b1", { channel: "sock-B" }), OK, T0);
    const perChannel = reg.record(fs("/a2"), OK, T0);
    const global = reg.record(fs("/c1", { channel: "sock-C" }), OK, T0);
    expect(perChannel).toMatchObject({ reason: "channel-concurrent" });
    expect(global).toMatchObject({ reason: "concurrent-cap" });
    const s = reg.snapshotStats();
    expect(s.flooded["channel-concurrent"]).toBe(1);
    expect(s.flooded["concurrent-cap"]).toBe(1);
  });

  it("a deferred source is limited to 1 prompt per plane per minute; a held channel is not", () => {
    const net = (subject: string): DenialInput => ({
      plane: "network",
      subject,
      mode: "deferred",
      channel: "203.0.113.9",
      store: "config.trustedNetworks",
    });
    const first = reg.record(net("203.0.113.9"), OK, T0);
    if (first.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(first.entry, "deny"), T0);
    expect(reg.record(net("203.0.113.0/24"), OK, T0 + 1_000)).toMatchObject({ reason: "channel-rate" });

    const held = reg.record(fs("/h1"), OK, T0);
    if (held.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(held.entry), T0);
    expect(reg.record(fs("/h2"), OK, T0 + 1_000).kind).toBe("prompt");
  });
});

describe("verdict subject: the denied one or an offered rung only", () => {
  const withLadder = () => reg.record(fs("/a/b/c", { ancestors: ["/a/b", "/a"] }), OK, T0);

  it("#E47 a verdict naming an unoffered directory is refused and the entry stays pending", () => {
    const out = withLadder();
    if (out.kind !== "prompt") throw new Error("expected prompt");
    expect(reg.settle(answer(out.entry, "allow-always", "/elsewhere"), T0)).toEqual({
      ok: false,
      reason: "unoffered-subject",
    });
    expect(reg.get(out.entry.promptId)).toBeDefined();
  });

  it("#E48 a verdict naming an offered rung settles, recording what it widened from", () => {
    const out = withLadder();
    if (out.kind !== "prompt") throw new Error("expected prompt");
    const r = reg.settle(answer(out.entry, "allow-always", "/a/b"), T0);
    expect(r).toMatchObject({ ok: true, subject: "/a/b", widenedFrom: "/a/b/c" });
  });

  it("allow-once on a deferred plane is malformed: nothing is suspended for it to release", () => {
    const out = reg.record(
      { plane: "cors", subject: "https://x.example", mode: "deferred", channel: "1.2.3.4", store: "cors.allowedOrigins" },
      OK,
      T0,
    );
    if (out.kind !== "prompt") throw new Error("expected prompt");
    expect(reg.settle(answer(out.entry, "allow-once"), T0)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("#E49 prompting disabled: recorded, listed, and answerable without a dialog", () => {
  it("records without prompting and can still be answered from the Access surface", () => {
    const out = reg.record(fs("/fresh"), { promptable: false, reason: "disabled" }, T0);
    expect(out).toMatchObject({ kind: "recorded", reason: "disabled" });
    expect(promptedCount()).toBe(0);
    const [pending] = reg.list(T0);
    expect(pending.subject).toBe("/fresh");
    expect(reg.settle(answer(pending, "deny"), T0).ok).toBe(true);
  });
});

describe("4.4 transition log", () => {
  it("a degraded hold is distinguishable from an ineligible denial", () => {
    reg.record(fs("/held"), { promptable: false, reason: "report-mode" }, T0);
    reg.record(fs("/nocap"), { promptable: false, reason: "ineligible" }, T0);
    const labels = transitions.filter((t) => t.transition === "degraded").map(formatTransition);
    expect(labels[0]).toContain("degraded:report-mode");
    expect(labels[1]).toContain("degraded:ineligible");
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("carries plane, subject, mode, and the store an allow-always wrote", () => {
    const out = reg.record(fs("/w"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(out.entry, "allow-always"), T0);
    const settled = transitions.find((t) => t.transition === "settled");
    expect(formatTransition(settled!)).toBe(
      '[access-grant] settled:allow-always plane=filesystem subject="/w" mode=held store=access-grants.json',
    );
  });

  it("a deny records no store", () => {
    const out = reg.record(fs("/d"), OK, T0);
    if (out.kind !== "prompt") throw new Error("expected prompt");
    reg.settle(answer(out.entry, "deny"), T0);
    expect(transitions.find((t) => t.transition === "settled")?.store).toBeUndefined();
  });

  it("quotes subjects, so an attacker-shaped subject cannot forge a log line", () => {
    const line = formatTransition({
      transition: "recorded",
      plane: "cors",
      subject: 'https://x\n[access-grant] settled:allow-always plane=filesystem subject="/"',
      mode: "deferred",
    });
    expect(line.split("\n")).toHaveLength(1);
  });

  it("defaults to one stderr line per transition", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    new PendingGrantRegistry().record(fs("/z"), OK, T0);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("[access-grant] recorded"),
      expect.stringContaining("[access-grant] prompted"),
    ]);
    spy.mockRestore();
  });
});
