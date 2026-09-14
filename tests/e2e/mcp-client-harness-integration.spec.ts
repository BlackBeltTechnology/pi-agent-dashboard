import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * L3 harness-integration approximation for the folded scenario X23 (change:
 * extract-mcp-client-plugin, task 10.114).
 *
 * X23 as written needs a PROVISIONED macOS host — run the apple-tools installer
 * and assert the container's `~/.pi/agent/mcp.json`. The docker harness is
 * LINUX (`apple-tools-activation.spec.ts`: the installer is withheld there), so
 * that half stays pinned at L1 (`install.test.ts` merge-only E39/E40/E41 keep
 * `disabled` and add `command`). This spec keeps the rest of X23's contract
 * browser-real against the harness:
 *   1. the apple-tools panel surfaces its missing `mcp-client` plugin
 *      dependency (`missingDeps`) and withholds [Run installer];
 *   2. an MCP server toggle round-trips through the effective view — the switch
 *      write reaches the server and the converged view renders the persisted
 *      state.
 * The MCP data sources are ROUTED (deterministic), matching the sibling L3
 * specs; the write/merge semantics they stand in for are asserted at L1/L2.
 *
 * See change: extract-mcp-client-plugin (task 10.114, scenario X23).
 */

const PLUGIN_PATH = "/settings/plugins/mcp-client";
const SECTION = '[data-testid="mcp-settings"]';

function schemaFixture(): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages", "mcp-client-plugin", "schema", "mcp-config.schema.json"),
      "utf8",
    ),
  );
}

/** One Pi-global (editable) + one shared (read-only) server, adapter `ok`. */
const EFFECTIVE = {
  cwd: "",
  servers: [
    {
      name: "alpha",
      entry: { command: "/bin/alpha", lifecycle: "lazy" },
      provenance: [
        {
          layer: "pi-global",
          path: "/home/pi/.pi/agent/mcp.json",
          label: "Pi global",
          writable: true,
        },
      ],
    },
    {
      name: "team-shared",
      entry: { url: "https://mcp.example.test/mcp" },
      provenance: [
        {
          layer: "shared",
          path: "/opt/team/mcp.json",
          label: "team",
          importKind: "file",
          writable: false,
        },
      ],
    },
  ],
  settings: { showStatusIcon: { value: true, source: "pi-global" } },
  layerErrors: [],
  adapter: { kind: "ok", installed: "2.21.0", floor: "2.20.0" },
};

/** Report the mcp-client plugin loaded so its settings claim mounts. */
async function routeMcpClientLoaded(page: Page): Promise<void> {
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

async function routeSchema(page: Page): Promise<void> {
  await page.route("**/api/mcp-client/schema", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schemaFixture()),
    }),
  );
}

async function gotoMcpClient(page: Page): Promise<void> {
  await page.goto(PLUGIN_PATH);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SECTION)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mcp-server-row-alpha")).toBeVisible({ timeout: 30_000 });
}

test.describe("mcp-client harness integration (L3, X23)", () => {
  test("X23: apple-tools surfaces the missing mcp-client dependency and withholds the installer", async ({
    page,
  }) => {
    // Force the dashboard-plugin dependency gap the harness otherwise never has
    // (both plugins are bundled here), keeping every other plugin row authentic.
    await page.route("**/api/plugins", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as {
        plugins?: Array<{ id: string; status?: Record<string, unknown> | null }>;
      };
      for (const row of body.plugins ?? []) {
        if (row.id !== "apple-tools") continue;
        row.status = { ...(row.status ?? {}), missingDeps: ["mcp-client"] };
      }
      await route.fulfill({ response: res, json: body });
    });

    await gotoDashboard(page);
    await byTestId(page, "settingsBtn").click();
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    await page
      .getByTestId("settings-nav-rail")
      .getByRole("button", { name: "Plugins", exact: true })
      .click();
    await page.getByTestId("plugins-section").waitFor({ state: "visible", timeout: 15_000 });

    await page.getByTestId("plugin-expand-apple-tools").click();
    await expect(page.getByTestId("plugin-settings-page-apple-tools")).toBeVisible({ timeout: 15_000 });

    const banner = page.getByTestId("apple-tools-missing-deps");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("mcp-client");
    // The banner routes the operator to the plugins index to enable it.
    await expect(banner.locator("a")).toHaveAttribute("href", "/settings/plugins");

    // With the dependency missing, provisioning would refuse → no installer.
    await expect(page.getByTestId("apple-tools-run-installer")).toHaveCount(0);
  });

  test("X23: a server toggle round-trips through the effective view", async ({ page }) => {
    let disabled = false;
    const writes: unknown[] = [];
    const effective = () => ({
      ...EFFECTIVE,
      servers: [
        {
          ...EFFECTIVE.servers[0],
          entry: { command: "/bin/alpha", lifecycle: "lazy", ...(disabled ? { disabled: true } : {}) },
        },
        EFFECTIVE.servers[1],
      ],
    });

    await routeMcpClientLoaded(page);
    await routeSchema(page);
    await page.route("**/api/mcp-client/effective*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(effective()) }),
    );
    await page.route("**/api/mcp-client/servers/alpha/disabled", async (route) => {
      writes.push(route.request().postDataJSON());
      disabled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await gotoDashboard(page);
    await gotoMcpClient(page);

    const sw = page.getByTestId("mcp-server-toggle-alpha");
    await expect(sw).toBeChecked();
    await sw.click();
    // The converged view (refetched after the write) renders the persisted state.
    await expect(sw).not.toBeChecked({ timeout: 15_000 });

    // The switch write carried the global scope and the flip.
    expect(writes).toEqual([{ scope: "global", disabled: true }]);

    // A cold load reads the same persisted state back.
    await page.reload();
    await expect(page.getByTestId("mcp-server-toggle-alpha")).not.toBeChecked({ timeout: 30_000 });
  });
});
