import { expect, test } from "@playwright/test";
import { FIXTURE_GIT } from "./helpers/index.js";

/**
 * E2E for change `fix-skill-discovery-parity` (tasks 8.17–8.26, 8.33).
 *
 * The Resources skills grid renders provenance from the live join. The join's
 * inputs — which session reported, whether pi's resolver answered — are server
 * state a browser cannot steer, so each scenario fulfils `/api/pi-resources`
 * with a crafted payload and asserts what the rendered page does with it. That
 * keeps the assertions on the real component tree and the real route, which is
 * what L3 is for here.
 *
 * The folder-settings route is a deep link that renders from the payload alone,
 * so no folder needs pinning first.
 */

const CWD = FIXTURE_GIT;

/** Mirror of `encodeFolderPath` (packages/client/src/lib/util/folder-encoding.ts). */
function encodeFolderPath(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const emptyScope = { extensions: [], skills: [], prompts: [], agents: [], themes: [] };

const skill = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `${name} description.`,
  filePath: `/w/.pi/skills/${name}/SKILL.md`,
  type: "skill",
  enabled: true,
  ...extra,
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    local: {
      ...emptyScope,
      skills: [
        skill("act-1", { status: "active" }),
        skill("act-2", { status: "active" }),
        skill("act-3", { status: "active" }),
        skill("miss-1", { status: "not-loaded" }),
        skill("miss-2", { status: "not-loaded" }),
        {
          ...skill("hermes"),
          filePath: "/root/.pi/agent/pi-hermes-memory/skills/x/SKILL.md",
          status: "loaded-elsewhere",
          sessionPath: "/root/.pi/agent/pi-hermes-memory/skills/x/SKILL.md",
        },
      ],
    },
    global: { ...emptyScope },
    packages: [],
    contributingSession: { sessionId: "s1", cwd: CWD, differsFromFolder: false },
    ...overrides,
  };
}

/** Serve `data` for every `/api/pi-resources` read, then open the skills page. */
async function openSkills(page: import("@playwright/test").Page, data: unknown, page_ = "skills") {
  await page.route("**/api/pi-resources**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) }),
  );
  await page.goto(`/folder/${encodeFolderPath(CWD)}/settings/${page_}`);
  await expect(page.getByTestId("directory-settings")).toBeVisible({ timeout: 20_000 });
}

