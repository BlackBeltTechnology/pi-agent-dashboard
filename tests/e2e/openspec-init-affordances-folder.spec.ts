import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { expandFolder, folderCard, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — FOLDER-SECTION slice of change `add-openspec-init-affordances`.
 *
 * Covers test-plan #F1, #F2, #F3, #F12, #F13, #F14, #F15, #F16, #F17, #X9
 * (tasks 2.48–2.50, 2.59–2.65): the folder-header OpenSpec section's ABSENT
 * offer, height parity across states, init convergence, opt-out dismiss +
 * re-enable, and the two confirm-dialog flows — against the disposable docker
 * harness with a REAL `openspec` CLI spawn per init.
 *
 * Every fixture directory is pinned (the section renders for pinned dirs with
 * no sessions — `openspecMap` is keyed by cwd, broadcast by the poll service).
 * Config (`openspec.offerInitialization` / `optOutDirectories` /
 * `pollIntervalSeconds`) is snapshotted in beforeAll and restored in afterAll;
 * the poll interval is dropped to its 5s clamp for the run so out-of-band
 * `docker exec` mutations (rm -rf .pi, mkdir openspec) converge within one
 * tick. See change: add-openspec-init-affordances.
 *
 * In-container recipes (empirically verified against openspec CLI 1.6.0):
 * - BROKEN · cli-failed: `<cwd>/openspec/changes/demo/tasks.md` made a
 *   self-referential symlink. `openspec list --json` prints a `status`
 *   error array and EXITS 1 (ELOOP stat); the runner maps exit≠0 to
 *   {kind:"exit"} and the poll folds it to cli-failed. Invalid YAML in
 *   config.yaml, config.yaml as a directory, a changes/ FILE, chmod 000
 *   (server runs as root) and a changes/ symlink loop were all TOLERATED
 *   by the CLI — the ELOOP tasks.md is the only working recipe.
 * - init failure (X9): `<cwd>/openspec` as a DANGLING symlink. The server's
 *   overwrite guard `stat`s it → ENOENT → passes WITHOUT confirm, the CLI's
 *   `mkdir <cwd>/openspec` fails with exit 1 ("ENOENT ... mkdir") → the
 *   endpoint returns 500 + stderr, and readiness stays ABSENT (stat fails).
 */

const RUN = Date.now().toString(36);

/** Resolve the harness container by its published dashboard port (never 8000). */
function harnessContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no harness container on port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell snippet inside the harness container (out-of-band mutation). */
function dsh(cmd: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], {
    encoding: "utf8",
  });
}

/** Create a fresh fixture directory under /fixtures (listable by the pin
 *  dialog's PathPicker) and return its absolute container path. `prep` is a
 *  bare shell command appended after the mkdir (use DIR as the dir path). */
function makeDir(name: string, prep?: string): string {
  const dir = `/fixtures/e2e-oia-${RUN}-${name}`;
  dsh(`rm -rf ${dir} && mkdir -p ${dir}${prep ? ` && ${prep.replace(/DIR/g, dir)}` : ""}`);
  return dir;
}

/** Thin same-origin API caller in page context (REST setup, DOM asserts). */
async function api(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i ?? undefined) as RequestInit | undefined);
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    [path, init ? (JSON.parse(JSON.stringify(init)) as RequestInit) : null] as const,
  );
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as RequestInit;
}

function putJson(body: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as RequestInit;
}

interface OpenSpecSettings {
  pollIntervalSeconds: number;
  offerInitialization: boolean;
  optOutDirectories: string[];
}

async function readSettings(page: Page): Promise<OpenSpecSettings> {
  const r = await api(page, "/api/config");
  const o = ((r.body?.data as Record<string, Record<string, unknown>>)?.openspec) ?? {};
  return {
    pollIntervalSeconds: typeof o.pollIntervalSeconds === "number" ? o.pollIntervalSeconds : 60,
    offerInitialization: o.offerInitialization !== false,
    optOutDirectories: Array.isArray(o.optOutDirectories) ? (o.optOutDirectories as string[]) : [],
  };
}

/** PUT a partial `openspec` config block (server deep-merges; a full array
 *  replaces). Reconfigure applies immediately — no restart. */
