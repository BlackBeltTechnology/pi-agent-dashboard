import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for change `add-zrok-custom-reserved-name` — the readiness board
 * and its poll (test-plan F1–F6), plus the degraded banner (F9).
 *
 * These are rendered-UI invariants that no unit test can reach. The poll
 * REDUCERS are already covered in `readiness-poll.test.ts`; what is only
 * observable here is the wiring — that opening actually fires a request, that
 * closing actually stops the timer, and that an in-flight tick actually
 * suppresses its successor. The bug that motivated F1 lived precisely in that
 * gap: the reducers were correct while the effect read a lagging ref and
 * skipped the immediate tick.
 *
 * The container has no enrolled tunnel providers, so readiness is injected via
 * `page.route`, following the stubbing pattern in `zrok-v2-tunnel.spec.ts`.
 * The stubs are faithful to the REST contract the client consumes:
 *   - `/api/tunnel-readiness` → `{ success, data: { providers, checkedAt } }`
 *   - `/api/tunnel-status`    → `{ status, url, serverOs, degraded? }`
 */

type Readiness = {
  provider: string;
  state: "not-installed" | "not-set" | "disconnected" | "connected";
  endpoints: { kind: string; url: string; tls: boolean }[];
  stale?: boolean;
  reason?: string;
};

const BOARD: Readiness[] = [
  { provider: "zrok", state: "connected", endpoints: [{ kind: "public", url: "https://x.shares.zrok.io", tls: true }] },
  { provider: "ngrok", state: "not-installed", endpoints: [] },
  { provider: "tailscale", state: "not-set", endpoints: [] },
  { provider: "zerotier", state: "disconnected", endpoints: [] },
];

/**
 * Stubs BOTH status routes.
 *
 * `/api/tunnel-status` is ungated and redacts `degraded.configuredName` — a
 * reserved name the operator owns but is not serving is not already-public.
 * The dialog therefore reads the gated `/api/tunnel-status-detail`, which is
 * allowed to name it, so a spec that stubs only the first sees no banner.
 */
async function stubTunnelStatus(page: Page, body: Record<string, unknown>): Promise<void> {
  const fulfil = (route: { fulfill: (r: object) => Promise<void> }) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/tunnel-status", fulfil);
  await page.route("**/api/tunnel-status-detail", fulfil);
}

/**
 * Stub readiness and COUNT the requests.
 *
 * The counter is the whole point for F1/F2/F3: "polls while open, stops on
 * close, suppresses overlap" is a statement about request volume over time,
 * not about rendered text.
 */
async function stubReadiness(
  page: Page,
  providers: Readiness[],
  opts: { delayMs?: number } = {},
): Promise<{ count: () => number; inFlight: () => number }> {
  let count = 0;
  let inFlight = 0;
  // AWAITED: an unawaited registration races the first navigation, so an early
  // tick can escape the stub and hit the real (guarded, 403) endpoint.
  await page.route("**/api/tunnel-readiness", async (route) => {
    count += 1;
    inFlight += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    inFlight -= 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { providers, checkedAt: new Date().toISOString() } }),
    });
  });
  return { count: () => count, inFlight: () => inFlight };
}

/** Open the Gateway dialog on its Setup tab, where the board lives. */
async function openSetupTab(page: Page): Promise<void> {
  const btn = page.getByTestId("tunnel-btn");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await page.getByTestId("gateway-tab-setup").click();
}

