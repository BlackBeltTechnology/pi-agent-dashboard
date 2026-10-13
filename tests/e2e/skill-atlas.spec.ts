/**
 * Browser E2E — skill-atlas plugin (change: add-skill-atlas-screen).
 *
 * Covers test-plan #P3 #P4 #F1 #F2 #F3 #F4 #F8 #F11 #X13 (tasks 8.2–8.10).
 * Real rendering + real server: skills are written OUT-OF-BAND inside the
 * harness container (`docker exec`, exemplar tests/e2e/archive-fold.spec.ts),
 * so the watcher → fingerprint → `skill_atlas_changed` push path is exercised
 * end to end. Every seeded folder carries the `e2e-atlas-` prefix and is removed
 * on entry and exit (self-isolation across runs). Port + compose project come
 * from `.pi-test-harness.json` — never hardcoded.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject, REPO_ROOT } from "./lifecycle.js";

const CWD = FIXTURE_GIT;
const PREFIX = "e2e-atlas-";

function encodeFolderPath(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const projectAtlas = (q = "") => `/folder/${encodeFolderPath(CWD)}/atlas${q}`;

let containerId: string | undefined;
function inContainer(script: string): string {
  if (!containerId) {
    containerId = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .trim()
      .split("\n")[0];
    if (!containerId) throw new Error(`no running container for compose project ${harnessProject()}`);
  }
  return execFileSync("docker", ["exec", containerId, "sh", "-c", script], { encoding: "utf8", timeout: 60_000 }).trim();
}

/** Write `<root>/<PREFIX><name>/SKILL.md` inside the container. */
function writeSkill(root: string, name: string, body = ""): void {
  const id = `${PREFIX}${name}`;
  const doc = `---\nname: ${id}\ndescription: ${id} seeded by the e2e suite\n---\n${body}\n`;
  const b64 = Buffer.from(doc, "utf8").toString("base64");
  inContainer(`mkdir -p "${root}/${id}" && echo ${b64} | base64 -d > "${root}/${id}/SKILL.md"`);
}
const PROJECT_SKILLS = `${CWD}/.pi/skills`;
const GLOBAL_SKILLS = "$HOME/.pi/agent/skills";
function cleanup(): void {
  inContainer(`mkdir -p "${PROJECT_SKILLS}" "${GLOBAL_SKILLS}"; rm -rf "${PROJECT_SKILLS}"/${PREFIX}* "${GLOBAL_SKILLS}"/${PREFIX}*`);
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)).ok) return;
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

