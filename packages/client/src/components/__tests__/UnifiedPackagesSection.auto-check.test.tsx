/**
 * Tests for the auto-fire `/api/packages/check-updates` behaviour added
 * by `improve-pi-update-detection`. Focuses on the CALL contract — does
 * the right URL get requested at the right time — using a mocked fetch.
 *
 * These tests intentionally avoid asserting on rendered content from the
 * full UnifiedPackagesSection (which has a deep dep graph). Instead, we
 * verify the fetch fired by inspecting `globalThis.fetch.mock.calls`.
 *
 * See change: improve-pi-update-detection.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/** Minimal fetch mock that routes by URL substring. */
function makeFetchMock() {
  return vi.fn(async (input: RequestInfo, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;

    if (url.includes("/api/pi-core/versions")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { packages: [], updatesAvailable: 0, lastChecked: new Date().toISOString() },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/packages/installed")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              source: "npm:@blackbelt-technology/pi-dashboard-subagents",
              scope: "user",
              displayName: "pi-dashboard-subagents",
              isRecommended: false,
              isBundled: false,
              version: "0.1.0",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/packages/check-updates")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: [{ source: "npm:@blackbelt-technology/pi-dashboard-subagents", latest: "0.1.1" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/pi-core/changelog")) {
      return new Response(
        JSON.stringify({
          pkg: "@mariozechner/pi-coding-agent",
          from: "0.0.0",
          to: "0.0.0",
          releases: [],
          hasBreaking: false,
          changelogUrl: null,
          parsedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // Default: 200 with empty body so failures here don't cascade.
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("UnifiedPackagesSection auto-check", () => {
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function checkUpdatesCalls(): number {
    return fetchMock.mock.calls.filter((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url.includes("/api/packages/check-updates");
    }).length;
  }

  it("fires /api/packages/check-updates once after installed list loads", async () => {
    render(
      <ThemeProvider>
        <UnifiedPackagesSection />
      </ThemeProvider>,
    );

    // Initial calls: pi-core/versions + packages/installed. check-updates
    // fires only AFTER the installed list resolves with at least one row.
    await waitFor(() => expect(checkUpdatesCalls()).toBe(1), { timeout: 2000 });
  });

  it("re-fires check-updates on package_operation_complete WS event", async () => {
    render(
      <ThemeProvider>
        <UnifiedPackagesSection />
      </ThemeProvider>,
    );
    await waitFor(() => expect(checkUpdatesCalls()).toBe(1));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pi-package-event", {
          detail: { type: "package_operation_complete", success: true },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(checkUpdatesCalls()).toBeGreaterThanOrEqual(2));
  });

  it("does NOT re-fire on package_operation_complete with success=false", async () => {
    render(
      <ThemeProvider>
        <UnifiedPackagesSection />
      </ThemeProvider>,
    );
    await waitFor(() => expect(checkUpdatesCalls()).toBe(1));
    const before = checkUpdatesCalls();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pi-package-event", {
          detail: { type: "package_operation_complete", success: false },
        }),
      );
      await Promise.resolve();
    });
    // Settle event-loop and confirm no extra fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(checkUpdatesCalls()).toBe(before);
  });

  it("dedupes overlapping triggers (single in-flight check)", async () => {
    render(
      <ThemeProvider>
        <UnifiedPackagesSection />
      </ThemeProvider>,
    );
    await waitFor(() => expect(checkUpdatesCalls()).toBe(1));

    // Fire 3 events rapidly. Without the in-flight guard this would
    // produce 3 additional calls; with the guard, only one (or none if
    // the first hasn't settled). Either is fine; we just guard against
    // a 4x amplification.
    const before = checkUpdatesCalls();
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(
          new CustomEvent("pi-package-event", {
            detail: { type: "package_operation_complete", success: true },
          }),
        );
      }
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 30));
    const after = checkUpdatesCalls();
    expect(after - before).toBeLessThanOrEqual(2);
  });
});
