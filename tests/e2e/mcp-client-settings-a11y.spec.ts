import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * L3 accessibility floor for the MCP-client settings section (change:
 * extract-mcp-client-plugin, task 7.7).
 *
 * The section is a plugin settings-section, so the harness needs the plugin row
 * to report `enabled: true, loaded: true` with its `pi-mcp-adapter` requirement
 * satisfied — otherwise the client never mounts the claim. `/api/plugins` is
 * REWRITTEN (not replaced) so every other rail row stays authentic, and the two
 * plugin data sources (`/effective`, `/schema`) are fixtures. The schema fixture
 * is the REAL published schema read off disk, so the form renders the true field
 * set.
 *
 * `color-contrast` is disabled in the axe run and covered by the repo's own
 * documented 3:1 legibility floor instead — `severity-contrast.spec.ts`
 * establishes that absolute WCAG AA (4.5:1) is unsatisfiable for this theme set,
 * so enabling the rule here would fail on pre-existing theme tokens rather than
 * on anything this section introduces. Same treatment as `host-gate-allow.spec.ts`.
 *
 * See change: extract-mcp-client-plugin (task 7.7).
 */

const PLUGIN_PATH = "/settings/plugins/mcp-client";
const SECTION = '[data-testid="mcp-settings"]';

/** axe-core, injected from the workspace tree (no @axe-core/playwright dep). */
function axeSourcePath(): string {
  const p = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
  if (!fs.existsSync(p)) throw new Error(`axe-core not installed at ${p} — run pnpm install`);
  return p;
}

function schemaFixture(): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages", "mcp-client-plugin", "schema", "mcp-config.schema.json"),
      "utf8",
    ),
  );
}

/**
 * The effective view: one Pi-global server (editable) and one shared server
 * (read-only), plus an adapter verdict of `ok` so the section is not locked.
 */
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

/** Report the plugin loaded with its `pi-mcp-adapter` requirement satisfied. */
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EFFECTIVE) }),
  );
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
  // The list resolves after `/effective` lands; wait for a real row, not a skeleton.
  await expect(page.getByTestId("mcp-server-row-alpha")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mcp-adapter-timeout")).toBeAttached({ timeout: 30_000 });
}

test.describe("mcp-client settings section accessibility (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await routePluginLoaded(page);
    await routeData(page);
    await gotoDashboard(page);
  });

  test("F-a11y: no serious or critical axe violation in the section", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMcpClient(page);

    await page.addScriptTag({ path: axeSourcePath() });
    const violations = await page.evaluate(async (selector) => {
      const axe = (
        window as unknown as {
          axe: { run: (ctx: string, opts: unknown) => Promise<unknown> };
        }
      ).axe;
      const result = (await axe.run(selector, {
        rules: { "color-contrast": { enabled: false } },
      })) as {
        violations: Array<{
          id: string;
          impact: string | null;
          nodes: Array<{ target: string[]; failureSummary?: string }>;
        }>;
      };
      return result.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes
              .map((n) => `${n.target.join(" ")} — ${(n.failureSummary ?? "").replace(/\s+/g, " ")}`)
              .join(" | ")}`,
        );
    }, SECTION);

    expect(violations, "serious/critical axe violations in the MCP settings section").toEqual([]);
  });

  test("F-touch: every control meets the 44px mobile hit area at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoMcpClient(page);

    // A 16px checkbox is a legitimate visual control; its HIT AREA is the
    // wrapping <label>, so measure that when one exists (the code wraps every
    // bare checkbox for exactly this reason).
    const undersized = await page.evaluate((selector) => {
      const MIN = 44;
      const section = document.querySelector(selector);
      if (!section) return ["section not found"];
      const out: string[] = [];
      const controls = section.querySelectorAll("button, [role='switch'], input, select, textarea");
      for (const control of Array.from(controls)) {
        const input = control as HTMLInputElement;
        const target =
          input.type === "checkbox" && control.closest("label")
            ? (control.closest("label") as HTMLElement)
            : (control as HTMLElement);
        const rect = target.getBoundingClientRect();
        // Skip controls the host has hidden (e.g. inside a collapsed group).
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.width < MIN || rect.height < MIN) {
          const id =
            target.dataset.testid ??
            target.getAttribute("aria-label") ??
            target.tagName.toLowerCase();
          out.push(`${id}: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
      return out;
    }, SECTION);

    expect(undersized, "controls below the 44x44 mobile floor at 390px").toEqual([]);
  });
});
