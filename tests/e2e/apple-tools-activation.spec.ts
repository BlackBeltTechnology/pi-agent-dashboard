import { expect, test } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// apple-tools plugin — activation UI + provisioning panel (L3).
//
// The docker harness is a LINUX host, so the apple-tools plugin reports
// `UNSUPPORTED_PLATFORM` and BOTH of its declared requirements are unsatisfied:
//   - `paths: ["${imcpServerPath}"]` → resolves to the configSchema default
//     `/Applications/iMCP.app/Contents/MacOS/imcp-server`, which does not exist
//   - `piExtensions: ["pi-mcp-adapter"]` → not installed
// That makes the non-macOS + missing-requirement scenarios directly assertable
// here. Scenarios that require a PROVISIONED macOS host (#F6, #F7, #F9, #F10,
// #F11, #X9) are manual-only — the harness has no mock seam for provisioning
// state. Their invariants are pinned at L1 instead (mcp-config/doctor tests).
// See test-plan.md §"Implementation amendment — L3 disposition".
//
// See change: add-apple-tools-imcp-plugin.

const IMCP_DEFAULT_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

async function openPluginsTab(page: import("@playwright/test").Page) {
  await gotoDashboard(page);
  await byTestId(page, "settingsBtn").click();
  await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: "Plugins", exact: true })
    .click();
  await page.getByTestId("plugins-section").waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("apple-tools — missing-requirement surfacing", () => {
  test("#F1: an unsatisfied paths requirement renders a warning pill naming it", async ({
    page,
  }) => {
    await openPluginsTab(page);

    const row = page.getByTestId("plugin-row-apple-tools");
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The block is NOT empty — the regression guard for the three-category bug
    // (an unsatisfied `paths` entry passed the guard and rendered nothing).
    const pathPill = page.getByTestId(`missing-path-${IMCP_DEFAULT_PATH}`);
    await expect(pathPill).toBeVisible({ timeout: 30_000 });
    await expect(pathPill).toContainText(IMCP_DEFAULT_PATH);
  });

  test("#F2: a paths requirement offers NO inline [Install] button", async ({ page }) => {
    await openPluginsTab(page);
    await expect(page.getByTestId(`missing-path-${IMCP_DEFAULT_PATH}`)).toBeVisible({
      timeout: 30_000,
    });

    // A path has no package source, so neither install affordance may appear.
    await expect(page.getByTestId(`install-piExtension-${IMCP_DEFAULT_PATH}`)).toHaveCount(0);
    await expect(page.getByTestId(`install-path-${IMCP_DEFAULT_PATH}`)).toHaveCount(0);
  });

  test("#F3: the pi-mcp-adapter requirement links to the Packages tab, not inline Install", async ({
    page,
  }) => {
    await openPluginsTab(page);

    const pill = page.getByTestId("missing-piExtension-pi-mcp-adapter");
    await expect(pill).toBeVisible({ timeout: 30_000 });

    // pi-mcp-adapter has no curated RECOMMENDED_EXTENSIONS entry, so the row
    // falls back to the Packages-tab link rather than a one-click install.
    await expect(page.getByTestId("install-piExtension-link-pi-mcp-adapter")).toBeVisible();
    await expect(page.getByTestId("install-piExtension-pi-mcp-adapter")).toHaveCount(0);
  });
});

test.describe("apple-tools — settings panel", () => {
  test("#F4: the settings section renders inline beneath the plugin's own row", async ({
    page,
  }) => {
    await openPluginsTab(page);

    const row = page.getByTestId("plugin-row-apple-tools");
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The settings-gear affordance on the row expands the inline section.
    await page.getByTestId("plugin-expand-apple-tools").click();

    // The section renders inside the plugin's OWN row container.
    const host = page.getByTestId("plugin-settings-apple-tools");
    await expect(host).toBeVisible({ timeout: 15_000 });
    await expect(host.getByTestId("apple-tools-settings")).toBeVisible({ timeout: 15_000 });

    // Containment IS the invariant: exactly one instance, inside this row's
    // own settings host. (The Plugins tab stays mounted across settings nav, so
    // "absent from other pages" is not an observable property — test-plan.md
    // §Implementation amendment.)
    await expect(page.getByTestId("apple-tools-settings")).toHaveCount(1);
    await expect(
      page.getByTestId("plugin-row-apple-tools").getByTestId("apple-tools-settings"),
    ).toHaveCount(1);
  });

  test("#F8: on a non-macOS host the panel is inert — no [Run installer]", async ({ page }) => {
    await openPluginsTab(page);

    await page.getByTestId("plugin-expand-apple-tools").click();

    const panel = page.getByTestId("apple-tools-settings");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The harness is Linux → unsupported-platform readout, installer withheld.
    await expect(page.getByTestId("apple-tools-unsupported")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("apple-tools-run-installer")).toHaveCount(0);

    // #F9 (partial): no control purports to toggle an individual Apple service.
    for (const svc of ["Calendar", "Contacts", "Reminders", "Messages", "Weather"]) {
      await expect(panel.getByRole("checkbox", { name: new RegExp(svc, "i") })).toHaveCount(0);
    }
  });

  test("#F5: toggling the plugin off raises the restart-required banner", async ({ page }) => {
    await openPluginsTab(page);

    // Expand first so the section is mounted, then disable.
    await page.getByTestId("plugin-expand-apple-tools").click();
    await expect(page.getByTestId("apple-tools-settings")).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByTestId("plugin-toggle-apple-tools");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();

    // Toggling returns `restartRequired`: the claim is filtered only after a
    // server restart, so the banner — not an immediate unmount — is the
    // observable. See test-plan.md §Implementation amendment.
    await expect(page.getByTestId("plugins-restart-required-banner")).toBeVisible({
      timeout: 15_000,
    });

    // Restore state for suite independence.
    await toggle.click();
  });
});