test.describe("skill provenance", () => {
  test("badges not-loaded and loaded-elsewhere but never active (F1)", async ({ page }) => {
    await openSkills(page, payload());
    const grid = page.getByTestId("resource-card-grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("resource-card")).toHaveCount(6);
    const badges = page.getByTestId("badge-provenance");
    await expect(badges).toHaveCount(3);
    await expect(page.locator('[data-provenance="loaded-elsewhere"][data-testid="badge-provenance"]')).toHaveCount(1);
    await expect(page.locator('[data-provenance="not-loaded"][data-testid="badge-provenance"]')).toHaveCount(2);
  });

  test("stays one flat grid with no provenance grouping (F2)", async ({ page }) => {
    await openSkills(page, payload());
    await expect(page.getByTestId("resource-card-grid")).toHaveCount(1);
    const content = page.getByTestId("directory-settings-content");
    await expect(content.locator("details, summary")).toHaveCount(0);
  });

  test("the provenance filter narrows the grid to one card (F3)", async ({ page }) => {
    await openSkills(page, payload());
    const filter = page.getByTestId("resource-provenance-filter");
    await expect(filter).toBeVisible({ timeout: 15_000 });
    await filter.locator('[data-provenance="loaded-elsewhere"]').click();
    await expect(page.getByTestId("resource-card")).toHaveCount(1);
    await expect(page.getByTestId("resource-card").first()).toContainText("hermes");
  });

  test("a loaded-elsewhere card shows the session-reported path (F4)", async ({ page }) => {
    await openSkills(page, payload());
    const sessionPath = page.getByTestId("resource-card-session-path");
    await expect(sessionPath).toHaveCount(1);
    await expect(sessionPath).toContainText("pi-hermes-memory");
  });

  test("scan-only is stated and no not-loaded badge appears (F5)", async ({ page }) => {
    const scanOnly = payload({ scanOnly: true, contributingSession: undefined });
    for (const s of (scanOnly.local as { skills: Record<string, unknown>[] }).skills) s.status = undefined;
    await openSkills(page, scanOnly);
    await expect(page.getByTestId("resource-grid-scan-only")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("badge-provenance")).toHaveCount(0);
    await expect(page.getByTestId("resource-provenance-filter")).toHaveCount(0);
  });

  test("degraded is stated and no not-loaded badge appears (F6)", async ({ page }) => {
    const degraded = payload({ degraded: true, contributingSession: undefined });
    for (const s of (degraded.local as { skills: Record<string, unknown>[] }).skills) s.status = undefined;
    await openSkills(page, degraded);
    await expect(page.getByTestId("resource-grid-degraded")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("badge-provenance")).toHaveCount(0);
    await expect(page.getByTestId("resource-provenance-filter")).toHaveCount(0);
  });

  test("the grid converges from scan-only to per-card provenance on refresh (F7)", async ({ page }) => {
    // First read is scan-only; every later read carries the join. The client
    // refetches without a full reload, so the grid must converge on its own.
    const scanOnly = payload({ scanOnly: true, contributingSession: undefined });
    for (const s of (scanOnly.local as { skills: Record<string, unknown>[] }).skills) s.status = undefined;

    let served = 0;
    await page.route("**/api/pi-resources**", (route) => {
      served += 1;
      const data = served === 1 ? scanOnly : payload();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });
    });
    await page.goto(`/folder/${encodeFolderPath(CWD)}/settings/skills`);

    await expect(page.getByTestId("resource-grid-scan-only")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("resource-grid-refresh").click();
    await expect(page.getByTestId("badge-provenance")).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByTestId("resource-grid-scan-only")).toHaveCount(0);
  });

  test("a differing session working directory is shown as context (F8)", async ({ page }) => {
    await openSkills(
      page,
      payload({ contributingSession: { sessionId: "s1", cwd: `${CWD}/.worktrees/os-x`, differsFromFolder: true } }),
    );
    const cwds = page.getByTestId("resource-card-session-cwd");
    await expect(cwds).toHaveCount(2); // one per not-loaded card
    await expect(cwds.first()).toContainText(".worktrees/os-x");
  });

  test("the Agents page still lists agents after the scanner rewire (F9)", async ({ page }) => {
    const withAgents = payload({
      local: {
        ...emptyScope,
        agents: [
          { name: "Explore", description: "Read-only search.", filePath: "/w/.pi/agents/Explore.md", type: "agent", enabled: true, model: "sonnet" },
        ],
      },
      contributingSession: undefined,
    });
    await openSkills(page, withAgents, "agents");
    await expect(page.getByTestId("resource-card")).toHaveCount(1);
    await expect(page.getByTestId("resource-card").first()).toContainText("Explore");
  });

  test("the Themes page renders a resolver-sourced theme with no new UI (F10)", async ({ page }) => {
    const withTheme = payload({
      local: {
        ...emptyScope,
        themes: [{ name: "midnight", filePath: "/w/themes/midnight.json", type: "theme", enabled: true }],
      },
      contributingSession: undefined,
    });
    await openSkills(page, withTheme, "themes");
    await expect(page.getByTestId("resource-card")).toHaveCount(1);
    await expect(page.getByTestId("resource-card").first()).toContainText("midnight");
    // No theme-specific surface is introduced — it is the same card grid.
    await expect(page.getByTestId("resource-card-grid")).toHaveAttribute("data-type", "theme");
  });

  test("a refresh does not mass-flip provenance to not-loaded (X7)", async ({ page }) => {
    // Every read returns the same good join; refreshing must not degrade it.
    await openSkills(page, payload());
    await expect(page.getByTestId("badge-provenance")).toHaveCount(3, { timeout: 15_000 });
    await page.getByTestId("resource-grid-refresh").click();
    await expect(page.locator('[data-provenance="not-loaded"][data-testid="badge-provenance"]')).toHaveCount(2);
    await expect(page.getByTestId("resource-card")).toHaveCount(6);
  });
});
