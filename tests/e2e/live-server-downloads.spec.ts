import { expect, test } from "./fixtures.js";
import { launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// live-viewer-allow-downloads — L3 (test-plan #F1, #X1).
//
// The live-server iframe sandbox must carry `allow-downloads` (a click-driven
// export reaches the user) and NOT `allow-same-origin` (opaque origin, D7).
// No-gesture download blocking is deliberately NOT asserted: measured in Chrome
// 155, `allow-downloads` alone permits a load/timer-triggered download.
//
// `/api/live-server/start` and `/live/**` are routed, so no real loopback dev
// server is needed in the harness. Fixture HTML is fulfilled at the proxied path.
// See change: live-viewer-allow-downloads.
// ─────────────────────────────────────────────────────────────────────────

const FIXTURE_ID = "dl000001";

const EXPORT_HTML = `<!doctype html><html><body>
<button id="export">Export</button>
<pre id="probe"></pre>
<script>
  document.getElementById("export").addEventListener("click", function () {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(['{"k":1}'], { type: "application/json" }));
    a.download = "tuning.json";
    document.body.appendChild(a);
    a.click();
  });
  var res = {};
  try { localStorage.getItem("x"); res.ls = "ok"; } catch (e) { res.ls = e.name; }
  res.origin = String(window.origin);
  document.getElementById("probe").textContent = JSON.stringify(res);
  window.__probe = res;
</script></body></html>`;

async function openRoutedLivePane(page: import("@playwright/test").Page, html: string) {
  await page.route("**/api/live-server/start", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { id: FIXTURE_ID, label: "fixture", host: "127.0.0.1", port: 5173, path: `/live/${FIXTURE_ID}/` },
      }),
    }),
  );
  // The viewer frames a per-preview capability path (retire-trusted-networks-bypass),
  // so the mint is routed too: the fixture target does not exist server-side.
  await page.route("**/api/live-server/*/capability", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        path: `/live/${FIXTURE_ID}/~c/fixtureTokenfixtureTokenfixtureToken/`,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      }),
    }),
  );
  await page.route("**/live/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );

  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
  await robustClick(page, "layout-mode-split");
  await launchFromNewTabMenu(page, "live-preview-launch");
  await page.getByTestId("live-url").fill("http://localhost:5173");
  await robustClick(page, "live-confirm");
  await expect(page.getByTestId("live-iframe")).toBeAttached({ timeout: 15_000 });
}

test.describe("live-viewer-allow-downloads", () => {
  test("F1: a user-gesture export inside the frame reaches the user as a download", async ({ page }) => {
    await openRoutedLivePane(page, EXPORT_HTML);
    const frame = page.frameLocator('[data-testid="live-iframe"]');
    const downloadP = page.waitForEvent("download", { timeout: 10_000 });
    await frame.locator("#export").click();
    const download = await downloadP;
    expect(download.suggestedFilename()).toBe("tuning.json");
    const path = await download.path();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(path, "utf8")).toBe('{"k":1}');
  });

  test("X1: allow-downloads grants no readable origin (D7 opaque origin holds)", async ({ page }) => {
    await openRoutedLivePane(page, EXPORT_HTML);
    const handle = await page.getByTestId("live-iframe").elementHandle();
    const frame = await handle?.contentFrame();
    expect(frame).toBeTruthy();
    await expect.poll(async () => frame!.evaluate(() => (window as any).__probe?.ls)).toBe("SecurityError");
    expect(await frame!.evaluate(() => window.origin)).toBe("null");
  });
});
