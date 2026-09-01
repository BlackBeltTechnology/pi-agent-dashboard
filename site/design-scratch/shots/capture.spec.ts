/**
 * Feature-driven screenshot capture, driven by the docker e2e harness.
 *
 * Runs every scenario in scenarios.ts across desktop+mobile and dark+light,
 * and writes a coverage report keyed by docs/user-features.md section.
 *
 * Failure policy (deliberate): a scenario that cannot reach its feature writes
 * NO png and is recorded MISSING with the reason. The run still exits 0 — a
 * capture pass is a reporting tool, not a gate. What it must never do is write
 * a plausible-looking screenshot of the wrong screen.
 */

import { test, expect, chromium, type Browser } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHOTS, type Ctx, type ViewportId } from "./scenarios.js";
import { gotoDashboard, pinDirectory, ensureGitSession, dirtyMarkdown, FIXTURE_GIT }
  from "../../tests/e2e/helpers/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const BASE = `http://localhost:${process.env.PW_E2E_PORT ?? "18000"}`;

const VIEWPORTS: Record<ViewportId, { width: number; height: number; dsf: number; mobile: boolean }> = {
  desktop: { width: 1440, height: 900, dsf: 2, mobile: false },
  mobile: { width: 390, height: 844, dsf: 3, mobile: true },
};

const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

/** out/<viewport>[-light]/<id>.png — matches site/public/screenshots layout. */
function outDir(v: ViewportId, theme: Theme): string {
  return join(OUT, theme === "light" ? `${v}-light` : v);
}

interface Result {
  id: string;
  section: string;
  bullet: string;
  viewport: ViewportId;
  theme: Theme;
  status: "ok" | "missing";
  reason?: string;
  file?: string;
}

const ctx: Ctx = {
  fixtureGit: "/fixtures/sample-git",
  fixtureBoard: "/fixtures/openspec-board",
  folderRoute: (cwd, sub) => `/folder/${Buffer.from(cwd).toString("base64url")}/${sub}`,
  dirty: async (page, relPath) =>
    dirtyMarkdown(page, "/fixtures/sample-git", relPath, `shots-${Date.now()}`),
};

test("capture every user-facing feature", async ({ page: seedPage }) => {
  test.setTimeout(25 * 60_000);

  // Seed once. Without a pinned folder every session-dependent scenario is
  // unreachable and the whole run is MISSING.
  //
  // NOT ensureGitSession() here: that helper looks for an existing card FIRST
  // and spawns a fresh session if it finds none. Our corpus is transplanted
  // ENDED sessions, which only render once the folder is pinned — so the
  // helper's probe always misses, and it spawns a redundant empty session (or
  // times out waiting for its card). Pin first, then look.
  await gotoDashboard(seedPage);
  const anyCard = seedPage.getByTestId("session-card-desktop").first();
  if (!(await anyCard.isVisible().catch(() => false))) {
    await pinDirectory(seedPage, FIXTURE_GIT).catch(() => { /* already pinned */ });
  }
  // ENDED sessions are collapsed behind a "› N ended" disclosure per folder,
  // so a transplanted corpus renders ZERO visible cards until it is expanded.
  // That is what made the spawn fallback fire and then time out.
  await seedPage.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`)
    .click({ timeout: 10_000 }).catch(() => { /* already expanded */ });

  // Only fall back to spawning if the corpus surfaced nothing at all.
  if (!(await anyCard.waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true).catch(() => false))) {
    await ensureGitSession(seedPage);
  }
  const cards = await seedPage.getByTestId("session-card-desktop").count();
  console.log(`  corpus: ${cards} session cards visible`);

  await rm(OUT, { recursive: true, force: true });
  const results: Result[] = [];
  const browser: Browser = await chromium.launch({ headless: true });

  try {
    // One context per (viewport, theme) — not per shot. Context churn was the
    // dominant cost in the first pass.
    for (const theme of THEMES) {
      for (const v of Object.keys(VIEWPORTS) as ViewportId[]) {
        const shots = SHOTS.filter((s) => s.viewports.includes(v));
        if (shots.length === 0) continue;

        const vp = VIEWPORTS[v];
        const context = await browser.newContext({
          baseURL: BASE,
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.dsf,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          colorScheme: theme,
        });
        let page = await context.newPage();

        // The first-launch display modal renders async and swallows clicks.
        const backdrop = page.getByTestId("first-launch-display-backdrop");
        await page.addLocatorHandler(backdrop, async () => {
          await backdrop.getByRole("button", { name: /^skip$/i }).click();
        });

        for (const shot of shots) {
          // A crashed renderer takes the page with it and every later shot in
          // this context would cascade as "Target page closed". Recover.
          if (page.isClosed()) {
            page = await context.newPage();
            await page.addLocatorHandler(page.getByTestId("first-launch-display-backdrop"),
              async () => {
                await page.getByTestId("first-launch-display-backdrop")
                  .getByRole("button", { name: /^skip$/i }).click();
              });
          }
          const base: Omit<Result, "status"> = {
            id: shot.id, section: shot.section, bullet: shot.bullet, viewport: v, theme,
          };
          try {
            const clip = await shot.run(page, ctx);
            const dir = outDir(v, theme);
            await mkdir(dir, { recursive: true });
            const file = join(dir, `${shot.id}.png`);
            if (clip) {
              await clip.screenshot({ path: file });
            } else {
              await page.screenshot({ path: file, fullPage: false });
            }
            results.push({ ...base, status: "ok", file });
            console.log(`  ok      ${theme.padEnd(5)} ${v.padEnd(7)} ${shot.id}`);
          } catch (err) {
            const reason = (err as Error).message.split("\n")[0].slice(0, 160);
            results.push({ ...base, status: "missing", reason });
            console.log(`  MISSING ${theme.padEnd(5)} ${v.padEnd(7)} ${shot.id} — ${reason}`);
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "coverage.json"), JSON.stringify(results, null, 2));
  await writeFile(join(OUT, "index.html"), contactSheet(results));

  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\n  ${ok}/${results.length} captured → ${OUT}`);

  // Reporting tool, not a gate: the run is green as long as it produced a
  // report. Per-feature status lives in coverage.json.
  expect(results.length).toBeGreaterThan(0);
});

