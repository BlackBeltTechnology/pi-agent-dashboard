/**
 * The registry's default start-time probe is the platform module's
 * `probeProcessStart(pid, { kind: "host" })`: on win32 a restored headless entry
 * becomes verifiable (it was always `unverifiable` while `processStartedAt`
 * returned null there). Test-plan row E46; E47 (shared 2-slot limiter) is
 * covered at the platform level by E14/E14b — this default probe IS that module.
 * See change: add-windows-process-identity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const probeProcessStart = vi.fn<(pid: number, target: unknown, opts?: unknown) => Promise<number | null>>();
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, probeProcessStart: (pid: number, t: unknown, o?: unknown) => probeProcessStart(pid, t, o) };
});

const { verifyRestored, IDENTITY_TOLERANCE_MS } = await import("../restored-identity.js");

const T = 1_700_000_000_000;

beforeEach(() => probeProcessStart.mockReset());

describe("registry default probe → probeProcessStart(host)", () => {
  it("E46: asks the platform module for a `host` target and verifies a matching start", async () => {
    probeProcessStart.mockResolvedValue(T + IDENTITY_TOLERANCE_MS);
    const v = await verifyRestored(4242, T, { isGone: () => false, now: () => T + 60_000 });
    expect(v).toBe("match");
    expect(probeProcessStart).toHaveBeenCalledTimes(1);
    expect(probeProcessStart.mock.calls[0][0]).toBe(4242);
    expect(probeProcessStart.mock.calls[0][1]).toEqual({ kind: "host" });
  });

  it("E46: a start after the anchor + tolerance is a mismatch (entry not signalled)", async () => {
    probeProcessStart.mockResolvedValue(T + IDENTITY_TOLERANCE_MS + 1);
    expect(await verifyRestored(4242, T, { isGone: () => false, now: () => T + 60_000 })).toBe("mismatch");
  });

  it("E46: a null probe is unverifiable (entry not signalled, reported failed)", async () => {
    probeProcessStart.mockResolvedValue(null);
    expect(await verifyRestored(4242, T, { isGone: () => false, now: () => T + 60_000 })).toBe("unverifiable");
  });
});
