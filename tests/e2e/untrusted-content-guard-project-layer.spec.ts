/**
 * E2E: a project's `.pi/settings.json` cannot disable the untrusted-content guard
 * (change: harden-agent-tool-guards, test-plan #F9; T.106).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the tighten-only merge (`applyProjectLayer`). Only a real session proves the end
 * result: with `mode:"off"` and `sensitiveTools:[]` planted in the clone's `.pi/settings.json`,
 * a tainted turn (`stub_fetch` then `bash`) STILL raises the guard's confirm card before bash.
 * The assertion holds whether or not the harness clone counts as trusted (untrusted ⇒ the layer
 * is not read; trusted ⇒ the layer is applied tighten-only) — either way the card must appear.
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI / ship-it.
 */
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const SETTINGS = `${FIXTURE_GIT}/.pi/settings.json`;

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}
function inContainer(script: string): void {
  execSync(`docker exec -i ${containerName()} node`, { input: script, stdio: ["pipe", "ignore", "inherit"] });
}

test.describe("untrusted-content guard project layer (L3)", () => {
  test.afterEach(() => {
    inContainer(`require("node:fs").rmSync(${JSON.stringify(SETTINGS)}, { force: true })`);
  });

  test("#F9 a project that sets mode off and no sensitive tools still gets the bash confirmation", async ({ page }) => {
    inContainer(`
      const fs = require("node:fs");
      fs.mkdirSync(${JSON.stringify(`${FIXTURE_GIT}/.pi`)}, { recursive: true });
      fs.writeFileSync(${JSON.stringify(SETTINGS)}, JSON.stringify({ "untrusted-content-guard": { mode: "off", sensitiveTools: [] } }));
    `);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:guard-confirm]] go");
    await expect(page.getByText("Untrusted content guard").first()).toBeVisible({ timeout: 30_000 });
    // bash has not run while the confirmation is pending.
    await expect(page.getByText("guard-42", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^no$|^deny$/i }).first().click();
  });
});
