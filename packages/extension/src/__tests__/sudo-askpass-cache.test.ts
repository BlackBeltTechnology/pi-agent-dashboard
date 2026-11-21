/**
 * In-memory per-session password cache (D3): invocation counting / do-not-cache
 * the final invocation, TTL window, clear matrix, hit latency, no leaks.
 * See change: add-sudo-credential-prompt (test-plan #S20, #S21, #S22, #S47, #S49).
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUDO_CREDENTIAL_FEATURE } from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import { createHarness, pollUntil, type Harness } from "./sudo-askpass-harness.js";

let h: Harness;

beforeEach(async () => {
  h = createHarness();
  await h.install();
  h.startTool("A", "sudo true");
});
afterEach(() => {
  vi.useRealTimers();
  h.dispose();
});

/** The operator is asked for helper invocation `pid`; answers `pw`. */
async function entry(pid: number, pw: string): Promise<void> {
  const before = h.requests().length;
  const reply = h.ask("[sudo] password: ", pid);
  await pollUntil(() => h.requests().length === before + 1, "modal request");
  h.respond(h.requests()[before].callId, pw);
  expect(await reply).toEqual({ ok: true, password: pw });
}

/** Helper invocation answered from the cache with no modal. */
async function hit(pid: number, pw: string): Promise<void> {
  const before = h.requests().length;
  expect(await h.ask("[sudo] password: ", pid)).toEqual({ ok: true, password: pw });
  expect(h.requests().length).toBe(before);
}

const cached = (): string | undefined => h.ctl.debug.cacheBuffer()?.toString("utf8");
const lastCacheFrame = (): number | null | undefined => h.cacheFrames().at(-1)?.expiresAt;

describe("invocation counting / do-not-cache-wrong (#S20)", () => {
  it("(a) an entry that sudo accepts on invocation 1 is cached", async () => {
    await entry(111, "ok");
    expect(cached()).toBe("ok");
    expect(lastCacheFrame()).toBe(h.ctl.debug.cacheExpiresAt());
  });

  it("(b) entry A rejected (1), entry B (2): B is cached", async () => {
    await entry(111, "A");
    await entry(111, "B");
    expect(cached()).toBe("B");
  });

  it("(c) stale hit rejected (1), A (2), B (3): dropped at 2, B not cached, cache empty", async () => {
    await entry(100, "stale");
    await hit(111, "stale"); // invocation 1 of pid 111: a cache hit counts
    await entry(111, "A"); // invocation 2: cache dropped, operator asked
    expect(cached()).toBe("A");
    await entry(111, "B"); // invocation 3: the last one sudo makes
    expect(cached()).toBeUndefined();
    expect(lastCacheFrame()).toBeNull();
  });

  it("(d) A (1), B (2), C (3): the final invocation's entry is not cached", async () => {
    await entry(111, "A");
    await entry(111, "B");
    await entry(111, "C");
    expect(cached()).toBeUndefined();
    expect(lastCacheFrame()).toBeNull();
  });

  it("(e) a cache hit accepted on invocation 1 does not extend the window", async () => {
    await entry(111, "ok");
    const expiresAt = h.ctl.debug.cacheExpiresAt();
    await hit(222, "ok");
    expect(h.ctl.debug.cacheExpiresAt()).toBe(expiresAt);
    expect(h.cacheFrames().filter((f) => f.expiresAt !== null)).toHaveLength(1); // no re-announce on a hit
  });

  it("(f) interleaved pids keep independent counters", async () => {
    await entry(111, "A");
    await entry(111, "B"); // 111 is at invocation 2
    await hit(222, "B"); // 222's first invocation: not a retry, served from cache
    h.forget();
    await entry(222, "C"); // 222 at invocation 2 only because of the hit above: cached
    expect(cached()).toBe("C");
    h.forget();
    await entry(333, "D"); // a fresh pid is at invocation 1 whatever 111/222 did, so its entry is cached
    expect(cached()).toBe("D");
  });
});

describe("TTL window (#S21)", () => {
  it("serves from cache until the window, then prompts; the expired Buffer is zeroed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await entry(111, "ok"); // t0
    const buf = h.ctl.debug.cacheBuffer() as Buffer;
    const expiresAt = h.ctl.debug.cacheExpiresAt();
    vi.advanceTimersByTime(299_999);
    await hit(222, "ok");
    expect(h.ctl.debug.cacheExpiresAt()).toBe(expiresAt);
    vi.advanceTimersByTime(2); // t0 + 300 001
    expect([...buf].every((b) => b === 0)).toBe(true);
    await entry(333, "again");
    expect(h.requests()).toHaveLength(2);
  });

  it("cacheMinutes=0 stores nothing but the masker still has the entry", async () => {
    h.cfg.cacheMinutes = 0;
    await entry(111, "ok");
    expect(h.ctl.debug.cacheBuffer()).toBeUndefined();
    await entry(222, "ok");
    expect(h.requests()).toHaveLength(2);
    expect(h.registered).toEqual(["ok", "ok"]);
    expect(h.cacheFrames()).toEqual([]);
  });
});