async function axeSeriousOrWorse(page: Page, selector: string): Promise<string[]> {
  const axePath = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
  if (!fs.existsSync(axePath)) throw new Error(`axe-core not installed at ${axePath}`);
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async (sel) => {
    const axe = (window as unknown as { axe: { run: (c: string, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe;
    const r = await axe.run(sel, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
  }, selector);
}

test.describe.configure({ mode: "serial" });

test.describe("skill atlas", () => {
  test.beforeAll(() => {
    cleanup();
    writeSkill(PROJECT_SKILLS, "hub", `Run ${PREFIX}leaf-a, then ${PREFIX}leaf-b. Uses \`atlas_probe_tool\`.`);
    writeSkill(PROJECT_SKILLS, "leaf-a", `Back to ${PREFIX}hub. Uses \`atlas_probe_tool\`.`);
    writeSkill(PROJECT_SKILLS, "leaf-b", "");
    writeSkill(GLOBAL_SKILLS, "global-one", `Mentions ${PREFIX}global-two.`);
    writeSkill(GLOBAL_SKILLS, "global-two", "");
  });
  test.afterAll(() => cleanup());

  test("F1: folder actions menu opens the project atlas; Back returns to the folder (#F1)", async ({ page }) => {
    await ensureGitSession(page);
    await expandFolder(page, CWD);
    await page.getByTestId(`folder-actions-menu-${CWD}`).first().click();
    await page.getByTestId("folder-menu-item-skill-atlas").click();
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(CWD)}/atlas`));
    await expect(page.getByTestId("skill-atlas-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`skill-atlas-node-${PREFIX}hub`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("skill-atlas-back").click();
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(CWD)}$`));
  });

  test("F2: /atlas is the global atlas; Settings ▸ Resources holds the Skill Atlas entry (#F2)", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/atlas");
    await expect(page.getByTestId("skill-atlas-scope")).toContainText("Global", { timeout: 20_000 });
    await expect(page.getByTestId(`skill-atlas-node-${PREFIX}global-one`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`skill-atlas-node-${PREFIX}hub`)).toHaveCount(0);
    await page.goto("/settings/general");
    const resources = page.getByTestId("settings-nav-group-resources");
    await resources.getByTestId("nav-promoted-skill-atlas").click();
    await page.getByTestId("skill-atlas-open").click();
    await expect(page).toHaveURL(/\/atlas$/);
  });

  test("F3: Skills page section sits above the grid; a hub chip opens a 1-hop focus (#F3)", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto(`/folder/${encodeFolderPath(CWD)}/settings/skills`);
    const section = page.getByTestId("skill-atlas-summary");
    await expect(section).toBeVisible({ timeout: 20_000 });
    const card = page.getByText(`${PREFIX}leaf-b`, { exact: true }).last();
    const [s, c] = [await section.boundingBox(), await card.boundingBox()];
    expect(s && c && s.y < c.y).toBeTruthy();
    await section.getByTestId(`skill-atlas-hub-${PREFIX}hub`).click();
    await expect(page.getByTestId("skill-atlas-detail")).toContainText(`${PREFIX}hub`, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "1 hop" })).toHaveAttribute("aria-pressed", "true");
  });

  test("F4 + P3: an added skill appears within 5 s, selection kept, status Updating → Up to date (#F4, #P3)", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto(projectAtlas(`?sel=${PREFIX}hub`));
    await expect(page.getByTestId("skill-atlas-detail")).toContainText(`${PREFIX}hub`, { timeout: 20_000 });
    await expect(page.getByTestId("skill-atlas-status")).toContainText("Up to date");
    const t0 = Date.now();
    writeSkill(PROJECT_SKILLS, "added", `Points at ${PREFIX}hub.`);
    await expect(page.getByTestId(`skill-atlas-node-${PREFIX}added`)).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    await expect(page.getByTestId("skill-atlas-status")).toContainText("Up to date");
    await expect(page.getByTestId("skill-atlas-detail")).toContainText(`${PREFIX}hub`);
  });

  test("P4: first graph render at 300 nodes < 500 ms (#P4)", async ({ page }) => {
    const skills = Array.from({ length: 300 }, (_, i) => ({
      id: `p4-skill-${String(i).padStart(3, "0")}`,
      description: "",
      filePath: `/x/${i}/SKILL.md`,
      origin: "global",
      degree: 1,
    }));
    const links = skills.slice(1).map((s, i) => ({ source: s.id, target: skills[(i * 7) % 300].id, type: "references", why: "" }));
    await page.route("**/api/plugins/skill-atlas/graph**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { scope: "global", fingerprint: "p4", builtAt: 1, degraded: false, warnings: [], skills, links } }),
      }),
    );
    await gotoDashboard(page);
    await page.goto("/atlas");
    await page.getByRole("tab", { name: "Cards" }).click();
    await page.evaluate(() => performance.mark("atlas-graph-start"));
    await page.getByRole("tab", { name: "Graph" }).click();
    await expect(page.getByTestId("skill-atlas-node-p4-skill-000")).toBeAttached({ timeout: 10_000 });
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() => {
            const start = performance.getEntriesByName("atlas-graph-start")[0];
            resolve(performance.now() - start.startTime);
          }),
        ),
    );
    expect(ms).toBeLessThan(500);
  });

  test("F8: mobile — filters behind a disclosure, detail panel above the graph (#F8)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoDashboard(page);
    await page.goto(projectAtlas(`?sel=${PREFIX}hub`));
    const toggle = page.getByTestId("skill-atlas-filters-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("group", { name: "Relations" })).toBeHidden();
    const detail = await page.getByTestId("skill-atlas-detail").boundingBox();
    const graph = await page.getByTestId("skill-atlas-graph").boundingBox();
    expect(detail && graph && detail.y < graph.y).toBeTruthy();
  });

  for (const theme of ["dark", "light"] as const) {
    test(`F11: axe — no serious/critical WCAG violation, base ${theme} (#F11)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoDashboard(page);
      await page.goto(projectAtlas(`?sel=${PREFIX}hub`));
      await expect(page.getByTestId("skill-atlas-page")).toBeVisible({ timeout: 20_000 });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      for (const tab of ["Graph", "Cards", "Links"]) {
        await page.getByRole("tab", { name: tab }).click();
        expect(await axeSeriousOrWorse(page, '[data-testid="skill-atlas-page"]'), `${tab} ${theme}`).toEqual([]);
      }
      await page.goto(`/folder/${encodeFolderPath(CWD)}/settings/skills`);
      await expect(page.getByTestId("skill-atlas-summary")).toBeVisible({ timeout: 20_000 });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      expect(await axeSeriousOrWorse(page, '[data-testid="skill-atlas-summary"]')).toEqual([]);
    });
  }

  test("X13: disabled plugin (after restart) leaves no surface; re-enable restores it (#X13)", async ({ page }) => {
    test.setTimeout(420_000);
    const toggle = async (enabled: boolean) => {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/plugins/skill-atlas/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      expect(res.ok).toBeTruthy();
      await restartDashboard();
    };
    await toggle(false);
    try {
      await ensureGitSession(page);
      await expandFolder(page, CWD);
      await page.getByTestId(`folder-actions-menu-${CWD}`).first().click();
      await expect(page.getByTestId("folder-menu-item-refresh-folder")).toBeVisible();
      await expect(page.getByTestId("folder-menu-item-skill-atlas")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.goto(`/folder/${encodeFolderPath(CWD)}/settings/skills`);
      await expect(page.getByTestId("directory-settings")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("skill-atlas-summary")).toHaveCount(0);
      await page.goto("/settings/general");
      await expect(page.getByTestId("settings-nav-group-resources")).toBeVisible();
      await expect(page.getByTestId("nav-promoted-skill-atlas")).toHaveCount(0);
      for (const url of ["/atlas", projectAtlas()]) {
        await page.goto(url);
        await page.waitForTimeout(1_000);
        await expect(page.getByTestId("skill-atlas-page")).toHaveCount(0);
      }
    } finally {
      await toggle(true);
    }
  });
});
