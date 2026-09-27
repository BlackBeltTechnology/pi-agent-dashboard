import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * X14 (change: electron-runtime-overlay-updates, D7): a remote client can never
 * point the runtime at a local folder. The harness server is not the desktop
 * app, so the whole Dashboard-runtime section is absent and every runtime
 * mutation is refused — and a local-folder body is refused regardless.
 */
test.describe("runtime updates — no remote local-folder path (X14)", () => {
  test("no path input in Settings; POSTs rejected; health.runtime.source unchanged", async ({ page, request }) => {
    const before = await (await request.get("/api/health")).json();

    await gotoDashboard(page);
    await page.goto("/settings/packages");
    await expect(page.getByText("Pi Ecosystem")).toBeVisible();
    await expect(page.getByTestId("runtime-updates-section")).toHaveCount(0);
    await expect(page.getByText(/Set from the app menu/)).toHaveCount(0);

    const attempts = [
      { url: "/api/runtime/source", data: { source: "local", localPath: "/tmp/evil" } },
      { url: "/api/runtime/source", data: { source: "npm", path: "/tmp/evil" } },
      { url: "/api/runtime/update", data: { version: "file:/tmp/evil" } },
      { url: "/api/runtime/activate", data: {} },
    ];
    for (const a of attempts) {
      const res = await request.post(a.url, { data: a.data });
      expect(res.status(), a.url).toBeGreaterThanOrEqual(400);
      expect(res.status(), a.url).toBeLessThan(500);
    }

    const after = await (await request.get("/api/health")).json();
    expect(after.runtime?.source).toBe(before.runtime?.source);
    expect(after.runtime?.id).toBe(before.runtime?.id);
  });
});