test.describe("gateway readiness board", () => {
  // F1 — a tick fires IMMEDIATELY, not after one interval.
  test("F1: opening the Setup tab fires a readiness request at once", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    const readiness = await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);

    // Well inside the 5s interval: if the first tick waited for the timer this
    // assertion fails, which is exactly the regression F1 exists to catch.
    await expect.poll(() => readiness.count(), { timeout: 3_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("gateway-readiness-board")).toBeVisible();
  });

  // F6 — every state carries TEXT, never colour alone (WCAG 1.4.1).
  test("F6: each of the four states renders a distinct text label", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-readiness-zrok-label")).toHaveText("Connected", { timeout: 10_000 });
    await expect(page.getByTestId("gateway-readiness-ngrok-label")).toHaveText("Not installed");
    await expect(page.getByTestId("gateway-readiness-tailscale-label")).toHaveText("Not set up");
    await expect(page.getByTestId("gateway-readiness-zerotier-label")).toHaveText("Disconnected");

    // The labels must be DISTINCT — two states sharing text is colour-only
    // signalling wearing a label.
    const labels = await Promise.all(
      ["zrok", "ngrok", "tailscale", "zerotier"].map((p) =>
        page.getByTestId(`gateway-readiness-${p}-label`).textContent(),
      ),
    );
    expect(new Set(labels).size).toBe(4);
  });

  // F5 — one provider degrading must not blank the board.
  test("F5: a stale row degrades alone; the other three still show their state", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    await stubReadiness(page, [
      { provider: "zrok", state: "connected", endpoints: [] },
      { provider: "ngrok", state: "not-installed", endpoints: [] },
      { provider: "tailscale", state: "not-set", endpoints: [] },
      // Its predicate threw or timed out.
      { provider: "zerotier", state: "disconnected", endpoints: [], stale: true, reason: "isEnrolled timed out" },
    ]);
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-readiness-zerotier-stale")).toBeVisible({ timeout: 10_000 });
    for (const p of ["zrok", "ngrok", "tailscale"]) {
      await expect(page.getByTestId(`gateway-readiness-${p}-label`)).toBeVisible();
      await expect(page.getByTestId(`gateway-readiness-${p}-stale`)).toHaveCount(0);
    }
  });

  // F4 — the board reflects an updated readiness rather than restating old work.
  test("F4: a provider moving not-set → connected re-renders as satisfied", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    let state: Readiness["state"] = "not-set";
    await page.route("**/api/tunnel-readiness", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            providers: [{ provider: "tailscale", state, endpoints: [] }],
            checkedAt: new Date().toISOString(),
          },
        }),
      }),
    );
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-readiness-tailscale-label")).toHaveText("Not set up", { timeout: 10_000 });
    state = "connected";
    // The next poll tick picks it up without any interaction.
    await expect(page.getByTestId("gateway-readiness-tailscale-label")).toHaveText("Connected", { timeout: 15_000 });
  });

  // F2 — closing stops polling. The load-bearing one: a leaked timer keeps
  // spawning ~4 subprocesses server-side every 5s for the life of the page.
  test("F2: leaving the Setup tab stops readiness requests entirely", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    const readiness = await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);
    await expect.poll(() => readiness.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    // Leave the tab that owns the poll.
    await page.getByTestId("gateway-tab-access").click();
    await page.waitForTimeout(1_000);
    const afterClose = readiness.count();

    // Three intervals' worth of silence.
    await page.waitForTimeout(15_000);
    expect(readiness.count()).toBe(afterClose);
  });

  // F3 — overlap suppression. A tick is bounded at 4s per provider against a
  // 5s interval, so a slow tick can genuinely be overtaken by its successor.
  test("F3: a tick still in flight suppresses the next one", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    // Each response takes longer than the poll interval.
    const readiness = await stubReadiness(page, BOARD, { delayMs: 7_000 });
    await gotoDashboard(page);
    await openSetupTab(page);

    // Straddle two interval boundaries while the first request is still open.
    await page.waitForTimeout(12_000);
    // Never more than one concurrent request…
    expect(readiness.inFlight()).toBeLessThanOrEqual(1);
    // …and the interval did not stack up requests behind the slow one.
    expect(readiness.count()).toBeLessThanOrEqual(2);
  });

  // The manual refresh is the escape hatch from a 5s cadence.
  test("the manual refresh control forces a tick", async ({ page }) => {
    await stubTunnelStatus(page, { status: "active", url: "https://x.shares.zrok.io", serverOs: "linux" });
    const readiness = await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);
    await expect.poll(() => readiness.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    const before = readiness.count();
    await page.getByTestId("gateway-readiness-refresh").click();
    await expect.poll(() => readiness.count(), { timeout: 5_000 }).toBeGreaterThan(before);
  });
});

test.describe("degraded persistence banner (F9)", () => {
  // F9 — active, but not at the name the operator asked for. The whole point of
  // the change: this state was previously indistinguishable from success.
  test("F9: a stored-vs-effective mismatch renders a warning banner", async ({ page }) => {
    await stubTunnelStatus(page, {
      status: "active",
      url: "https://xk3n2p9q.shares.zrok.io",
      serverOs: "linux",
      degraded: { configuredName: "robson-home-mac", effectiveName: "xk3n2p9q" },
    });
    await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);

    const banner = page.getByTestId("gateway-degraded-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    // It must name the configured name — "something went wrong" is what this
    // change exists to replace.
    await expect(banner).toContainText("robson-home-mac");
  });

  test("F9: an ordinary active tunnel renders NO banner", async ({ page }) => {
    await stubTunnelStatus(page, {
      status: "active",
      url: "https://robson-home-mac.shares.zrok.io",
      serverOs: "linux",
    });
    await stubReadiness(page, BOARD);
    await gotoDashboard(page);
    await openSetupTab(page);

    await expect(page.getByTestId("gateway-readiness-board")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("gateway-degraded-banner")).toHaveCount(0);
  });
});
