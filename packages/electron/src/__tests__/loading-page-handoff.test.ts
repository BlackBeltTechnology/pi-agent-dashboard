/**
 * The loading page hands off to the dashboard through main (`navigateToServer`),
 * within one poll cycle of the server becoming healthy, and never assigns
 * `location.href` for a dashboard target.
 *
 * See change: fix-pairing-approval-credential (test-plan #P2; tasks 5.9, 5.10).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_HTML, loadingScript, runLoadingPage } from "./loading-page-harness.js";

/** The page's own max poll interval (`setTimeout(tryConnect, 1500)`). */
const MAX_POLL_INTERVAL_MS = 1500;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("loading.html handoff (P2)", () => {
  it.each([1001, 1800, 2500, 4000, 9000])("health OK at t=%i ms → navigateToServer invoked ≤ 1500 ms later, location.href untouched", async (t) => {
    const start = Date.now();
    const navigateToServer = vi.fn(async (_t: string) => ({ navigated: true }));
    let navigatedAt: number | null = null;
    navigateToServer.mockImplementation(async () => { navigatedAt = Date.now(); return { navigated: true }; });
    const page = runLoadingPage({
      piDashboard: { navigateToServer, readServerLog: async () => "" },
      fetchImpl: async () => ({ ok: Date.now() - start >= t }),
    });
    for (let i = 0; i < 200 && navigatedAt === null; i++) await vi.advanceTimersByTimeAsync(50);
    expect(navigatedAt).not.toBeNull();
    expect(navigatedAt! - start - t).toBeLessThanOrEqual(MAX_POLL_INTERVAL_MS);
    expect(navigateToServer).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
    expect(page.hrefAssignments).toEqual([]);
  });

  it("a refused navigation keeps polling (no location.href fallback)", async () => {
    const navigateToServer = vi.fn(async () => ({ navigated: false, reason: "target-not-allowed" }));
    const page = runLoadingPage({
      piDashboard: { navigateToServer, readServerLog: async () => "" },
      fetchImpl: async () => ({ ok: true }),
    });
    await vi.advanceTimersByTimeAsync(1000 + 1500 * 3);
    expect(navigateToServer.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(page.hrefAssignments).toEqual([]);
  });

  it("known-servers click routes through navigateToServer", async () => {
    const navigateToServer = vi.fn(async () => ({ navigated: true }));
    const ks = Buffer.from(JSON.stringify([{ host: "192.168.16.242", port: 8000, label: "lan" }])).toString("base64");
    const page = runLoadingPage({
      search: `?knownServers=${encodeURIComponent(ks)}`,
      piDashboard: { navigateToServer },
      fetchImpl: async () => ({ ok: false }),
    });
    expect(page.els["known-servers"]!.style.display).toBe("block");
    const btn = page.created.find((e) => e.listeners.click);
    expect(btn).toBeDefined();
    await btn!.listeners.click![0]!();
    expect(navigateToServer).toHaveBeenCalledExactlyOnceWith("http://192.168.16.242:8000");
    expect(page.hrefAssignments).toEqual([]);
  });

  it("launch-outcome redirect routes through navigateToServer (after 300 ms)", async () => {
    const navigateToServer = vi.fn(async () => ({ navigated: true }));
    const requestLaunch = vi.fn(async () => ({ kind: "started", url: "http://localhost:8000" }));
    const page = runLoadingPage({ piDashboard: { navigateToServer, requestLaunch }, fetchImpl: async () => ({ ok: false }) });
    await page.els["start-btn"]!.listeners.click![0]!();
    expect(navigateToServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(navigateToServer).toHaveBeenCalledExactlyOnceWith("http://localhost:8000");
    expect(page.hrefAssignments).toEqual([]);
  });
});

/** @structural-pin loading.html is a packaged resource; its script text is the contract for "no direct dashboard navigation". */
describe("loading.html never assigns location.href (task 5.10)", () => {
  it("no `location.href =` / `location.assign` / `location.replace` in the script", () => {
    const script = loadingScript().replace(/^\s*\/\/.*$/gm, "");
    expect(script).not.toMatch(/location\s*\.\s*href\s*=[^=]/);
    expect(script).not.toMatch(/location\s*\.\s*(assign|replace)\s*\(/);
    expect(script).not.toMatch(/window\s*\.\s*location\s*=[^=]/);
    expect(readFileSync(LOADING_HTML, "utf-8")).toContain("navigateToServer");
  });
});
