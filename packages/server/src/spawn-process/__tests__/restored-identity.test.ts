/**
 * `verifyRestored` — the one-sided start-time verifier.
 * See change: guard-restored-headless-identity (test-plan E1, E2, E3, E4, E24, E44, X1, X2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { processStartedAt } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import {
  defaultStartProbe,
  IDENTITY_TOLERANCE_MS,
  LEGACY_PI_WINDOW_MS,
  parseAnchor,
  verifyRestored,
} from "../restored-identity.js";

const A = 1_700_000_000_000;
const alive = () => false;
const now = () => A + 10 * 24 * 60 * 60 * 1000;
const at = (start: number | null) => ({ probe: () => start, isGone: alive, now });

afterEach(() => vi.useRealTimers());

describe("verifyRestored", () => {
  it("E1: one-sided, tolerance 2 s inclusive; an earlier start always matches", async () => {
    expect(IDENTITY_TOLERANCE_MS).toBe(2000);
    expect(await verifyRestored(1, A, at(A + 1999))).toBe("match");
    expect(await verifyRestored(1, A, at(A + 2000))).toBe("match");
    expect(await verifyRestored(1, A, at(A + 2001))).toBe("mismatch");
    expect(await verifyRestored(1, A, at(A - 3_600_000))).toBe("match");
  });

  it("E2: anchors — spawn, stamped pi, legacy pi window, sidecar mtimes", async () => {
    const S = A;
    const start = S + 30_000;
    expect(await verifyRestored(1, S, at(start))).toBe("mismatch"); // spawn pid
    expect(await verifyRestored(1, S + 30_000, at(start))).toBe("match"); // piLinkedAt
    expect(LEGACY_PI_WINDOW_MS).toBe(60_000);
    expect(await verifyRestored(1, S + LEGACY_PI_WINDOW_MS, at(start))).toBe("match"); // legacy
    expect(await verifyRestored(1, S + 30_000, at(start))).toBe("match"); // sidecar mtime
    expect(await verifyRestored(1, S + LEGACY_PI_WINDOW_MS, at(S + 62_000))).toBe("match");
    expect(await verifyRestored(1, S + LEGACY_PI_WINDOW_MS, at(S + 62_001))).toBe("mismatch");
  });

  it("E3: a gone pid is never probed", async () => {
    const probe = vi.fn(() => A);
    expect(await verifyRestored(1, A, { probe, isGone: () => true })).toBe("gone");
    expect(probe).not.toHaveBeenCalled();
  });

  it("E3/E4: the default gone check reads only ESRCH as gone (EPERM is alive)", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    const probe = vi.fn(() => A + 10_000);
    expect(await verifyRestored(4242, A, { probe, now })).toBe("mismatch");
    expect(probe).toHaveBeenCalledTimes(1);
    kill.mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    expect(await verifyRestored(4242, A, { probe, now })).toBe("gone");
    kill.mockRestore();
  });

  it("E24: a +10 s clock step on Linux reads as mismatch — the accepted, intentional fail-closed leak", async () => {
    expect(await verifyRestored(1, A, at(A + 10_000))).toBe("mismatch");
  });

  it("E44/G5: missing, NaN anchor ⇒ unverifiable; a future anchor clamps to now", async () => {
    expect(await verifyRestored(1, undefined, at(A))).toBe("unverifiable");
    expect(await verifyRestored(1, Number.NaN, at(A))).toBe("unverifiable");
    expect(parseAnchor("x")).toBeNaN();
    expect(parseAnchor(undefined)).toBeUndefined();
    const n = () => A;
    expect(await verifyRestored(1, A + 86_400_000, { probe: () => A + 10_000, isGone: alive, now: n })).toBe("mismatch");
    expect(await verifyRestored(1, A + 86_400_000, { probe: () => A - 1000, isGone: alive, now: n })).toBe("match");
  });

  it("null probe ⇒ unverifiable (win32)", async () => {
    expect(await verifyRestored(1, A, at(null))).toBe("unverifiable");
  });

  it("X1: a probe that throws or rejects ⇒ unverifiable, logged, never throws", async () => {
    const log = vi.fn();
    const sync = () => { throw new Error("spawn ps ENOENT"); };
    expect(await verifyRestored(1, A, { probe: sync, isGone: alive, now, log })).toBe("unverifiable");
    expect(await verifyRestored(2, A, { probe: () => Promise.reject(new Error("x")), isGone: alive, now, log })).toBe("unverifiable");
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).toContain("ENOENT");
  });

  it("X2: a hung probe is cut at 2000 ms ⇒ unverifiable", async () => {
    vi.useFakeTimers();
    const p = verifyRestored(1, A, { probe: () => new Promise<number>(() => {}), isGone: alive, now, log: () => {} });
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("unverifiable");
  });
});

describe("default probe (E45/E46)", () => {
  it("E45: the default probe is processStartedAt", async () => {
    expect(await defaultStartProbe(process.pid)).toBe(processStartedAt(process.pid));
  });

  it("E46: a process started at the anchor matches across the ambiguous DST hour", async () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const line = "Sun Nov  1 01:30:00 2026";
      const probe = () => processStartedAt(7, { platform: "darwin", exec: () => line });
      expect(await verifyRestored(7, Date.parse(line), { probe, isGone: () => false, now: () => Date.parse(line) + 1 })).toBe("match");
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});
