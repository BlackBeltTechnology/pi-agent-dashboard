/**
 * The dashboard's root `onRequest` chain, enumerated from the REAL `createServer` wiring (every `addHook("onRequest")` on the
 * root instance — including the ones plugins such as `@fastify/cors` register — is recorded in registration order, which is
 * Fastify's execution order). The preview split (previewApp is its OWN instance and contributes no root hook), the duplicate-cookie
 * gate and the CORS observer sit behind the host gate; the universal network guard stays the last gate.
 *
 * See change: serve-live-previews-on-capability-origin (D10, D3; test-plan #E145).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

interface HookRecord {
  name: string;
  arity: number;
}
const recorded = vi.hoisted(() => ({ rootHooks: [] as HookRecord[], instances: 0, previewApps: 0 }));

vi.mock("fastify", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown> & { default?: unknown; fastify?: unknown };
  const real = (mod.default ?? mod.fastify ?? mod) as (opts?: Record<string, unknown>) => Record<string, unknown>;
  const wrapped = ((opts?: Record<string, unknown>) => {
    const inst = real(opts) as { addHook: (name: string, fn: (...a: unknown[]) => unknown, ...rest: unknown[]) => unknown };
    recorded.instances++;
    if (opts?.serverFactory) {
      // the dashboard root instance (the one with the dispatching serverFactory)
      const orig = inst.addHook.bind(inst);
      inst.addHook = ((name: string, fn: (...a: unknown[]) => unknown, ...rest: unknown[]) => {
        if (name === "onRequest") recorded.rootHooks.push({ name: fn.name, arity: fn.length });
        return orig(name, fn, ...rest);
      }) as typeof inst.addHook;
    } else {
      recorded.previewApps++;
    }
    return inst;
  }) as unknown as Record<string, unknown>;
  Object.assign(wrapped, real);
  wrapped.default = wrapped;
  wrapped.fastify = wrapped;
  return { ...mod, default: wrapped, fastify: wrapped };
});

import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe("T.E145 / #E145 — network guard stays the last gate on the root onRequest chain", () => {
  it("host gate → duplicate-cookie gate → CORS observer → … → network guard; the cookie gate is never registered after the guard", async () => {
    recorded.rootHooks.length = 0;
    handle = await createTestServer();
    const names = recorded.rootHooks.map((h) => h.name);
    expect(names.length).toBeGreaterThan(8);
    const at = (n: string) => names.indexOf(n);
    const hostGate = at("hostGate");
    const cookieGate = at("duplicateCookieGate");
    const mutationGate = at("mutationOriginGate");
    const guard = at("networkGuardHook");
    for (const [label, i] of [["hostGate", hostGate], ["duplicateCookieGate", cookieGate], ["mutationOriginGate", mutationGate], ["networkGuardHook", guard]] as const) {
      expect(i, `${label} is registered on the root chain (chain: ${names.join(",")})`).toBeGreaterThanOrEqual(0);
    }
    // each of them exactly once
    for (const n of ["hostGate", "duplicateCookieGate", "mutationOriginGate", "networkGuardHook"]) expect(names.filter((x) => x === n), n).toHaveLength(1);

    // host gate first, the cookie gate directly behind it (before CORS and every origin gate)
    expect(hostGate).toBeLessThan(cookieGate);
    // the CORS observer + @fastify/cors register between the cookie gate and the mutation gate
    expect(cookieGate).toBeLessThan(mutationGate);
    expect(mutationGate - cookieGate, "the CORS observer and @fastify/cors sit between the cookie gate and the mutation gate").toBeGreaterThanOrEqual(3);
    // …and the network guard stays behind all of them
    expect(mutationGate).toBeLessThan(guard);
    expect(cookieGate).toBeLessThan(guard);
    expect(hostGate).toBeLessThan(guard);

    // the guard is the LAST gate: the live-capability hook, the tier gate and the identity floor all come before it
    expect(at("liveCapabilityHook")).toBeGreaterThanOrEqual(0);
    expect(at("liveCapabilityHook")).toBeLessThan(guard);
    // nothing registered after the guard is a refusal gate: only the callback-style state-caller wrapper (done-callback, arity 3)
    const after = recorded.rootHooks.slice(guard + 1);
    for (const h of after) {
      expect(h.arity, `hook "${h.name}" after the network guard must be the callback-style context wrapper`).toBe(3);
      expect(h.name).not.toMatch(/gate|guard|cookie|origin/i);
    }
    expect(names.slice(guard + 1)).not.toContain("duplicateCookieGate");

    // previewApp is its own Fastify instance (no serverFactory): the preview split contributed no root hook
    expect(recorded.previewApps).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
