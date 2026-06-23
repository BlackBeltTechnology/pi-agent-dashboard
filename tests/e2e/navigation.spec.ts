import { test, expect } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Scenario 5.6 — top-level routes mount without crashing.
//
// Asserts on uncaught `pageerror` (thrown exceptions / unhandled rejections),
// NOT console.error: a SPA emits benign console errors (asset 404s, the fake
// E2E credential's model call failing, MIME-type warnings on lazy chunks) that
// are not regressions. An uncaught pageerror means a route actually crashed —
// that is the meaningful "mounts without crashing" signal. Scoped to the
// deterministic top-level surface reachable without workspace state: the
// dashboard shell and the settings view. Folder-scoped routes (openspec board
// / archive / specs) depend on per-folder openspec presence and are covered
// separately. See change: add-e2e-spawn-scenarios.
test.describe("navigation", () => {
  test("dashboard + settings mount without uncaught errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await gotoDashboard(page);

    // Open settings and confirm the route container mounts.
    await byTestId(page, "settingsBtn").click();
    await expect(byTestId(page, "settingsContent")).toBeVisible({
      timeout: 15_000,
    });

    expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  });
});
