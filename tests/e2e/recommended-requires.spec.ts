import { test, expect } from "./fixtures.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Piece A — recommended-extension `requires` declaration + live probe.
//
// The dashboard's Recommended Extensions card (inside PackageBrowser on the
// Settings → Packages tab) renders a per-requirement badge for any entry that
// declares `requires`. `pi-agent-browser` declares `requires.binaries:
// ["agent-browser"]`; the server probes it via the shared ToolRegistry and
// returns a `requirements` report, which the card renders as a
// satisfied (green) / missing (amber) badge under `recommended-requires-<id>`.
//
// In the disposable test container `agent-browser` is not on PATH, so the
// badge renders in the "missing" state — but the assertion here is presence +
// the requirement name, not the satisfied state (which is environment-bound).
//
// See change: align-pi-080-and-publish-baseline-packages (Piece A).
test.describe("recommended extensions — requires probe", () => {
  test("pi-agent-browser shows its agent-browser requirement badge", async ({ page }) => {
    await gotoDashboard(page);

    // Settings → Packages tab hosts PackageBrowser → RecommendedExtensions.
    await page.goto("/settings/packages");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    // Belt-and-suspenders: if the route param didn't activate the Packages
    // tab, click it explicitly in the settings nav rail.
    const packagesNav = page.getByRole("button", { name: "Packages", exact: true });
    if (await packagesNav.isVisible().catch(() => false)) {
      await packagesNav.click();
    }
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 15_000 });

    // The recommended list loads async (server enrich + requirement probe).
    const requiresBadge = page.getByTestId("recommended-requires-pi-agent-browser");
    await expect(requiresBadge).toBeVisible({ timeout: 30_000 });

    // The badge names the declared binary requirement.
    await expect(requiresBadge).toContainText("agent-browser");

    // Entries WITHOUT a `requires` declaration carry no requires row.
    await expect(
      page.getByTestId("recommended-requires-pi-web-access"),
    ).toHaveCount(0);
  });
});