async function putSettings(page: Page, partial: Partial<OpenSpecSettings>): Promise<void> {
  const r = await api(page, "/api/config", putJson({ openspec: partial }));
  expect(r.body?.success, JSON.stringify(r.body)).toBe(true);
}

/** Node-side variant for beforeAll/afterAll (no page fixture there). */
async function putSettingsNode(partial: Partial<OpenSpecSettings>): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openspec: partial }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
  if (!body?.success) throw new Error(`config PUT failed: ${JSON.stringify(body)}`);
}

/** The folder section variant for `cwd`, scoped to its folder card. */
function section(page: Page, cwd: string, variant: "" | "absent" | "broken" | "stale" | "pending"): Locator {
  const testid = variant === "" ? "folder-openspec-section" : `folder-openspec-section-${variant}`;
  return folderCard(page, cwd).getByTestId(testid).first();
}

/** Pin (if needed) and expand `cwd`'s folder card; returns the card.
 *\n *  A fresh page load briefly renders the onboarding (empty) view before the
 *  WS snapshot lands and flips the sidebar to dashboard mode — pinning
 *  mid-flip clicks a CTA that is about to detach. Settle the flip first:
 *  wait for SOME add-folder affordance, then prefer the sidebar button (only
 *  present in dashboard mode) and fall back to the CTA only when the view
 *  genuinely stayed on onboarding (empty container). */
async function pinAndExpand(page: Page, cwd: string): Promise<Locator> {
  const card = folderCard(page, cwd);
  if ((await card.count()) === 0) {
    const affordance = page
      .getByTestId("dashboard-add-folder-btn")
      .first()
      .or(page.getByTestId("onboarding-step-2-cta"));
    await expect(affordance.first()).toBeVisible({ timeout: 30_000 });
    // Give the hydration flip a beat: a landing snapshot removes the CTA and
    // may carry the pin; after the settle, pinDirectory's own affordance
    // check sees the stable state instead of a mid-flip CTA.
    await page.waitForTimeout(600);
    if ((await card.count()) === 0) await pinDirectory(page, cwd);
  }
  await expandFolder(page, cwd);
  return card;
}

