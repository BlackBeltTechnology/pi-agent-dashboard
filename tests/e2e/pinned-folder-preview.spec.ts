/**
 * E2E: a pinned folder with NO session previews its files in the folder pane.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The route tests pin the cwd admission of every file route. Only a real browser against the real
 * server shows that the folder pane (`/folder/:enc/view`) actually renders a pinned folder's markdown
 * and image — they used to 403 as "unknown session path" because the file routes only admitted a cwd
 * that matched a live session.
 *
 * The folder is created in the harness container and pinned through the add-folder picker, so no
 * session ever exists in it.
 *
 * See change: core-file-cwd-admission (test-plan #F2).
 */
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

// 1x1 PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

/** base64url of the cwd — mirrors `encodeFolderPath` (the web package does not export it). */
const encodeFolderPath = (cwd: string): string =>
  Buffer.from(cwd).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test.describe("pinned folder preview (core-file-cwd-admission)", () => {
  const dir = `/fixtures/pinned-preview-${Date.now()}`;

  test.beforeAll(() => {
    inContainer(`
      const fs = require("node:fs");
      fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true });
      fs.writeFileSync(${JSON.stringify(`${dir}/readme.md`)}, "# Pinned folder heading\\n\\nbody text\\n");
      fs.writeFileSync(${JSON.stringify(`${dir}/pic.png`)}, Buffer.from(${JSON.stringify(PNG_B64)}, "base64"));
    `);
  });

  test.afterAll(() => {
    execSync(`docker exec ${containerName()} rm -rf ${dir}`);
  });

  test("#F2 a pinned folder with no session renders its markdown and image", async ({ page }) => {
    await gotoDashboard(page);
    await pinDirectory(page, dir);

    const view = (file: string) => `/folder/${encodeFolderPath(dir)}/view?path=${encodeURIComponent(`${dir}/${file}`)}`;

    await page.goto(view("readme.md"));
    await expect(page.getByRole("heading", { name: "Pinned folder heading" })).toBeVisible({ timeout: 20_000 });

    await page.goto(view("pic.png"));
    const img = page.locator("img").filter({ hasNot: page.locator("[aria-hidden=true]") }).last();
    await expect.poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);

    // The refusal the old gate produced must not be on screen.
    await expect(page.getByText(/unknown session path|no longer available/i)).toHaveCount(0);
  });
});