function contactSheet(results: Result[]): string {
  const bySection = new Map<string, Result[]>();
  for (const r of results) {
    const list = bySection.get(r.section) ?? [];
    list.push(r);
    bySection.set(r.section, list);
  }
  const ok = results.filter((r) => r.status === "ok").length;

  const sections = [...bySection.entries()].map(([section, rows]) => {
    const cards = rows.map((r) => {
      if (r.status === "ok") {
        const rel = r.file!.slice(OUT.length + 1);
        return `<figure class="c"><img src="${rel}" loading="lazy" alt="${r.id}">
          <figcaption><b>${r.id}</b><span>${r.theme} · ${r.viewport}</span></figcaption></figure>`;
      }
      return `<figure class="c miss"><div class="x">MISSING</div>
        <figcaption><b>${r.id}</b><span>${r.theme} · ${r.viewport}</span>
        <em>${escapeHtml(r.reason ?? "")}</em></figcaption></figure>`;
    }).join("");
    const good = rows.filter((r) => r.status === "ok").length;
    return `<section><h2>${escapeHtml(section)} <small>${good}/${rows.length}</small></h2>
      <div class="g">${cards}</div></section>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8">
<title>Feature screenshot coverage</title>
<style>
  :root{--bg:#0a0a0a;--p:#141414;--fg:#e5e5e5;--f2:#b0b0b0;--f3:#808080;--a:#60a5fa;--r:rgba(255,255,255,.1)}
  *{box-sizing:border-box} body{margin:0;padding:40px;background:var(--bg);color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  h1{font-size:30px;font-weight:500;margin:0 0 6px} .lede{color:var(--f2);margin:0 0 36px}
  h2{font-size:15px;font-weight:500;letter-spacing:.02em;margin:38px 0 14px;
    padding-bottom:8px;border-bottom:1px solid #242424}
  h2 small{font-family:ui-monospace,monospace;color:var(--f3);font-weight:400;margin-left:8px}
  .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .c{margin:0;background:var(--p);border:1px solid #242424;border-radius:8px;overflow:hidden;
    box-shadow:inset 0 1px 0 var(--r)}
  .c img{display:block;width:100%;height:auto;background:#000}
  figcaption{padding:10px 12px;font-family:ui-monospace,monospace;font-size:11.5px;
    display:flex;flex-direction:column;gap:3px}
  figcaption span{color:var(--f3)} figcaption em{color:#f87171;font-style:normal;font-size:11px}
  .miss .x{height:120px;display:grid;place-items:center;font-family:ui-monospace,monospace;
    font-size:12px;letter-spacing:.16em;color:#f87171;background:repeating-linear-gradient(
    45deg,#151515,#151515 10px,#1a1414 10px,#1a1414 20px)}
</style>
<h1>Feature screenshot coverage</h1>
<p class="lede">${ok}/${results.length} shots captured · one entry per bullet in
<code>docs/user-features.md</code> · MISSING means the scenario could not reach the
feature, and no image was written.</p>
${sections}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