/** REST-init a pinned dir (real CLI spawn in-container). */
async function initDir(page: Page, cwd: string): Promise<void> {
  const r = await api(page, "/api/openspec/init", postJson({ cwd }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body?.success).toBe(true);
}

test.describe.configure({ mode: "serial" });

let settingsSnapshot: OpenSpecSettings | null = null;

test.describe("openspec init affordances — folder section", () => {
  test.beforeAll(async () => {
    // Node-side: snapshot + normalize. Stale e2e-oia opt-out entries from a
    // crashed earlier run are purged (their dirs no longer exist). Poll
    // interval drops to the 5s clamp so out-of-band mutations converge in one
    // tick; restored in afterAll.
    const res = await fetch(`${BASE_URL}/api/config`);
    const body = (await res.json()) as { data?: { openspec?: Record<string, unknown> } };
    const o = body.data?.openspec ?? {};
    settingsSnapshot = {
      pollIntervalSeconds: typeof o.pollIntervalSeconds === "number" ? o.pollIntervalSeconds : 60,
      offerInitialization: o.offerInitialization !== false,
      optOutDirectories: (Array.isArray(o.optOutDirectories) ? (o.optOutDirectories as string[]) : [])
        .filter((d) => !d.includes("/e2e-oia-")),
    };
    await putSettingsNode({
      pollIntervalSeconds: 5,
      offerInitialization: true,
      optOutDirectories: settingsSnapshot.optOutDirectories,
    });
  });

  test.afterAll(async () => {
    // Advisory, never a verdict: restore the harness config. Fixture dirs are
    // left on disk and pinned — the container is disposable and a removed-but-
    // pinned dir would only add poll noise for later specs.
    const s = settingsSnapshot;
    if (s) {
      try {
        await putSettingsNode({
          pollIntervalSeconds: s.pollIntervalSeconds,
          offerInitialization: s.offerInitialization,
          optOutDirectories: s.optOutDirectories,
        });
      } catch {
        /* advisory */
      }
    }
  });

  test("F1 (#2.48): ABSENT + offerInitialization:true renders Initialize + dismiss, no count, no board nav", async ({ page }) => {
    test.setTimeout(90_000);
    const dir = makeDir("f1");
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);

    // The ABSENT pill renders once the poll has broadcast data for the cwd.
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("folder-openspec-initialize").first()).toBeVisible();
    await expect(card.getByTestId("folder-openspec-dismiss").first()).toBeVisible();
    await expect(card.getByTestId("folder-openspec-state").first()).toHaveText(/not set up/i);

    // No change count and no navigation affordance to the board.
    await expect(card.getByTestId("folder-openspec-count")).toHaveCount(0);
    await expect(card.getByTestId("folder-openspec-open-board")).toHaveCount(0);
  });

  test("F2 (#2.49): offerInitialization:false suppresses the ABSENT offer — and only it", async ({ page }) => {
    test.setTimeout(90_000);
    const absent = makeDir("f2");
    const broken = makeDir("f2-broken", "mkdir -p DIR/openspec"); // missing-changes-dir

    // App hydrates `offerInitialization` ONCE on mount (App.tsx useEffect []);
    // a config PUT does not live-update an open page, so the switch is applied
    // BEFORE the page load. (Product gap, reported: flipping the switch in
    // Settings leaves live pages showing the suppressed offer until reload.)
    await gotoDashboard(page); // a loaded origin for the page-context PUT
    await putSettings(page, { offerInitialization: false });
    await page.reload();
    await pinAndExpand(page, absent);
    await pinAndExpand(page, broken);

    // Control — the switch suppresses ONLY the offer: a BROKEN dir in the
    // same fleet, same page, still renders its section. This also proves the
    // page is hydrated with broadcast data, so the absent-count below cannot
    // pass vacuously on a missing-data page. (A second product gap, reported:
    // the connect snapshot omits `readiness` for non-initialized cwds and the
    // poll dedupes unchanged broadcasts — so after a reload an ABSENT dir
    // cannot render its offer even with the switch ON. Controlling against a
    // BROKEN dir avoids depending on that broken path.)
    await expect(section(page, broken, "broken")).toBeVisible({ timeout: 30_000 });

    // Suppressed: no ABSENT offer section, no Initialize control.
    await expect(section(page, absent, "absent")).toHaveCount(0);
    await expect(folderCard(page, absent).getByTestId("folder-openspec-initialize")).toHaveCount(0);

    // Restore for later scenarios (fresh mounts re-hydrate true).
    await putSettings(page, { offerInitialization: true });
  });

  test("F3 (#2.50): ABSENT / BROKEN / STALE / READY section heights all match the READY pill (±2px)", async ({ page }) => {
    test.setTimeout(150_000);
    const absent = makeDir("f3-absent");
    const broken = makeDir("f3-broken", "mkdir -p DIR/openspec"); // missing-changes-dir
    const ready = makeDir("f3-ready");
    const stale = makeDir("f3-stale");

    await gotoDashboard(page);
    await pinAndExpand(page, absent);
    await pinAndExpand(page, broken);
    await pinAndExpand(page, ready);
    await pinAndExpand(page, stale);

    // READY reference + STALE victim: init both (real CLI), then strip the
    // stale dir's skills out-of-band. The skills change lands on the NEXT poll
    // tick (config writes only re-broadcast readiness-affecting keys).
    await initDir(page, ready);
    await initDir(page, stale);
    dsh(`rm -rf ${stale}/.pi`);

    await expect(section(page, absent, "absent")).toBeVisible({ timeout: 30_000 });
    await expect(section(page, broken, "broken")).toBeVisible({ timeout: 30_000 });
    await expect(section(page, ready, "")).toBeVisible({ timeout: 30_000 });
    await expect(section(page, stale, "stale")).toBeVisible({ timeout: 30_000 });
    // missing-skills specifically — NOT profile-stale (both are STALE pills).
    await expect(folderCard(page, stale).getByTestId("folder-openspec-state").first())
      .toHaveText(/skills missing/i, { timeout: 30_000 });

    const height = async (cwd: string, variant: "" | "absent" | "broken" | "stale") => {
      const box = await section(page, cwd, variant).boundingBox();
      expect(box, `section for ${cwd} must have a layout box`).not.toBeNull();
      return box!.height;
    };
    const readyHeight = await height(ready, "");
    for (const [cwd, variant] of [
      [absent, "absent"],
      [broken, "broken"],
      [stale, "stale"],
    ] as const) {
      const h = await height(cwd, variant);
      expect(Math.abs(h - readyHeight)).toBeLessThanOrEqual(2);
    }
  });

  test("F12 (#2.59): Initialize on ABSENT converges straight to the READY pill with a count", async ({ page }) => {
    test.setTimeout(150_000);
    const dir = makeDir("f12");
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });

    // Sample continuously across the whole convergence window: the BROKEN
    // (disabled) variant must NEVER appear while the init broadcast lands.
    // A converged end-state check alone would pass against a transient flip.
    let sampling = true;
    const brokenSeen: number[] = [];
    const sampler = (async () => {
      while (sampling) {
        brokenSeen.push(await card.getByTestId("folder-openspec-section-broken").count());
        await page.waitForTimeout(120);
      }
    })();

    await card.getByTestId("folder-openspec-initialize").first().click();

    // Real CLI spawn in-container; the forced post-init refresh broadcasts the
    // new READY state without waiting for a poll tick.
    await expect(card.getByTestId("folder-openspec-count").first()).toBeVisible({ timeout: 90_000 });
    await expect(section(page, dir, "absent")).toHaveCount(0);
    await expect(card.getByTestId("folder-openspec-count").first()).toHaveText("0");

    sampling = false;
    await sampler;
    expect(brokenSeen.length).toBeGreaterThan(0);
    expect(brokenSeen.filter((n) => n > 0)).toEqual([]);
  });

  test("F13 (#2.60): dismiss stops the section rendering and persists the cwd in optOutDirectories", async ({ page }) => {
    test.setTimeout(90_000);
    const dir = makeDir("f13");
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });

    await card.getByTestId("folder-openspec-dismiss").first().click();

    // Readiness re-broadcast (OPTED_OUT) unmounts the section…
    await expect(section(page, dir, "absent")).toHaveCount(0, { timeout: 15_000 });

    // …and the opt-out is persisted server-side.
    const settings = await readSettings(page);
    expect(settings.optOutDirectories).toContain(dir);
  });

  test("F14 (#2.61): re-enabling an opted-out folder from the actions menu restores the section", async ({ page }) => {
    test.setTimeout(90_000);
    const dir = makeDir("f14");
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);

    // Self-seeded opt-out (read-modify-write, idempotent) — independent of F13.
    const current = await readSettings(page);
    if (!current.optOutDirectories.includes(dir)) {
      await putSettings(page, { optOutDirectories: [...current.optOutDirectories, dir] });
    }
    // Control: opted out ⇒ no section.
    await expect(section(page, dir, "absent")).toHaveCount(0, { timeout: 15_000 });

    await card.getByTestId(`folder-actions-menu-${dir}`).first().click();
    const item = page.getByTestId("folder-menu-item-openspec-reenable");
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();

    // Section renders again (ABSENT offer restored)…
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });
    // …and the opt-out entry is gone server-side.
    const after = await readSettings(page);
    expect(after.optOutDirectories).not.toContain(dir);
  });

  test("F15 (#2.62): BROKEN · cli-failed shows the error, no Repair and no Initialize", async ({ page }) => {
    test.setTimeout(90_000);
    // Working recipe (see header): a change whose tasks.md is a self-
    // referential symlink makes `openspec list --json` exit 1 (ELOOP).
    const dir = makeDir(
      "f15",
      "mkdir -p DIR/openspec/changes/demo && ln -s DIR/openspec/changes/demo/tasks.md DIR/openspec/changes/demo/tasks.md",
    );
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);

    await expect(section(page, dir, "broken")).toBeVisible({ timeout: 30_000 });
    // The error is surfaced as the section's state label.
    await expect(card.getByTestId("folder-openspec-state").first()).toHaveText(/OpenSpec command failed/i);
    // No destructive action for a failing CLI (D9): neither Repair nor
    // Initialize may be present.
    await expect(card.getByTestId("folder-openspec-repair")).toHaveCount(0);
    await expect(card.getByTestId("folder-openspec-initialize")).toHaveCount(0);
  });

  test("F16 (#2.63): Repair confirm names the directory; dismissing it sends no init request", async ({ page }) => {
    test.setTimeout(90_000);
    const dir = makeDir("f16", "mkdir -p DIR/openspec"); // missing-changes-dir
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);

    await expect(section(page, dir, "broken")).toBeVisible({ timeout: 30_000 });
    const repair = card.getByTestId("folder-openspec-repair").first();
    await expect(repair).toBeVisible();

    const initBodies: unknown[] = [];
    await page.route("**/api/openspec/init", async (route) => {
      initBodies.push(route.request().postDataJSON());
      await route.continue();
    });

    await repair.click();

    // The confirmation names the directory BEFORE any request is sent — the
    // dialog's presence here is the proof the click was registered, so the
    // zero-request assertion below cannot pass vacuously.
    const confirm = page.getByTestId("openspec-repair-confirm");
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await expect(confirm).toContainText(dir);
    expect(initBodies).toEqual([]);

    await page.getByTestId("openspec-repair-cancel").click();
    await expect(confirm).toHaveCount(0);
    // Dismissal sends nothing — wait long enough to catch a late fire.
    await page.waitForTimeout(1_500);
    expect(initBodies).toEqual([]);

    await page.unroute("**/api/openspec/init");
  });

  test("F17 (#2.64): Initialize over an existing openspec/ dir requires a confirm carrying confirm:true", async ({ page }) => {
    test.setTimeout(120_000);
    const dir = makeDir("f17");
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });

    // Freeze the poll (interval 600s, no readiness-affecting key touched ⇒ no
    // re-broadcast) so creating openspec/ out-of-band does NOT flip the UI to
    // BROKEN before the Initialize click — the section stays ABSENT while the
    // server's overwrite guard sees the directory.
    await putSettings(page, { pollIntervalSeconds: 600 });
    await page.waitForTimeout(1_000); // let any in-flight tick settle
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 10_000 });
    dsh(`mkdir -p ${dir}/openspec`);

    const initBodies: Array<Record<string, unknown>> = [];
    let first = true;
    await page.route("**/api/openspec/init", async (route) => {
      initBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      if (first) {
        first = false;
        await route.continue(); // the unconfirmed probe → server 400
      } else {
        await route.abort(); // capture the confirmed request, skip the spawn
      }
    });

    await card.getByTestId("folder-openspec-initialize").first().click();

    // The server refuses the unconfirmed request; the client surfaces the
    // confirmation naming the directory BEFORE any confirmed request goes out.
    const confirm = page.getByTestId("openspec-init-over-confirm");
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await expect(confirm).toContainText(dir);
    expect(initBodies.length).toBe(1);
    expect(initBodies[0]?.confirm).not.toBe(true); // the probe carried no flag

    await page.getByTestId("openspec-init-over-confirm-action").click();
    await expect
      .poll(() => initBodies.length, { timeout: 15_000 })
      .toBe(2);
    expect(initBodies[1]).toMatchObject({ cwd: dir, confirm: true });

    await page.unroute("**/api/openspec/init");
    await putSettings(page, { pollIntervalSeconds: 5 });
  });

  test("X9 (#2.65): init failure surfaces the CLI stderr and leaves the section ABSENT", async ({ page }) => {
    test.setTimeout(120_000);
    // Working recipe (see header): a DANGLING openspec symlink — the server's
    // guard `stat` passes without confirm, the CLI's mkdir fails exit 1 with
    // an ENOENT stderr, and readiness stays ABSENT.
    const dir = makeDir("x9");
    dsh(`ln -s /nonexistent/e2e-oia-x9-${RUN} ${dir}/openspec`);
    await gotoDashboard(page);
    const card = await pinAndExpand(page, dir);
    await expect(section(page, dir, "absent")).toBeVisible({ timeout: 30_000 });

    // The toast auto-dismisses after 3s — observe from the click onward.
    const failedToast = page.waitForSelector("text=/OpenSpec init failed/i", { timeout: 45_000 });
    await card.getByTestId("folder-openspec-initialize").first().click();
    await failedToast;

    const toastText =
      (await page.locator("span").filter({ hasText: /OpenSpec init failed/i }).first().textContent()) ?? "";
    // The CLI's failure is surfaced: the exit-code message AND the stderr line.
    expect(toastText).toMatch(/exited with code/i);
    expect(toastText).toMatch(/ENOENT/i);

    // The section stays in its previous state — no success, no READY pill.
    await expect(section(page, dir, "absent")).toBeVisible();
    await expect(section(page, dir, "")).toHaveCount(0);
    await expect(card.getByTestId("folder-openspec-count")).toHaveCount(0);
  });
});
