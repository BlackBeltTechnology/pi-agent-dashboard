import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

// test-plan #F1 (8.34) — an ingested SKILL-declared tool renders in
// Settings → Tools IDENTICALLY to a built-in missing tool: the row shows
// the `[Install ▾]` dropdown listing the host-OS first-party commands.
//
// `ffmpeg` is declared by the video-transcription + video-production
// packages' `pi.tools` manifests and ingested into the registry at server
// startup (ingestInstalledSkillTools) — by the time this spec runs it IS
// a registry row. The harness container has no ffmpeg and no
// ffmpeg-static, so the row resolves `ok:false` and carries per-OS
// installHints (apt/brew/winget commands).
//
// See change: add-skill-tool-provisioning (design D1/D5, task 6.2).

test.describe("Settings → Tools: ingested skill tool", () => {
  test("missing skill-declared tool renders the Install dropdown with host-OS commands", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/settings");

    // The ingested row exists — same surface a built-in tool uses.
    const row = page.locator("#tool-row-ffmpeg");
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Missing status: the row renders a source/resolution state, not a
    // happy-path check. Then the `[Install ▾]` affordance opens the hint.
    const installButton = row.locator("[aria-expanded]").first();
    await expect(installButton).toBeVisible();
    await installButton.click();

    // The dropdown lists the FIRST-PARTY host-OS command (linux → apt).
    // Matching loosely: the hint string starts with the package-manager
    // command; asserting on "apt install ffmpeg" keeps the spec honest
    // about which text a user would act on.
    await expect(row.locator("text=apt install ffmpeg").first()).toBeVisible();
  });
});
