import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { harnessContainer } from "./helpers/folder-collapse.js";
import { byTestId, dismissToasts, FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// improve-canvas-html-and-url-ux — static mockups in the viewer
//   F15 (test-plan #F15): an operator open serves a mockup with its relative
//       assets (styled, images load) in a frame WITHOUT allow-same-origin.
//   F17 (test-plan #F17): the address bar navigates inside the same static
//       target without registering a new picker entry.
//
// F15 exemplar: tests/e2e/asciidoc-preview.spec.ts (`/view @file` → editor pane).
// F17 uses the faux scenario `canvas-html-screens` (qa/fixtures/faux-scenarios.ts).
// ─────────────────────────────────────────────────────────────────────────

/** 1×1 transparent PNG. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Create the F15 mockup (HTML, CSS, a PNG) inside the fixture checkout, out of band. */
function seedLoginMockup(): void {
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(${JSON.stringify(FIXTURE_GIT)}, "mockups/login");
    fs.mkdirSync(path.join(root, "img"), { recursive: true });
    fs.writeFileSync(path.join(root, "style.css"), ".card{border-radius:12px;padding:8px}\\n");
    fs.writeFileSync(path.join(root, "img/logo.png"), Buffer.from(${JSON.stringify(PNG_B64)}, "base64"));
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head>' +
      '<body><div class="card">Login</div><img id="logo" src="img/logo.png"></body></html>\\n',
    );
  `;
  execFileSync("docker", ["exec", "-i", harnessContainer(), "node"], { input: script });
}

test.describe("improve-canvas-html-and-url-ux — static mockup viewer", () => {
  test("F15: opening a workspace mockup serves its relative assets, isolated (no allow-same-origin)", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    seedLoginMockup();
    const card = await spawnFreshGitSession(page);
    await card.click();
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    // `/view @file` is an operator open of the file in the editor pane (the tree-click path).
    await composer.fill("/view @mockups/login/index.html");
    await page.keyboard.press("Escape");
    await composer.fill("/view @mockups/login/index.html");
    await expect(async () => {
      await dismissToasts(page);
      await byTestId(page, "sendButton").click({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    const iframe = page.getByTestId("live-iframe");
    await expect(iframe).toBeVisible({ timeout: 30_000 });
    // The frame never carries allow-same-origin and never srcdoc.
    expect(await iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(await iframe.getAttribute("srcdoc")).toBeNull();

    const frame = page.frameLocator('[data-testid="live-iframe"]');
    await expect(frame.locator(".card")).toBeVisible({ timeout: 20_000 });
    const radius = await frame.locator(".card").evaluate((n) => getComputedStyle(n).borderRadius);
    expect(radius).toBe("12px");
    const natural = await frame.locator("#logo").evaluate((img) => (img as HTMLImageElement).naturalWidth);
    expect(natural).toBeGreaterThan(0);
  });

  test("F17: typing a sibling path in the address bar navigates within the target, no new picker entry", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-html-screens]] go");

    const iframe = page.getByTestId("live-iframe");
    await expect(iframe).toBeVisible({ timeout: 40_000 });
    const frame = page.frameLocator('[data-testid="live-iframe"]');
    await expect(frame.getByRole("heading", { name: "Screen A" })).toBeVisible({ timeout: 20_000 });

    const address = page.getByTestId("live-address");
    await address.fill("screens/b.html");
    await address.press("Enter");
    await expect(frame.getByRole("heading", { name: "Screen B" })).toBeVisible({ timeout: 20_000 });

    // Navigating inside the target registered nothing: the picker lists no new target.
    await page.getByTestId("live-back").click();
    await expect(page.getByTestId("live-target-row")).toHaveCount(0);
  });
});