describe("clear matrix (#S22)", () => {
  const withCache = async (): Promise<Buffer> => {
    await entry(111, "canary-pw");
    return h.ctl.debug.cacheBuffer() as Buffer;
  };
  const zero = (b: Buffer): boolean => [...b].every((x) => x === 0);
  const noLeak = (): void => expect(h.logs.join("\n") + JSON.stringify(h.frames.filter((f) => f.type !== "sudo_credential_request"))).not.toContain("canary-pw");

  it("sudo_credential_forget: zeroed, cache {expiresAt:null} emitted, next sudo prompts", async () => {
    const buf = await withCache();
    h.forget();
    expect(zero(buf)).toBe(true);
    expect(lastCacheFrame()).toBeNull();
    await entry(222, "next");
    noLeak();
  });

  it.each([
    ["session_shutdown", () => h.ctl.shutdown()],
    ["server-connection loss", () => h.ctl.onClose()],
  ])("%s: zeroed; a fresh identity prompts again", async (_name, cause) => {
    const buf = await withCache();
    cause();
    expect(zero(buf)).toBe(true);
    await h.install();
    await entry(222, "next");
    noLeak();
  });

  it("same-pid helper re-invocation: dropped, then prompts", async () => {
    const buf = await withCache();
    await entry(111, "second");
    expect(zero(buf)).toBe(true);
    expect(cached()).toBe("second");
  });

  it("TTL expiry: zeroed and {expiresAt:null} emitted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const buf = await withCache();
    vi.advanceTimersByTime(300_001);
    expect(zero(buf)).toBe(true);
    expect(lastCacheFrame()).toBeNull();
  });

  it("setting disabled while running (G6): cache zeroed, wrapper+socket removed, env unset, pending dismissed, now", async () => {
    const buf = await withCache();
    const wrapper = h.ctl.wrapperPath() as string;
    const dir = wrapper.replace(/\/askpass$/, "");
    expect(h.env.SUDO_ASKPASS).toBe(wrapper);
    // a pending prompt: a retry of the same pid drops the cache and asks the operator
    const pendingReply = h.ask("[sudo] password: ", 111);
    await pollUntil(() => h.requests().length === 2, "pending prompt");
    h.cfg.enabled = false;
    h.ctl.reconcile();
    expect(zero(buf)).toBe(true);
    expect(await pendingReply).toEqual({ ok: false });
    expect(h.frames.some((f) => f.type === "sudo_credential_dismiss")).toBe(true);
    expect(h.env.SUDO_ASKPASS).toBeUndefined();
    expect(fs.existsSync(dir)).toBe(false);
    expect(h.ctl.featureInstalled()).toBe(false);
    noLeak();
  });
});

describe("cache hit latency (#S47)", () => {
  it("1 000 hits over the unix socket: p95 <= 100 ms, never a modal", async () => {
    await entry(111, "pw");
    const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      const reply = await h.ask("[sudo] password: ", 10_000 + i);
      times.push(performance.now() - t0);
      expect(reply.ok).toBe(true);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(100);
    expect(h.requests()).toHaveLength(1);
  });
});

describe("no leaks (#S49)", () => {
  const askpassDirs = (): string[] => fs.readdirSync(h.tmp).filter((n) => n.startsWith("pi-askpass-"));

  it("per-pid counters are bounded and evicted after the window; flaps leave one dir", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let max = 0;
    for (let pid = 1; pid <= 1000; pid++) {
      await entry(pid, "pw");
      h.forget();
      max = Math.max(max, h.ctl.debug.counterSize());
    }
    expect(max).toBeLessThanOrEqual(1000);
    expect(h.ctl.debug.counterSize()).toBe(1000);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(h.ctl.debug.counterSize()).toBe(0);

    for (let i = 0; i < 50; i++) {
      await h.install([]);
      await h.install([SUDO_CREDENTIAL_FEATURE]);
    }
    expect(askpassDirs()).toHaveLength(1);
    expect(fs.existsSync(h.ctl.socketPath() as string)).toBe(true);
    await h.install([]);
    expect(askpassDirs()).toHaveLength(0);
  });
});
