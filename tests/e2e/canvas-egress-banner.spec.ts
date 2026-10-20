import { execSync } from "node:child_process";
import { expect, narrowTrust, test } from "./fixtures.js";
import { harnessContainer } from "./helpers/folder-collapse.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// improve-canvas-html-and-url-ux — egress banner for an auto-opened mockup
//   F16 (test-plan #F16): the banner lists the CDN origin found in markup, no
//       access dialog opens, "Allow once" collapses it to a pill.
//   F18 (test-plan #F18): "Allow for this project" raises the standard dialog;
//       allow-always lists the origin in Settings → Access with its project;
//       Revoke removes it and the banner lists the CDN again.
//
// Faux scenario `canvas-html-cdn` writes `mockups/cdn/index.html` (Tailwind CDN)
// and declares it with `canvas` kind:file. F16 exemplar:
// tests/e2e/canvas-declare-tool.spec.ts; F18 exemplar:
// tests/e2e/access-grants-revoke.spec.ts + access-grant-dialog.spec.ts (prompting
// needs hostGate.mode=enforce + accessGrants.promptEnabled, restored afterwards).
// ─────────────────────────────────────────────────────────────────────────

const CDN = "https://cdn.tailwindcss.com";
const CONFIG = "/home/pi/.pi/dashboard/config.json";
const STORES = [CONFIG, "/home/pi/.pi/dashboard/preview-egress.json"];

const nodeIn = (script: string): string =>
  execSync(`docker exec -i ${harnessContainer()} node`, { input: script, encoding: "utf8" });

test.describe("improve-canvas-html-and-url-ux — F16 egress banner", () => {
  test("F16: the CDN is listed as found in markup, no dialog opens, Allow once collapses to a pill", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-html-cdn]] go");

    const banner = page.getByTestId("egress-banner");
    await expect(banner).toBeVisible({ timeout: 40_000 });
    const row = banner.getByTestId("egress-row").filter({ hasText: CDN });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("egress-source")).toHaveText("in markup");
    // An auto-open never prompts.
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);

    await row.getByTestId("egress-allow-once").click();
    const pill = page.getByTestId("egress-banner").filter({ hasText: "cdn.tailwindcss.com allowed for this preview" });
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
  });
});

test.describe.serial("improve-canvas-html-and-url-ux — F18 project grant", () => {
  test.skip(process.env.PI_DASHBOARD_DISABLE_GRANT_PROMPT === "1", "prompting force-disabled by the kill switch");
  let saved: Record<string, string | null> = {};

  test.beforeAll(async ({ request }) => {
    saved = JSON.parse(
      nodeIn(`
        const fs = require("node:fs");
        const out = {};
        for (const p of ${JSON.stringify(STORES)}) out[p] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
        process.stdout.write(JSON.stringify(out));
      `),
    );
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    nodeIn(`
      const fs = require("node:fs");
      const p = ${JSON.stringify(CONFIG)};
      const cur = JSON.parse(fs.readFileSync(p, "utf8"));
      cur.accessGrants = { ...(cur.accessGrants ?? {}), promptEnabled: true };
      fs.writeFileSync(p + ".e2e.tmp", JSON.stringify(cur, null, 2));
      fs.renameSync(p + ".e2e.tmp", p);
    `);
  });

  test.afterAll(() => {
    nodeIn(`
      const fs = require("node:fs");
      const saved = ${JSON.stringify(saved)};
      for (const [p, body] of Object.entries(saved)) {
        if (body === null) { try { fs.unlinkSync(p); } catch {} }
        else { fs.writeFileSync(p + ".e2e.tmp", body); fs.renameSync(p + ".e2e.tmp", p); }
      }
    `);
  });

  test("F18: allow-always lists the origin with its project in Access; Revoke brings the banner row back", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-html-cdn]] go");

    const row = page.getByTestId("egress-banner").getByTestId("egress-row").filter({ hasText: CDN });
    await expect(row).toBeVisible({ timeout: 40_000 });

    // The operator's click raises the standard dialog; answer allow-always.
    await row.getByTestId("egress-allow-project").click();
    const dialog = page.getByTestId("grant-dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByTestId("grant-allow-always").click();
    await expect(dialog).toHaveCount(0);

    // Access lists the grant with its project; Revoke removes it.
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-section")).toBeVisible({ timeout: 20_000 });
    const entry = page.getByTestId("access-entry").filter({ hasText: CDN });
    await expect(entry.first()).toBeVisible({ timeout: 15_000 });
    await expect(entry.first().getByTestId("access-entry-project")).toContainText("/");
    await entry.first().getByTestId("access-revoke").click();
    await expect(entry).toHaveCount(0, { timeout: 15_000 });

    // Re-opening the preview lists the CDN again (no restart: the next CSP build reads the store).
    await page.goBack();
    await sendPrompt(page, "[[faux:canvas-html-cdn]] again");
    await expect(page.getByTestId("egress-banner").getByTestId("egress-row").filter({ hasText: CDN })).toBeVisible({
      timeout: 40_000,
    });
  });
});
