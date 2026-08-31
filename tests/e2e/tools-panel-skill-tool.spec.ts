import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

// test-plan #F1 (8.34) — an ingested SKILL-declared tool renders in
// Settings → Tools IDENTICALLY to a built-in missing tool: the row shows
// the `[Install ▾]` dropdown listing the host-OS first-party commands.
//
// `imagemagick` is declared by the video-production packages' `pi.tools`
// manifest (optional) and ingested into the registry at server startup
// (ingestInstalledSkillTools) — by the time this spec runs it IS a
// registry row. The harness container has no ImageMagick, so the row
// resolves `ok:false` and carries per-OS installHints (apt/brew/winget
// commands).
//
// Note: ffmpeg (also skill-declared) resolves `ok:true` IN THE HARNESS
// via the static-npm strategy — ffmpeg-static ships as the package's
// optionalDependency — which is why the missing-tool assertions pin
// imagemagick, not ffmpeg.
//
// See change: add-skill-tool-provisioning (design D1/D5, task 6.2).

test.describe("Settings → Tools: ingested skill tool", () => {
  test("missing skill-declared tool renders the Install dropdown with host-OS commands", async ({
    page,
  }) => {
    await gotoDashboard(page);
    // `/settings` bare does not match the `/settings/:page?` route — open
    // the Developer page (hosts ToolsSection) and wait for the shell.
    await page.goto("/settings/developer");
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });

    // The ingested row exists — same surface a built-in tool uses.
    const row = page.locator("#tool-row-imagemagick");
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The `[Install ▾]` affordance opens the first-party hint list.
    const installButton = row.locator("[aria-expanded]").first();
    await expect(installButton).toBeVisible();
    await installButton.click();

    // The dropdown lists the FIRST-PARTY host-OS command (linux → apt).
    await expect(row.locator("text=apt install imagemagick").first()).toBeVisible();
  });
});
