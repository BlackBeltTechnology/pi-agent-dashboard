/**
 * Idempotent acquire registry (test-plan #E6, #E7, #E8, #E9, #E10, #X1, #X2).
 * Drives the coalescing ladder with injected deps: reuse-live, resume-renumber,
 * concurrent convergence, register-window join, allowlist reject, register
 * timeout.
 * See change: add-embed-session-lifecycle.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { describe, expect, it, vi } from "vitest";
import { composeIdentityKey } from "../identity-key.js";
import {
  createVisitorSessionRegistry,
  type RegistryDeps,
} from "../visitor-session-registry.js";

const REQ = { visitorId: "v1", cwd: "/srv/e/proj", agentIdentity: "a" };
const CANON = "/srv/e/proj";
const KEY = composeIdentityKey("v1", CANON, "a");

function makeDeps(over: Partial<RegistryDeps> = {}): RegistryDeps {
  return {
    config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: true, registerTimeoutSeconds: 1 }),
    canonicalizeCwd: (p) => p,
    isCwdAllowed: () => true,
    isSessionLive: () => false,
    isSessionResumable: () => false,
    spawn: vi.fn(),
    resume: vi.fn(),
    ...over,
  };
}

describe("visitor session registry acquire", () => {
  // E8 / E9 — concurrent acquires converge on ONE spawn and both resolve to it.
  it("coalesces concurrent acquires onto a single spawn", async () => {
    const spawn = vi.fn();
    const reg = createVisitorSessionRegistry(makeDeps({ spawn }));
    const p1 = reg.acquire(REQ);
    const p2 = reg.acquire(REQ);
    await Promise.resolve(); // let the admit→fire microtask run
    expect(spawn).toHaveBeenCalledTimes(1); // one spawn for two acquires
    reg.resolveByCwd(CANON, "sess-1");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.sessionId).toBe("sess-1");
    expect(r2.sessionId).toBe("sess-1");
    expect(r1.reason).toBe("spawned");
  });

  // E6 / E7 — once a live session is mapped, a later acquire reuses it (no spawn).
  it("reuses a live session on a subsequent acquire", async () => {
    const spawn = vi.fn();
    let live = false;
    const reg = createVisitorSessionRegistry(
      makeDeps({ spawn, isSessionLive: () => live }),
    );
    const p1 = reg.acquire(REQ);
    reg.resolveByCwd(CANON, "sess-1");
    await p1;
    live = true; // the spawned session is now live

    const r2 = await reg.acquire(REQ);
    expect(r2).toEqual({ sessionId: "sess-1", reason: "live" });
    expect(spawn).toHaveBeenCalledTimes(1); // no second spawn
  });

  // E10 — a reaped (ended, resumable) session is resumed under a NEW id and the
  // key re-points to it.
  it("resumes a resumable session under a new id and re-points the key", async () => {
    const resume = vi.fn();
    let live = true;
    let resumable = false;
    const reg = createVisitorSessionRegistry(
      makeDeps({
        resume,
        isSessionLive: () => live,
        isSessionResumable: () => resumable,
        spawn: vi.fn(),
      }),
    );
    // First acquire spawns sess-1.
    const p1 = reg.acquire(REQ);
    reg.resolveByCwd(CANON, "sess-1");
    await p1;

    // sess-1 gets reaped: no longer live, now resumable.
    live = false;
    resumable = true;
    const p2 = reg.acquire(REQ);
    await Promise.resolve(); // let the admit→resume microtask run
    expect(resume).toHaveBeenCalledWith("sess-1", REQ, KEY);
    reg.resolveByCwd(CANON, "sess-2"); // resume mints a fresh id
    const r2 = await p2;
    expect(r2.sessionId).toBe("sess-2");
    expect(reg.mappedSessionId(KEY)).toBe("sess-2"); // re-pointed
  });

  // X1 — an out-of-allowlist cwd is rejected, no spawn.
  it("rejects an out-of-allowlist cwd without spawning", async () => {
    const spawn = vi.fn();
    const reg = createVisitorSessionRegistry(makeDeps({ spawn, isCwdAllowed: () => false }));
    await expect(reg.acquire(REQ)).rejects.toThrow(/cwd not allowed/);
    expect(spawn).not.toHaveBeenCalled();
  });

  // X2 — a spawn that never registers rejects the coalesced result and clears
  // the entry so waiters do not hang (and a later acquire can retry).
  it("rejects on register timeout and clears the in-flight entry", async () => {
    vi.useFakeTimers();
    try {
      const spawn = vi.fn();
      const reg = createVisitorSessionRegistry(makeDeps({ spawn }));
      const p = reg.acquire(REQ);
      const assertion = expect(p).rejects.toThrow(/register timeout/);
      await vi.advanceTimersByTimeAsync(1000); // registerTimeoutSeconds: 1
      await assertion;
      // Entry cleared → a fresh acquire spawns again (does not coalesce onto the
      // dead promise).
      reg.acquire(REQ);
      await vi.advanceTimersByTimeAsync(0); // flush the admit→fire microtask
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // Caps admission: a CapacityError from `admit` propagates and blocks the spawn.
  it("propagates a capacity error from the admission gate", async () => {
    const spawn = vi.fn();
    const reg = createVisitorSessionRegistry(
      makeDeps({
        spawn,
        admit: async () => {
          throw new Error("capacity");
        },
      }),
    );
    await expect(reg.acquire(REQ)).rejects.toThrow(/capacity/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
