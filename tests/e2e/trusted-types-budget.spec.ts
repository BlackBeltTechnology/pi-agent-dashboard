import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { readCspReports } from "./helpers/csp-strict.js";
import { fileViewUrl, installTtProbe, readTtProbe, removeFile, seedFile, type TtProbe } from "./helpers/trusted-types.js";
import { MERMAID_GALLERY_MD } from "./helpers/tt-fixtures.js";
import { REPO_ROOT } from "./lifecycle.js";

// Trusted Types violation budget (change: harden-client-sinks, design D9,
// test-plan #F3). The server itself runs TT in `report` mode (the default), so
// no document rewriting: every checked route must record 0 TT violations and
// at most its recorded `default`-policy invocations
// (tests/e2e/fixtures/trusted-types-budget.json — fixtures are deterministic,
// a new raw sink raises the count). A separate control step proves the
// directive is active: one deliberate raw sink on a page with no `default`
// policy (`/apps/team/`) yields exactly one violation, excluded from the
// budget. Any page showing the server-offline state fails the run.
// Re-record: PI_TT_BUDGET_RECORD=1 npm run test:e2e -- trusted-types-budget.
// Exemplar: tests/e2e/csp.spec.ts.
//
// Shadow evaluation (change: add-trusted-types-shadow-enforce, test-plan #F1/#F2):
// the routes above run with shadow evaluation active (report mode), so zero
// violations and unchanged `default`-hit budgets prove it adds neither; the last
// test proves the end-to-end evidence path (client outcome → persisted counter →
// /api/health + /api/csp-violations).

test.use({ serviceWorkers: "block" });

const BUDGET_FILE = path.join(REPO_ROOT, "tests", "e2e", "fixtures", "trusted-types-budget.json");
const RECORD = process.env.PI_TT_BUDGET_RECORD === "1";
const GALLERY = "tt-budget-gallery.md";

/** Plugin ids from each `packages/*-plugin` manifest. */
const PLUGIN_IDS = fs
  .readdirSync(path.join(REPO_ROOT, "packages"))
  .filter((d) => d.endsWith("-plugin"))
  .map((d) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages", d, "package.json"), "utf8"));
      return pkg["pi-dashboard-plugin"]?.id as string | undefined;
    } catch {
      return undefined;
    }
  })
  .filter((id): id is string => !!id)
  .sort();

const FILE_VIEWS = ["README.md", "notes.md", GALLERY, "flow.mmd", "styling.adoc", "report.docx", "doc.pdf", "rich.eml", "data.csv", "logo.png"];
const CORE_ROUTES = ["/", "/settings/general", "/settings/security", "/settings/access", "/settings/appearance", "/atlas"];

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
  // The offline state ("Disconnected from … Retrying…") must never show.
  await expect(page.getByText(/Disconnected from|server offline/i)).toHaveCount(0);
}

const observed: Record<string, number> = {};

test.beforeAll(() => seedFile(GALLERY, MERMAID_GALLERY_MD));
test.afterAll(() => {
  removeFile(GALLERY);
  if (RECORD) fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(observed, Object.keys(observed).sort(), 2)}\n`);
});

function budgetFor(route: string): number {
  if (RECORD || !fs.existsSync(BUDGET_FILE)) return Number.POSITIVE_INFINITY;
  const b = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) as Record<string, number>;
  return b[route] ?? 0;
}

/** Budget key: the route with any session id replaced by `:sid` (ids differ per run). */
const keyOf = (route: string) => route.replace(/\/session\/[^/?]+/, "/session/:sid");

async function check(page: Page, route: string, settleMs: number): Promise<TtProbe> {
  await page.goto(route);
  await settle(page, settleMs);
  const probe = await readTtProbe(page);
  observed[keyOf(route)] = probe.defaultHits;
  expect(probe.violations, `${route}: ${JSON.stringify(probe.violations)}`).toEqual([]);
  expect(probe.defaultHits, `${route}: default-policy hits over budget`).toBeLessThanOrEqual(budgetFor(keyOf(route)));
  return probe;
}

test.describe("Trusted Types budget (report mode)", () => {
  test("the dashboard document carries the report-only TT directive and the mode meta", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["content-security-policy-report-only"] ?? "").toContain("require-trusted-types-for 'script'");
    expect(await res.text()).toContain('<meta name="pi-trusted-types" content="report">');
  });

  test("core routes and file previews: 0 violations, default hits within budget", async ({ page }) => {
    test.setTimeout(300_000);
    await installTtProbe(page);
    const card = await ensureGitSession(page);
    const sid = await card.getAttribute("data-session-id");
    for (const r of CORE_ROUTES) await check(page, r, 3_000);
    await check(page, `/session/${sid}`, 3_000);
    await check(page, `/session/${sid}/editor?file=README.md`, 5_000);
    for (const f of FILE_VIEWS) await check(page, fileViewUrl(f), 5_000);
    expect(FIXTURE_GIT).toBeTruthy();
  });

  test("plugin settings pages (10 s settle): 0 violations, default hits within budget", async ({ page }) => {
    test.setTimeout(60_000 + PLUGIN_IDS.length * 15_000);
    await installTtProbe(page);
    await gotoDashboard(page);
    for (const id of PLUGIN_IDS) await check(page, `/settings/plugins/${id}`, 10_000);
  });

  test("/apps/team/: 0 violations, default hits within budget", async ({ page }) => {
    await installTtProbe(page);
    await gotoDashboard(page);
    await check(page, "/apps/team/", 5_000);
  });

  test("control: one deliberate raw sink records exactly one violation", async ({ page }) => {
    await installTtProbe(page);
    await gotoDashboard(page);
    await page.goto("/apps/team/");
    await settle(page, 3_000);
    const before = (await readTtProbe(page)).violations.length;
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = "<b>control</b>";
    });
    await expect.poll(async () => (await readTtProbe(page)).violations.length - before, { timeout: 5_000 }).toBe(1);
  });

  test("F2: shadow outcomes reach /api/health and /api/csp-violations without changing the rendered input", async ({ page }) => {
    test.setTimeout(90_000);
    await installTtProbe(page);
    await gotoDashboard(page);
    const before = readCspReports()?.ttShadow;
    const base = (k: string) => Number(before?.[k] ?? 0);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", "<img src=x onerror=f()>");
      try {
        new Worker("/plugin-assets/x/abc/worker.js").terminate();
      } catch {
        /* the URL is not served; only the default-policy call matters */
      }
    });
    // Report neutrality: the unsafe markup keeps its handler.
    await expect(page.locator("body > img[src='x'][onerror]")).toHaveCount(1);
    // `pagehide` forces the final keepalive flush.
    await page.goto("about:blank");
    await expect
      .poll(() => Number(readCspReports()?.ttShadow?.["would-alter-html"] ?? 0) - base("would-alter-html"), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => Number(readCspReports()?.ttShadow?.["would-block-script-url"] ?? 0) - base("would-block-script-url"), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    // The operator list sits behind the network guard, so read it with the page's authenticated context.
    await gotoDashboard(page);
    const res = await page.request.get("/api/csp-violations");
    expect(res.ok()).toBe(true);
    const counters = ((await res.json()) as { counters: { directive: string; sink: string }[] }).counters;
    const rows = counters.filter((c) => c.directive === "trusted-types-shadow");
    expect(rows.map((r) => r.sink)).toEqual(expect.arrayContaining(["would-alter-html", "would-block-script-url"]));
  });
});
