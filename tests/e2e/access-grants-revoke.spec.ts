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
 * Unlike a status-code probe, the probe path EXISTS: `isGrantAdmitted` realpaths
 * the request, so a path that does not exist can never be admitted and would
 * refuse for the wrong reason. The file is created inside the container by the
 * same out-of-band step, and admission then reads as a plain 200 `{exists:true}`
 * against a 403 `path outside cwd` before it.
 *
 * See change: add-access-grants-and-review.
 *
 * The final describe (#S57, fix-file-link-editor-routing) covers per-mode revoke: a directory holding BOTH a
 * read grant and a write grant lists two rows (the write one badged "Write"); revoking the write row leaves
 * the read grant (a read still loads with no prompt) and a save prompts for write again.
 */
import { execSync } from "node:child_process";
import { expect, narrowTrust, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
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
function seedGrantInContainer(): {
  deniedStatus: number;
  denial: any;
  grantStatus: number;
  grant: any;
} {
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

/**
 * Materialise the probe INSIDE the container. It must exist: `isGrantAdmitted`
 * realpaths the request, so a missing path is refused by the predicate itself
 * and admission could never be observed.
 */
function createProbeInContainer(): void {
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    const probe = ${JSON.stringify(PROBE)};
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "e2e probe\\n");
    process.stdout.write("ok");
  `;
  execSync(`docker exec -i ${containerName()} node`, { input: script, stdio: ["pipe", "ignore", "inherit"] });
}

const existsUrl = (p: string): string =>
  `/api/file/exists?cwd=${encodeURIComponent(FIXTURE_GIT)}&path=${encodeURIComponent(p)}`;

test.describe("access grants — grant → read → revoke round-trip", () => {
  test("8.1 / F4: a granted subject is admitted without a restart, and denied again after revoke", async ({
    page,
  }) => {
    // A REAL session rooted at the fixture is required first: containment gates
    // on a KNOWN session cwd, and an unknown one refuses with `"unknown cwd"` —
    // a 403 that carries NO `denialId`, so the remedy the journey depends on is
    // never offered. (That is exactly how the first harness run failed.)
    await ensureGitSession(page);
    createProbeInContainer();

    // Precondition, ASSERTED rather than assumed: with no grant, the probe EXISTS
    // and is still refused by layers 1/2, and the refusal offers the remedy that
    // binds the grant.
    const denied = await page.request.get(existsUrl(PROBE));
    expect(denied.status(), "probe must start refused — else the anchors widened").toBe(403);
    expect(
      typeof (await denied.json()).denialId,
      "the refusal must be a CONTAINMENT refusal (it offers a denialId), not an unknown-cwd one",
    ).toBe("string");

    // Operator half, in-container (local-only binding), through the real path.
    const seeded = seedGrantInContainer();
    expect(seeded.deniedStatus, "in-container refusal").toBe(403);
    expect(
      typeof seeded.denial.denialId,
      `refusal must offer a denialId — got ${JSON.stringify(seeded.denial)}`,
    ).toBe("string");
    expect(seeded.grantStatus, `the offered remedy is grantable — got ${JSON.stringify(seeded.grant)}`).toBe(
      200,
    );

    // The SAME read is now ADMITTED — a plain 200 with the file present — with
    // no restart.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(existsUrl(PROBE));
          return `${r.status()}:${JSON.stringify(await r.json().catch(() => null))}`;
        },
        { timeout: 15_000, message: "the grant must take effect on the next request, without a restart" },
      )
      .toBe('200:{"success":true,"data":{"exists":true}}');

    // The Access tab lists the grant with its provenance, and is review-only.
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-section")).toBeVisible({ timeout: 20_000 });
    const entry = page.getByTestId("access-entry").filter({ hasText: seeded.denial.subject });
    await expect(entry.first()).toBeVisible({ timeout: 15_000 });
    await expect(entry.first().getByTestId("access-entry-scope")).toContainText("Project");

    // Revoke from the surface that lists it (the only per-entry write, F5).
    await entry.first().getByTestId("access-revoke").click();

    // POSITIVE evidence the revoke landed. Without this, a revoke that silently
    // failed would leave the read refused and the assertion below would pass for
    // the WRONG reason — the failure mode this whole journey exists to catch.
    await expect(entry).toHaveCount(0, { timeout: 15_000 });

    // Denied again — still without a restart.
    await expect
      .poll(async () => (await page.request.get(existsUrl(PROBE))).status(), {
        timeout: 15_000,
        message: "revoke must take effect on the next request, without a restart",
      })
      .toBe(403);
  });
});

// #S57 — write-mode grant: listed with a "Write" badge, revoked on its own, read grant survives.
test.describe.serial("write-mode grant — per-mode revoke (fix-file-link-editor-routing)", () => {
  const DIR = "/fixtures/__grant-e2e__/lk-revoke";
  const FILE = `${DIR}/doc.md`;
  const CONFIG = "/home/pi/.pi/dashboard/config.json";
  const STORES = [CONFIG, "/home/pi/.pi/dashboard/access-grants.json", "/home/pi/.pi/dashboard/access-refusals.json"];
  let saved: Record<string, string | null> = {};

  const inContainer = (script: string): string =>
    execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });

  test.beforeAll(async ({ request }) => {
    saved = JSON.parse(
      inContainer(`
        const fs = require("node:fs");
        const out = {};
        for (const p of ${JSON.stringify(STORES)}) out[p] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
        process.stdout.write(JSON.stringify(out));
      `),
    );
    // Write prompts need hostGate=enforce + promptEnabled (same setup as access-grant-dialog.spec.ts).
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    inContainer(`
      const fs = require("node:fs");
      const c = JSON.parse(fs.readFileSync(${JSON.stringify(CONFIG)}, "utf8"));
      c.accessGrants = { ...(c.accessGrants ?? {}), promptEnabled: true };
      fs.writeFileSync(${JSON.stringify(CONFIG)} + ".e2e.tmp", JSON.stringify(c, null, 2));
      fs.renameSync(${JSON.stringify(CONFIG)} + ".e2e.tmp", ${JSON.stringify(CONFIG)});
    `);
  });

  test.afterAll(() => {
    inContainer(`
      const fs = require("node:fs");
      const saved = ${JSON.stringify(saved)};
      for (const [p, body] of Object.entries(saved)) {
        if (body === null) { try { fs.unlinkSync(p); } catch {} }
        else { fs.writeFileSync(p + ".e2e.tmp", body); fs.renameSync(p + ".e2e.tmp", p); }
      }
      fs.rmSync(${JSON.stringify(DIR)}, { recursive: true, force: true });
    `);
  });

  /**
   * Operator half, in the container (grant creation is loopback-only, D15), through the REAL denial→grant
   * binding: a read refusal then a write refusal, each submitted to `POST /api/access/grants`. The server
   * takes the grant's mode from the denial it recorded, never from the request.
   */
  function seedReadAndWriteGrants(): { readStatus: number; writeStatus: number } {
    return JSON.parse(
      inContainer(`
        (async () => {
          const fs = require("node:fs");
          fs.mkdirSync(${JSON.stringify(DIR)}, { recursive: true });
          fs.writeFileSync(${JSON.stringify(FILE)}, "# outside\\nREVOKE-MARKER\\n");
          const BASE = "http://127.0.0.1:${DASHBOARD_PORT}";
          const cwd = ${JSON.stringify(FIXTURE_GIT)};
          const grant = async (denied) => {
            const d = await denied.json();
            const r = await fetch(BASE + "/api/access/grants", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ denialId: d.denialId, subject: d.subject }),
            });
            return r.status;
          };
          const readStatus = await grant(await fetch(BASE + "/api/file/exists?cwd=" + encodeURIComponent(cwd) + "&path=" + encodeURIComponent(${JSON.stringify(FILE)})));
          const writeStatus = await grant(await fetch(BASE + "/api/file/write", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd, path: ${JSON.stringify(FILE)}, content: "x", mtime: 0 }),
          }));
          process.stdout.write(JSON.stringify({ readStatus, writeStatus }));
        })().catch((e) => { console.error(e); process.exit(1); });
      `),
    );
  }

  const writeStatusFromContainer = (): number =>
    Number(
      inContainer(`
        fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/file/write", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: ${JSON.stringify(FIXTURE_GIT)}, path: ${JSON.stringify(FILE)}, content: "probe", mtime: 0 }),
        }).then((r) => process.stdout.write(String(r.status)));
      `),
    );

  test("S57: Write row is badged, revoking it keeps the read grant; read loads unprompted, save prompts again", async ({
    page,
  }) => {
    await ensureGitSession(page);
    const seeded = seedReadAndWriteGrants();
    expect(seeded.readStatus, "read remedy grantable").toBe(200);
    expect(seeded.writeStatus, "write remedy grantable").toBe(200);

    // The write grant admits a write (stale mtime 0 -> 409 AFTER the gate, not 403).
    expect(writeStatusFromContainer(), "write grant admits the save past the gate").toBe(409);

    await page.goto("/settings/access");
    await expect(page.getByTestId("access-section")).toBeVisible({ timeout: 20_000 });
    const rows = page.getByTestId("access-entry").filter({ hasText: DIR });
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    const writeRow = rows.filter({ has: page.getByTestId("access-entry-mode-write") });
    const readRow = rows.filter({ hasNot: page.getByTestId("access-entry-mode-write") });
    await expect(writeRow).toHaveCount(1);
    await expect(writeRow.getByTestId("access-entry-mode-write")).toHaveText("Write");
    await expect(readRow).toHaveCount(1);

    await writeRow.getByTestId("access-revoke").click();
    await expect(writeRow).toHaveCount(0, { timeout: 15_000 });
    await expect(readRow).toHaveCount(1); // the read grant survives

    // Read still admitted with no prompt; a write is refused past the gate again.
    const read = await page.request.get(
      `/api/file/exists?cwd=${encodeURIComponent(FIXTURE_GIT)}&path=${encodeURIComponent(FILE)}`,
    );
    expect(read.status()).toBe(200);
    expect(writeStatusFromContainer(), "revoked write grant no longer admits a save").toBe(403);

    // UI: reopen the file via its link - loads without any prompt - and save: the WRITE prompt is back.
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:text-outside-links]] go");
    await page.getByText(FILE, { exact: true }).first().click();
    await expect(page.getByText("REVOKE-MARKER")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await page.getByTestId("md-edit-toggle").click();
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.type("AFTER-REVOKE");
    await page.getByTestId("md-save-btn").click();
    await expect(page.getByTestId("grant-dialog")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("grant-dialog")).toContainText("A write was blocked");
    await page.getByTestId("grant-dialog").getByTestId("grant-deny").click();
  });
});
