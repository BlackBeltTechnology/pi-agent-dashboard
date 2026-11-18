/**
 * E2E: credential directories in the grant store and the remote folder picker
 * (change: harden-agent-tool-guards, test-plan #F6 / #F7; T.103, T.104).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the store reader (rejected rows preserved, now-forbidden subjects not admitted) and the
 * browse-roots list. Only a real server + real browser proves what an operator sees: an
 * older-build store holding `~/.aws` lists only the admitted grant on Settings ▸ Access, and
 * revoking it through the UI leaves the `~/.aws` row in the file on disk (never silently
 * dropped); and a REMOTE caller browsing `$HOME/.aws` or a browser profile is refused while an
 * ordinary `$HOME/.config/app` still lists.
 *
 * The store is seeded INSIDE the container (the grants route refuses non-loopback peers and
 * would also refuse `~/.aws`), the same out-of-band pattern as access-grants-revoke.spec.ts.
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI / ship-it.
 */
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const STORE = "/home/pi/.pi/dashboard/access-grants.json";
const AWS = "/home/pi/.aws";
const OTHER = "/fixtures/__cred-dirs-e2e__/other";

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}
function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

test.describe("credential directories (L3)", () => {
  test("#F6 an older-build store with ~/.aws lists only the admitted grant; revoke keeps the ~/.aws row on disk", async ({
    page,
  }) => {
    inContainer(`
      const fs = require("node:fs");
      fs.mkdirSync(${JSON.stringify(OTHER)}, { recursive: true });
      const row = (subject) => ({ subject, scope: "project", grantedAt: Date.now(), origin: "e2e" });
      fs.mkdirSync(require("node:path").dirname(${JSON.stringify(STORE)}), { recursive: true });
      fs.writeFileSync(${JSON.stringify(STORE)}, JSON.stringify({ version: 1, grants: [row(${JSON.stringify(AWS)}), row(${JSON.stringify(OTHER)})] }));
    `);
    try {
      await gotoDashboard(page);
      await page.goto("/settings/access");
      await expect(page.getByTestId("access-section")).toBeVisible({ timeout: 20_000 });
      const other = page.getByTestId("access-entry").filter({ hasText: OTHER });
      await expect(other.first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("access-entry").filter({ hasText: "/.aws" })).toHaveCount(0);

      await other.first().getByTestId("access-revoke").click();
      await expect(other).toHaveCount(0, { timeout: 15_000 });

      // The refused row survives the rewrite: POSITIVE evidence read from the file itself.
      const onDisk = JSON.parse(inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(STORE)}, "utf8"))`)) as {
        grants: Array<{ subject: string }>;
      };
      expect(onDisk.grants.map((g) => g.subject)).toEqual([AWS]);
    } finally {
      inContainer(`require("node:fs").rmSync(${JSON.stringify(STORE)}, { force: true })`);
    }
  });
});

// Variant harness: remote-peer confinement is opt-in (see remote-browse-confinement.spec.ts).
test.describe("remote folder browse (L3)", () => {
  test.skip(
    process.env.PI_E2E_BROWSE_CONFINEMENT !== "1",
    "variant harness: PI_E2E_BROWSE_CONFINEMENT=1 (e2e-bounds-variants CI leg)",
  );

  test("#F7 $HOME/.aws and a browser profile are refused; $HOME/.config/app lists", async ({ page }) => {
    const probe = await page.request.get("/api/browse?path=%2F");
    test.skip(probe.status() !== 403, "harness peer is classified local: confinement does not apply");

    inContainer(`
      const fs = require("node:fs");
      for (const d of ["/home/pi/.aws", "/home/pi/.config/google-chrome/Default", "/home/pi/.config/app"]) fs.mkdirSync(d, { recursive: true });
    `);
    const status = async (p: string) => (await page.request.get(`/api/browse?path=${encodeURIComponent(p)}`)).status();
    expect(await status("/home/pi/.aws")).toBe(403);
    expect(await status("/home/pi/.config/google-chrome/Default")).toBe(403);
    expect(await status("/home/pi/.config/app")).toBe(200);
  });
});
