/**
 * Per-provider readiness — folded from test-plan.md
 * (add-zrok-custom-reserved-name): E10–E12, X7–X11, P2.
 *
 * The truth table is the easy part. What these tests actually defend is the
 * three corrections adversarial review forced into D6:
 *
 *  - a DAEMON's liveness cannot come from `status()`, which reports only
 *    whether THIS process ran connect() — both directions are wrong;
 *  - `registry.rescan()` cannot reach a provider's module-scope binary memo;
 *  - a predicate can HANG as well as throw, and a 30s exec timeout would
 *    outlive its own 5s tick.
 */
import type {
  ProviderEndpoints,
  ProviderStatus,
  TunnelEndpoint,
  TunnelKind,
  TunnelMode,
  TunnelProvider,
  TunnelProviderId,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import {
  hasAsyncEnrollmentCheck,
  hasLivenessProbe,
  READINESS_PREDICATE_TIMEOUT_MS,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { describe, expect, it, vi } from "vitest";
import { evaluateProvider, evaluateReadiness } from "../tunnel/tunnel-readiness.js";

const ENDPOINT: TunnelEndpoint = { kind: "public", url: "https://x.shares.zrok.io", tls: true };

/** A provider whose every predicate is injectable. */
function stub(opts: {
  id?: TunnelProviderId;
  kind?: TunnelKind;
  detectBinary?: () => boolean;
  isEnrolled?: () => boolean;
  status?: () => ProviderStatus;
  probeLive?: () => Promise<TunnelEndpoint[]>;
  invalidateBinaryCache?: () => void;
}): TunnelProvider {
  const p: any = {
    id: opts.id ?? "zrok",
    kind: opts.kind ?? "child",
    supportsMode: (_m: TunnelMode) => true,
    detectBinary: opts.detectBinary ?? (() => true),
    isEnrolled: opts.isEnrolled ?? (() => true),
    status: opts.status ?? (() => ({ active: false, endpoints: [] })),
    connect: async (): Promise<ProviderEndpoints> => ({ endpoints: [] }),
    disconnect: async () => {},
  };
  if (opts.probeLive) p.probeLive = opts.probeLive;
  if (opts.invalidateBinaryCache) p.invalidateBinaryCache = opts.invalidateBinaryCache;
  return p as TunnelProvider;
}

// ── Truth table (E10–E12) ────────────────────────────────────────────
describe("readiness truth table", () => {
  it("E10: no binary → not-installed, and the later predicates are never invoked", async () => {
    const isEnrolled = vi.fn(() => true);
    const status = vi.fn(() => ({ active: true, endpoints: [ENDPOINT] }));
    const r = await evaluateProvider(stub({ detectBinary: () => false, isEnrolled, status }));
    expect(r.state).toBe("not-installed");
    // Not merely an optimisation: with no binary these are shell-outs that fail
    // slowly and tell us nothing new.
    expect(isEnrolled).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("E11: installed but not enrolled → not-set", async () => {
    const r = await evaluateProvider(stub({ isEnrolled: () => false }));
    expect(r.state).toBe("not-set");
    expect(r.endpoints).toEqual([]);
  });

  it("E12: child provider, enrolled, status inactive → disconnected", async () => {
    const r = await evaluateProvider(stub({ kind: "child", status: () => ({ active: false, endpoints: [] }) }));
    expect(r.state).toBe("disconnected");
  });

  it("child provider with an active status → connected, carrying its endpoints", async () => {
    const r = await evaluateProvider(stub({ kind: "child", status: () => ({ active: true, endpoints: [ENDPOINT] }) }));
    expect(r.state).toBe("connected");
    expect(r.endpoints).toEqual([ENDPOINT]);
  });
});

// ── Daemon liveness (X10/X11) ────────────────────────────────────────
// The correction that made "no new detection logic" false.
describe("daemon liveness comes from the daemon, not from our memory", () => {
  it("X10: daemon live but this process never connected → connected, via probeLive", async () => {
    const r = await evaluateProvider(
      stub({
        id: "tailscale",
        kind: "daemon",
        // `lastEndpoints` is empty: this process never ran connect().
        status: () => ({ active: false, endpoints: [] }),
        probeLive: async () => [ENDPOINT],
      }),
    );
    expect(r.state).toBe("connected");
    // The report still owes endpoints, and they come from the probe.
    expect(r.endpoints).toEqual([ENDPOINT]);
  });

  it("X11: daemon connected by this process, then dies → disconnected, not stale-connected", async () => {
    const r = await evaluateProvider(
      stub({
        id: "tailscale",
        kind: "daemon",
        // Stale in-memory endpoints from an earlier successful connect.
        status: () => ({ active: true, endpoints: [ENDPOINT] }),
        probeLive: async () => [],
      }),
    );
    expect(r.state).toBe("disconnected");
    expect(r.endpoints).toEqual([]);
  });

  it("a CHILD provider still uses status(), which is correct for a process we own", async () => {
    const probeLive = vi.fn(async () => [] as TunnelEndpoint[]);
    const r = await evaluateProvider(
      stub({ kind: "child", status: () => ({ active: true, endpoints: [ENDPOINT] }), probeLive }),
    );
    expect(r.state).toBe("connected");
    expect(probeLive).not.toHaveBeenCalled();
  });
});

// ── Stale caches (X7/X8) ─────────────────────────────────────────────
describe("readiness reflects out-of-dashboard installs", () => {
  it("X7/X8: invalidates the provider's OWN memo before probing the binary", async () => {
    const invalidateBinaryCache = vi.fn();
    let installed = false;
    await evaluateProvider(
      stub({
        invalidateBinaryCache: () => {
          invalidateBinaryCache();
          installed = true; // the memo cleared; a re-resolve now finds it
        },
        detectBinary: () => installed,
      }),
    );
    expect(invalidateBinaryCache).toHaveBeenCalledTimes(1);
  });

  it("also runs the registry rescan — the two caches are different caches", async () => {
    const rescan = vi.fn();
    await evaluateProvider(stub({ id: "ngrok" }), { rescan });
    expect(rescan).toHaveBeenCalledWith("ngrok");
  });

  it("a throwing invalidation does not fail the row — it is an optimisation", async () => {
    const r = await evaluateProvider(
      stub({
        invalidateBinaryCache: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(r.state).not.toBe("not-installed");
  });
});

// ── Isolation: throwing (5.2) and hanging (X9/P2) ────────────────────
describe("a failing predicate degrades only its own provider", () => {
  it("a throwing predicate yields its false-branch state, marked stale, with a reason", async () => {
    const r = await evaluateProvider(
      stub({
        isEnrolled: () => {
          throw new Error("zrok env unreadable");
        },
      }),
    );
    expect(r.state).toBe("not-set");
    expect(r.stale).toBe(true);
    expect(r.reason).toContain("isEnrolled");
    expect(r.reason).toContain("zrok env unreadable");
  });

  it("X9/P2: a HUNG predicate is bounded and marked stale, not awaited to its exec timeout", async () => {
    const start = Date.now();
    const r = await evaluateProvider(
      stub({ id: "zerotier", isEnrolled: () => new Promise<boolean>(() => {}) as unknown as boolean }),
      { timeoutMs: 40 },
    );
    expect(r.state).toBe("not-set");
    expect(r.stale).toBe(true);
    expect(r.reason).toMatch(/timed out/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  // The bound is only real over a promise the runtime can interleave with the
  // timer. A SYNCHRONOUS shell-out blocks the event loop, so racing it against
  // setTimeout bounds nothing — the timer cannot fire until the call returns.
  // The earlier version of this suite stubbed a never-resolving promise, which
  // Promise.race CAN beat, so it passed while the production guarantee was
  // false for exactly the two providers that shell out.
  it("daemon providers expose an ASYNC enrollment check, or the 4s bound is decorative", async () => {
    const { TailscaleProvider } = await import("../tunnel-providers/tailscale.js");
    const { ZeroTierProvider } = await import("../tunnel-providers/zerotier.js");
    for (const p of [new TailscaleProvider(), new ZeroTierProvider({ networkId: "x" })]) {
      expect(hasAsyncEnrollmentCheck(p), `${p.id} must not force readiness through a blocking isEnrolled()`).toBe(true);
      expect(hasLivenessProbe(p), `${p.id} needs probeLive()`).toBe(true);
    }
  });

  it("readiness PREFERS the async check over the blocking one when both exist", async () => {
    const blocking = vi.fn(() => true);
    const nonBlocking = vi.fn(async () => false);
    const p: any = stub({ id: "tailscale", kind: "daemon", isEnrolled: blocking, probeLive: async () => [] });
    p.isEnrolledAsync = nonBlocking;
    const r = await evaluateProvider(p);
    expect(nonBlocking).toHaveBeenCalled();
    expect(blocking).not.toHaveBeenCalled();
    expect(r.state).toBe("not-set");
  });

  it("a predicate that BLOCKS the event loop is not rescued by the race (documents the limit)", async () => {
    // Asserted so the limitation is explicit rather than assumed away: this is
    // WHY the daemon providers had to gain async predicates.
    const start = Date.now();
    await evaluateProvider(
      stub({
        isEnrolled: () => {
          const until = Date.now() + 120;
          while (Date.now() < until) {
            /* deliberately blocking, mirroring execFileSync */
          }
          return true;
        },
        status: () => ({ active: false, endpoints: [] }),
      }),
      { timeoutMs: 10 },
    );
    // The 10ms bound did NOT cut the 120ms block short.
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it("the bound is SHORTER than the poll interval, or a hang survives into the next tick", async () => {
    const { READINESS_POLL_INTERVAL_MS } = await import(
      "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js"
    );
    expect(READINESS_PREDICATE_TIMEOUT_MS).toBeLessThan(READINESS_POLL_INTERVAL_MS);
  });

  it("X9: one hung provider does not delay or blank the other three", async () => {
    const start = Date.now();
    const board = await evaluateReadiness(
      [
        stub({ id: "zerotier", detectBinary: () => new Promise<boolean>(() => {}) as unknown as boolean }),
        stub({ id: "zrok", status: () => ({ active: true, endpoints: [ENDPOINT] }) }),
        stub({ id: "ngrok", isEnrolled: () => false }),
        stub({ id: "tailscale", kind: "daemon", probeLive: async () => [ENDPOINT] }),
      ],
      { timeoutMs: 40 },
    );
    expect(board).toHaveLength(4);
    expect(board.find((r) => r.provider === "zerotier")?.stale).toBe(true);
    expect(board.find((r) => r.provider === "zrok")?.state).toBe("connected");
    expect(board.find((r) => r.provider === "ngrok")?.state).toBe("not-set");
    expect(board.find((r) => r.provider === "tailscale")?.state).toBe("connected");
    // Bounded by the slowest ANSWER plus the timeout, not by a 30s exec limit.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("a provider that rejects outright still leaves a row rather than rejecting the board", async () => {
    const exploding: any = stub({ id: "ngrok" });
    exploding.detectBinary = () => {
      throw new Error("kaboom");
    };
    const board = await evaluateReadiness([exploding, stub({ id: "zrok" })]);
    expect(board).toHaveLength(2);
    expect(board[0].stale).toBe(true);
  });
});

// ── Diagnosability (5.9) ─────────────────────────────────────────────
describe("a misclassification is diagnosable", () => {
  it("names which predicate produced the state", async () => {
    expect((await evaluateProvider(stub({ detectBinary: () => false }))).reason).toContain("detectBinary");
    expect((await evaluateProvider(stub({ isEnrolled: () => false }))).reason).toContain("isEnrolled");
    expect(
      (await evaluateProvider(stub({ kind: "daemon", probeLive: async () => [] }))).reason,
    ).toContain("probeLive");
  });
});
