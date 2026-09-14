import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { assertHitAreas, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * L3 mobile presentation of the folder MCP page (change: extract-mcp-client-plugin,
 * task 8.4) plus the pill → page navigation (task 8.1).
 *
 * Fixture: the pinned `/fixtures/kb-sample` directory (materialized by
 * docker/test-entrypoint.sh, already used by `kb-folder-slot.spec.ts`) supplies a
 * KNOWN folder cwd — no new fixture and no filesystem mutation. The MCP data
 * sources are ROUTED (`/effective` + `/schema`), so the folder layer here is
 * deterministic and the shared harness config is never touched: the spec asserts
 * the RENDERED response to an override, not the write path (that is L1/L2).
 *
 * At 390px the spec pins the spec'd mobile contract: override chips carry NO
 * inline remove control, the row's editor sheet offers "Remove override", and
 * every control keeps a >=44px hit area.
 *
 * See change: extract-mcp-client-plugin (tasks 8.1, 8.4).
 */

const FOLDER_CWD = "/fixtures/kb-sample";
const PLUGIN_PATH_MATCH = /\/folder\/.+\/mcp$/;

function schemaFixture(): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages", "mcp-client-plugin", "schema", "mcp-config.schema.json"),
      "utf8",
    ),
  );
}

/**
 * `alpha` carries `own: { disabled: false }`, so `disabled` is the folder-layer
 * OVERRIDE and `command`/`lifecycle` are inherited. `inherited` has no `own`, so
 * every one of its fields is inherited.
 */
const FOLDER_EFFECTIVE = {
  cwd: FOLDER_CWD,
  servers: [
    {
      name: "alpha",
      entry: { command: "/bin/alpha", lifecycle: "lazy", disabled: false },
      own: { disabled: false },
      provenance: [
        {
          layer: "pi-folder",
          path: `${FOLDER_CWD}/.pi/mcp.json`,
          label: "Pi folder",
          writable: true,
        },
        {
          layer: "pi-global",
          path: "/home/pi/.pi/agent/mcp.json",
          label: "Pi global",
          writable: true,
        },
      ],
    },
    {
      name: "inherited",
      entry: { url: "https://inherited.example.test/mcp" },
      provenance: [
        {
          layer: "pi-global",
          path: "/home/pi/.pi/agent/mcp.json",
          label: "Pi global",
          writable: true,
        },
      ],
    },
  ],
  settings: {},
  layerErrors: [],
  adapter: { kind: "ok", installed: "2.21.0", floor: "2.20.0" },
};

async function routePluginLoaded(page: Page): Promise<void> {
  await page.route("**/api/plugins", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { plugins?: Array<{ id: string; status?: unknown }> };
    for (const row of body.plugins ?? []) {
      if (row.id !== "mcp-client") continue;
      row.status = {
        ...(row.status as object),
        enabled: true,
        loaded: true,
        missingDeps: [],
        missingRequirements: [],
      };
    }
    await route.fulfill({ response: res, json: body });
  });
}

async function routeData(page: Page): Promise<void> {
  await page.route("**/api/mcp-client/effective*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FOLDER_EFFECTIVE),
    }),
  );
  await page.route("**/api/mcp-client/schema", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schemaFixture()),
    }),
  );
}

async function prepareShell(page: Page): Promise<void> {
  await gotoDashboard(page);
  const skip = page.getByRole("button", { name: /^skip$/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(
    page.getByTestId("onboarding-step-2-cta").or(page.getByTestId("dashboard-add-folder-btn")).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** The MCP pill inside the sidebar card of `cwd` (the anchor is unconditional). */
function pillFor(page: Page, cwd: string) {
  return page
    .locator(
      `xpath=//*[@data-testid="folder-actions-menu-${cwd}"]/ancestor::div[.//*[@data-testid="mcp-folder-pill"]][1]//*[@data-testid="mcp-folder-pill"]`,
    )
    .first();
}

test.describe("folder MCP page — mobile presentation (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await routePluginLoaded(page);
    await routeData(page);
  });

  test("the pill opens the folder page at 390px; chips are display-only and the sheet removes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareShell(page);

    if ((await page.getByTestId(`folder-actions-menu-${FOLDER_CWD}`).count()) === 0) {
      await pinDirectory(page, FOLDER_CWD);
    }

    const pill = pillFor(page, FOLDER_CWD);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    // The pill summarises the routed effective view: 2 servers, none disabled.
    await expect(pill.getByTestId("mcp-folder-pill-count")).toContainText("2");

    await pill.click();
    await expect(page).toHaveURL(PLUGIN_PATH_MATCH, { timeout: 15_000 });
    await expect(page.getByTestId("mcp-folder-page")).toBeVisible({ timeout: 20_000 });

    // The folder override row renders an override chip naming its own field…
    const chip = page.getByTestId("mcp-folder-override-chip-alpha");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText("disabled");

    // …and at 390px that chip carries NO inline remove control.
    await expect(page.getByTestId("mcp-folder-chip-remove-alpha")).toHaveCount(0);

    // Removal is offered INSIDE the row's editor sheet instead.
    await page.getByTestId("mcp-folder-action-alpha").click();
    await expect(page.getByTestId("mcp-folder-editor")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mcp-folder-remove-override")).toBeVisible();

    // The inherited server's fields carry the "inherited from <layer>" hint in
    // ITS editor (mcp-client-folder-section spec: "its editor fields carry the
    // inherited hint"), not in the row summary.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mcp-folder-editor")).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId("mcp-folder-action-inherited").click();
    await expect(page.getByTestId("mcp-folder-editor")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mcp-folder-inherited-inherited.url")).toBeVisible({ timeout: 15_000 });

    await assertHitAreas(page, '[data-testid="mcp-folder-page"]');
  });

  test("a 403 renders nothing but the not-allowed state, with no retry", async ({ page }) => {
    // Override the beforeEach route for this cwd only.
    await page.route("**/api/mcp-client/effective*", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "not-allowed", message: "cwd not allowed" }),
      }),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await prepareShell(page);
    await page.goto(`/folder/${encodeURIComponent(FOLDER_CWD)}/mcp`);

    await expect(page.getByTestId("mcp-folder-not-allowed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("mcp-folder-page").locator("[data-testid^='mcp-folder-row-']")).toHaveCount(0);
    await expect(page.getByTestId("mcp-folder-timeout-retry")).toHaveCount(0);
  });
});
