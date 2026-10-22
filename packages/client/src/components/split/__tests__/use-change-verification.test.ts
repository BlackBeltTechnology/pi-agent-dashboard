/**
 * Regression guard for the changed-on-disk banner when the digest endpoint answers the 503 of an
 * undecidable cwd admission: a refused or failed digest MUST resolve toward "banner" (the stale view
 * is never silent). Expected to pass today; a failure is a finding.
 * See change: core-file-cwd-admission (test-plan F4), gate-changed-on-disk-by-content (D1–D3).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/access-grants/grant-channel.js", () => ({ fetchWithoutGrantPrompt: fetchSpy }));

import { type ChangeVerificationOptions, useChangeVerification } from "../use-change-verification.js";

const digestResponse = (sha1: string) =>
  new Response(JSON.stringify({ success: true, data: { sha1, size: 1, mtime: 1 } }), { status: 200 });
const unavailable = () =>
  new Response(
    JSON.stringify({ success: false, code: "cwd-admission-unavailable", error: "cwd-admission-unavailable", retryAfterMs: 1000 }),
    { status: 503, headers: { "Retry-After": "1" } },
  );

function opts(candidates: Map<string, number>): ChangeVerificationOptions {
  return {
    enabled: true,
    sessionId: "s1",
    cwd: "/repo",
    candidates,
    onClearCandidate: vi.fn(),
    openPaths: ["a.txt"],
    connectionGeneration: 0,
    resyncWatch: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useChangeVerification — digest refused with the cwd-admission 503", () => {
  it("shows the changed-on-disk banner for the tab", async () => {
    fetchSpy.mockResolvedValueOnce(digestResponse("base")); // baseline
    const { result, rerender } = renderHook((o: ChangeVerificationOptions) => useChangeVerification(o), {
      initialProps: opts(new Map()),
    });
    await act(async () => {
      await result.current.captureBaseline("a.txt");
    });
    expect(result.current.verified.has("a.txt")).toBe(false);

    fetchSpy.mockImplementation(async () => unavailable()); // every later digest is refused
    rerender(opts(new Map([["a.txt", 1]])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.verified.has("a.txt")).toBe(true);
  });
});
