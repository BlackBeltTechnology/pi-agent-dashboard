/**
 * E2E: add-access-grants-and-review — task 8.1 (test-plan F4).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the grant store, the handle-verified predicate and the
 * aggregate the Access tab renders. None of them can show the journey an
 * operator actually takes across a REAL http server and a REAL browser: a
 * refused read offers a remedy, accepting it makes the next request succeed with
 * NO restart, the Access tab lists the grant, and revoking there makes the read
 * fail again. "Takes effect without a restart" is a property of a live process
 * across requests — invisible to jsdom.
 *
 * WHY THE GRANT IS SEEDED INSIDE THE CONTAINER
 * --------------------------------------------
 * `POST /api/access/grants` refuses any request whose socket peer is not
 * loopback (design D15) — deliberately, so a tunnelled or remote browser can
 * never widen filesystem trust. A spec driven from the host IS such a client,
 * so the grant half of the journey is executed IN the container via `docker
 * exec` (the same out-of-band pattern `byte-budget-retention` and `archive-fold`
 * use for state the REST API will not create), while every assertion an
 * OPERATOR would make is made through the browser.
 *
 * The in-container step still goes through the REAL path — trigger the refusal,
 * take its `denialId`, submit it — rather than writing the store file, so the
 * denial→grant binding is exercised end to end.
 *
 * A NON-EXISTENT probe path is used on purpose: admission shows up as a 404
 * ("not found") where refusal is a 403 ("path outside cwd"), so the two outcomes
 * are distinguishable without creating anything on disk.
 *
 * See change: add-access-grants-and-review.
 */
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Outside `FIXTURE_GIT` (so layers 1/2 refuse it) but not a forbidden subject
 * (so the remedy is grantable — `/etc` and `/` are refused by design).
 */
const PROBE = "/fixtures/__access-e2e-probe__/probe.txt";

/** Resolve the harness container by its published dashboard port. */
function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")[0];
}

/**
 * Run the LOCAL half of the journey inside the container and return what the
 * server said. `docker exec -i … node` reads the script from stdin.
 */
function seedGrantInContainer(): { deniedStatus: number; denial: any; grantStatus: number } {
  const script = `
    (async () => {
      const BASE = "http://127.0.0.1:${DASHBOARD_PORT}";
      const cwd = ${JSON.stringify(FIXTURE_GIT)};
      const probe = ${JSON.stringify(PROBE)};
      const url = BASE + "/api/file/exists?cwd=" + encodeURIComponent(cwd) +
        "&path=" + encodeURIComponent(probe);

      const denied = await fetch(url);
      const denial = await denied.json();

      const granted = await fetch(BASE + "/api/access/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ denialId: denial.denialId, subject: denial.subject }),
      });

      process.stdout.write(JSON.stringify({
        deniedStatus: denied.status,
        denial,
        grantStatus: granted.status,
        grant: await granted.json(),
      }));
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = execSync(`docker exec -i ${containerName()} node`, {
    input: script,
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const existsUrl = (p: string): string =>
  `/api/file/exists?cwd=${encodeURIComponent(FIXTURE_GIT)}&path=${encodeURIComponent(p)}`;

test.describe("access grants — grant → read → revoke round-trip", () => {
  test("8.1 / F4: a granted subject is admitted without a restart, and denied again after revoke", async ({
    page,
  }) => {
    await gotoDashboard(page);

    // Precondition, ASSERTED rather than assumed: with no grant, the probe is
    // refused by layers 1/2 and the refusal offers the remedy that binds it.
    const denied = await page.request.get(existsUrl(PROBE));
    expect(denied.status(), "probe must start refused — else the anchors widened").toBe(403);

    // Operator half, in-container (local-only binding), through the real path.
    const seeded = seedGrantInContainer();
    expect(seeded.deniedStatus, "in-container refusal").toBe(403);
    expect(typeof seeded.denial.denialId, "refusal must offer a denialId").toBe("string");
    expect(seeded.grantStatus, "the offered remedy is grantable").toBe(200);

    // The SAME read is now ADMITTED — 404, not 403 — with no restart.
    await expect
      .poll(async () => (await page.request.get(existsUrl(PROBE))).status(), {
        timeout: 15_000,
        message: "the grant must take effect on the next request, without a restart",
      })
      .toBe(404);

    // The Access tab lists the grant with its provenance, and is review-only.
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-section")).toBeVisible({ timeout: 20_000 });
    const entry = page.getByTestId("access-entry").filter({ hasText: seeded.denial.subject });
    await expect(entry.first()).toBeVisible({ timeout: 15_000 });
    await expect(entry.first().getByTestId("access-entry-scope")).toContainText("project");

    // Revoke from the surface that lists it (the only per-entry write, F5).
    await entry.first().getByTestId("access-revoke").click();

    // Denied again — still without a restart.
    await expect
      .poll(async () => (await page.request.get(existsUrl(PROBE))).status(), {
        timeout: 15_000,
        message: "revoke must take effect on the next request, without a restart",
      })
      .toBe(403);
  });
});
