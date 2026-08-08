/**
 * Promise-handling guards for `ChildTunnelRuntime` — see change:
 * cleanup-client-plugin-promises (test-plan #E1, #E3).
 *
 * Harness glue mirrors `packages/server/src/__tests__/tunnel.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ChildProviderSpec,
  ChildTunnelRuntime,
} from "../tunnel/tunnel-core.js";

function makeSpec(overrides: Partial<ChildProviderSpec> = {}): ChildProviderSpec {
  return {
    id: "zrok",
    pidFileName: "test-tunnel.pid",
    getBinary: () => "/bin/false",
    detectBinary: () => true,
    isEnrolled: () => true,
    buildArgs: () => [],
    urlRegex: /https:\/\/\S+/,
    processMarker: "test-tunnel",
    endpointMarker: (port: number) => String(port),
    toEndpoints: (url: string) => [{ kind: "public", url }] as never,
    ...overrides,
  } as ChildProviderSpec;
}

/**
 * Reject if `p` has not settled within `ms` — a hang must fail, not time out the
 * suite. The timer is cleared once the race settles so a pending handle cannot
 * hold the worker open after the test passes.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PENDING_PAST_DEADLINE")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

describe("E1: a throw inside the createInner executor settles the outer promise", () => {
  it("settles (rejects or resolves null) instead of hanging forever", async () => {
    const boom = new Error("detectBinary exploded");
    const runtime = new ChildTunnelRuntime(
      makeSpec({
        detectBinary: () => {
          throw boom;
        },
      }),
    );

    // Before the fix, the throw is swallowed by the async executor and the
    // outer promise neither resolves nor rejects — this races the deadline.
    //
    // The injected error must REJECT, not resolve `null`: a `null` resolution is
    // indistinguishable from the legitimate "no binary / not enrolled" paths, so
    // accepting it would let a future regression that swallows the throw pass.
    await expect(withDeadline(runtime.createTunnel(8000), 2000)).rejects.toBe(boom);
  });

  it("a rejection from an awaited step in the executor propagates out", async () => {
    const boom = new Error("reserve exploded");
    const runtime = new ChildTunnelRuntime(
      makeSpec({
        reserve: () => Promise.reject(boom),
      }),
    );

    await expect(withDeadline(runtime.createTunnel(8001), 2000)).rejects.toBe(boom);
  });
});

describe("E3: the `pendingCreate` narrowing preserves inflight dedupe", () => {
  it("two concurrent createTunnel calls invoke createInner exactly once", async () => {
    const detectBinary = vi.fn(() => false); // resolves null on the first executor step
    const runtime = new ChildTunnelRuntime(makeSpec({ detectBinary }));

    const [a, b] = await withDeadline(
      Promise.all([runtime.createTunnel(8002), runtime.createTunnel(8002)]),
      2000,
    );

    expect(detectBinary).toHaveBeenCalledTimes(1);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});
