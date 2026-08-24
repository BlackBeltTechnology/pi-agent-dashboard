import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the Settings → General "Pi runtime" picker
 * (change: select-pi-runtime-install). Covers test-plan rows F1–F17 and X13.
 *
 * These live at L3 rather than in a jsdom component test because every row is
 * a CONVERGENCE property of the rendered app: the sync checkbox, the
 * divergence banner and the two lanes must agree AFTER a real fetch, a real
 * click and (for F9/F10) a real POST round-trip. A component test can only
 * assert a render given a prop.
 *
 * `/api/pi/installs` is stubbed by MERGING a candidate set into the real
 * response shape rather than replacing the whole panel's data: several of these
 * states (two installs at different versions, a below-floor candidate, a
 * candidate whose package.json cannot be read) are UNPRODUCIBLE on a real
 * harness host, and a server-side fixture tree would only move the same
 * fabrication behind an env var for the rows that are pure render logic. The
 * server-side seam (`PI_DASHBOARD_PI_FIXTURE_DIR`) exists for the rows that
 * must exercise the real enumerator; it is asserted at L1.
 *
 * The harness port comes from the Playwright baseURL, derived by
 * docker/test-up.sh into .pi-test-harness.json — never hardcoded.
 */

interface Candidate {
  key: string;
  label: string;
  pkgDir: string | null;
  spawnEntry: string | null;
  moduleEntry: string | null;
  version: string | null;
  meetsFloor?: boolean;
  floorUnknown?: boolean;
  readOnly?: boolean;
  usedBy?: { spawn: boolean; module: boolean };
}

function install(key: string, version: string | null, dir: string): Candidate {
  return {
    key,
    label: key,
    pkgDir: dir,
    spawnEntry: `${dir}/dist/cli.js`,
    moduleEntry: `${dir}/dist/index.js`,
    version,
    meetsFloor: true,
    floorUnknown: version === null,
    readOnly: false,
    usedBy: { spawn: false, module: false },
  };
}

const A = install("managed", "0.84.1", "/opt/pi-a");
const B = install("repo-root", "0.83.0", "/opt/pi-b");

interface StubState {
  installs: Candidate[];
  spawnKey: string | null;
  moduleKey: string | null;
  spawnPinned?: boolean;
  modulePinned?: boolean;
  floor?: string;
}

/** Mirror the server's row shape, defaults included. */
function buildRow(c: Candidate, s: StubState) {
  return {
    ...c,
    meetsFloor: c.meetsFloor ?? true,
    floorUnknown: c.floorUnknown ?? false,
    readOnly: c.readOnly ?? false,
    usedBy: { spawn: c.key === s.spawnKey, module: c.key === s.moduleKey },
  };
}

/** Mirror the server's per-consumer state for one column. */
function buildConsumer(
  c: Candidate | null,
  entry: "spawnEntry" | "moduleEntry",
  pinned: boolean,
) {
  return {
    path: c?.[entry] ?? null,
    pkgDir: c?.pkgDir ?? null,
    version: c?.version ?? null,
    candidateKey: c?.key ?? null,
    pinned,
  };
}

function buildBody(s: StubState) {
  const find = (k: string | null) => s.installs.find((i) => i.key === k) ?? null;
  const spawn = find(s.spawnKey);
  const module = find(s.moduleKey);
  // Same two predicates the server computes, on the same axes: sync is
  // package-DIRECTORY equality, and divergence requires KNOWING both sides.
  const inSync = Boolean(spawn && module && spawn.pkgDir === module.pkgDir);
  const consumerDiverged = Boolean(spawn?.pkgDir && module?.pkgDir) && !inSync;
  const versions = [...new Set(s.installs.map((i) => i.version).filter(Boolean))];
  return {
    installs: s.installs.map((i) => buildRow(i, s)),
    spawn: buildConsumer(spawn, "spawnEntry", s.spawnPinned ?? false),
    module: buildConsumer(module, "moduleEntry", s.modulePinned ?? false),
    inSync,
    consumerDiverged,
    divergenceMessage: consumerDiverged
      ? `pi runtime mismatch: sessions spawn pi ${spawn?.version ?? "unknown"} while the server imports pi ${module?.version ?? "unknown"}.`
      : null,
    installSetDiverged: versions.length > 1,
    installSetVersions: versions,
    floor: s.floor ?? "0.78.0",
  };
}

/** Install BEFORE navigation — the section fetches on mount. */
async function stubInstalls(page: Page, state: StubState | { status: number }) {
  await page.route("**/api/pi/installs", async (route) => {
    if ("status" in state) {
      await route.fulfill({
        status: state.status,
        json: { success: false, error: "boom" },
      });
      return;
    }
    await route.fulfill({ json: { success: true, data: buildBody(state) } });
  });
}

/** Capture the selection POST and answer with the resulting state. */
async function stubRuntimePost(page: Page, next: StubState) {
  const seen: Array<Record<string, unknown>> = [];
  await page.route("**/api/pi/runtime", async (route) => {
    seen.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { success: true, data: buildBody(next) } });
  });
  return seen;
}

async function stubSessions(
  page: Page,
  sessions: Array<{ piVersion?: string }>,
) {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { success: true, data: { sessions } } });
  });
}

// The picker sits on Settings → Developer, directly above the Tools section:
// `<ToolsSection />` moved out of General in a later change, and the design's
// adjacency rationale (picker = curated front door, Tools = raw escape hatch,
// same underlying tool-overrides.json) is what places them together.
async function openDeveloper(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: "Developer", exact: true })
    .click();
  await expect(page.getByTestId("settings-content")).toBeVisible();
}

async function openPicker(page: Page) {
  await openDeveloper(page);
  const section = page.getByTestId("pi-runtime-section");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: 20_000 });
  return section;
}

const sync = (page: Page) => page.getByTestId("pi-keep-in-sync");
const banner = (page: Page) => page.getByTestId("pi-divergence-banner");
const spawnLane = (page: Page) => page.getByTestId("pi-lane-spawn");
const importLane = (page: Page) => page.getByTestId("pi-lane-import");

test.describe("pi runtime picker", () => {
  // test-plan #F1
  test("F1: sync is checked by default when both chains resolve to one install", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    await expect(sync(page)).toBeChecked();
    await expect(spawnLane(page)).toContainText("0.84.1");
    await expect(importLane(page)).toContainText("0.84.1");
    await expect(banner(page)).toHaveCount(0);
  });

  // test-plan #F2 — never configured, but the two chains disagree.
  test("F2: unconfigured chains that disagree open unchecked and surface divergence", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "repo-root" });
    await openPicker(page);
    await expect(sync(page)).not.toBeChecked();
    await expect(banner(page)).toBeVisible();
  });

  // test-plan #F3 — a pre-existing single-consumer pin must NOT be clobbered on open.
  test("F3: a pi-only override opens diverged, names both versions, and is not overwritten", async ({ page }) => {
    const seen = await stubRuntimePost(page, {
      installs: [A, B],
      spawnKey: "managed",
      moduleKey: "repo-root",
    });
    await stubInstalls(page, {
      installs: [A, B],
      spawnKey: "managed",
      moduleKey: "repo-root",
      spawnPinned: true,
      modulePinned: false,
    });
    await openPicker(page);
    await expect(sync(page)).not.toBeChecked();
    await expect(banner(page)).toContainText("0.84.1");
    await expect(banner(page)).toContainText("0.83.0");
    // Opening the section writes NOTHING.
    expect(seen).toHaveLength(0);
  });

  // test-plan #F4
  test("F4: while linked, one click sets both lanes", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    await expect(sync(page)).toBeChecked();
    await page.getByTestId("pi-row-repo-root-spawn").click();
    await expect(page.getByTestId("pi-row-repo-root-spawn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("pi-row-repo-root-import")).toHaveAttribute("aria-pressed", "true");
  });

  // test-plan #F5 — the illegal edge: divergence cannot be created while linked.
  test("F5: no reachable action produces differing lanes while linked", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    for (const cell of ["pi-row-repo-root-import", "pi-row-managed-spawn", "pi-row-repo-root-spawn"]) {
      await page.getByTestId(cell).click();
      const spawnOn = await page.getByTestId("pi-row-repo-root-spawn").getAttribute("aria-pressed");
      const importOn = await page.getByTestId("pi-row-repo-root-import").getAttribute("aria-pressed");
      expect(spawnOn).toBe(importOn);
    }
  });

  // test-plan #F6
  test("F6: unlinked, a spawn-only selection leaves the import column alone", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    await sync(page).uncheck();
    await page.getByTestId("pi-row-repo-root-spawn").click();
    await expect(page.getByTestId("pi-row-repo-root-spawn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("pi-row-repo-root-import")).toHaveAttribute("aria-pressed", "false");
  });

  // test-plan #F7
  test("F7: an unknown-version row warns and stays selectable", async ({ page }) => {
    const unknown = { ...install("npm-global", null, "/opt/pi-x"), floorUnknown: true };
    await stubInstalls(page, { installs: [A, unknown], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    await expect(page.getByTestId("pi-row-npm-global-unknown-version")).toBeVisible();
    await expect(page.getByTestId("pi-row-npm-global-spawn")).toBeEnabled();
  });

  // test-plan #F8
  test("F8: a below-floor row is disabled, names the minimum, and changes nothing", async ({ page }) => {
    const old = { ...install("npm-global", "0.70.0", "/opt/pi-old"), meetsFloor: false };
    await stubInstalls(page, {
      installs: [A, old],
      spawnKey: "managed",
      moduleKey: "managed",
      floor: "0.78.0",
    });
    await openPicker(page);
    await expect(page.getByTestId("pi-row-npm-global-disabled-reason")).toContainText("0.78.0");
    await expect(page.getByTestId("pi-row-npm-global-spawn")).toBeDisabled();
    await expect(page.getByTestId("pi-row-npm-global-import")).toBeDisabled();

    // "neither consumer changes": snapshot every cell, force-click the disabled
    // ones, and assert the whole selection state is byte-identical after.
    const pressed = async () =>
      JSON.stringify(
        await page
          .getByTestId("pi-candidate-matrix")
          .locator("[aria-pressed]")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-pressed"))),
      );
    const before = await pressed();
    await page.getByTestId("pi-row-npm-global-spawn").click({ force: true });
    await page.getByTestId("pi-row-npm-global-import").click({ force: true });
    expect(await pressed()).toBe(before);
  });

  // test-plan #F9
  test("F9: running sessions on the previous version are counted", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await stubRuntimePost(page, { installs: [A, B], spawnKey: "repo-root", moduleKey: "repo-root" });
    await stubSessions(page, [{ piVersion: "0.84.1" }, { piVersion: "0.84.1" }, { piVersion: "0.83.0" }]);
    await openPicker(page);
    await page.getByTestId("pi-row-repo-root-spawn").click();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("pi-apply").click();
    await expect(page.getByTestId("pi-running-sessions")).toContainText("2");
  });

  // test-plan #F10
  test("F10: a session with no recorded runtime is reported separately, not counted", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await stubRuntimePost(page, { installs: [A, B], spawnKey: "repo-root", moduleKey: "repo-root" });
    await stubSessions(page, [{}]);
    await openPicker(page);
    await page.getByTestId("pi-row-repo-root-spawn").click();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("pi-apply").click();
    const note = page.getByTestId("pi-running-sessions");
    await expect(note).toContainText("unknown");
    await expect(note).not.toContainText("still on pi");
  });

  // test-plan #F11
  test("F11: a diverging selection restates the mismatch BEFORE the write", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    const seen = await stubRuntimePost(page, { installs: [A, B], spawnKey: "repo-root", moduleKey: "managed" });
    await openPicker(page);
    await sync(page).uncheck();
    await page.getByTestId("pi-row-repo-root-spawn").click();
    let text = "";
    page.once("dialog", (d) => {
      text = d.message();
      void d.dismiss();
    });
    await page.getByTestId("pi-apply").click();
    expect(text).toMatch(/DIFFERENT pi installs/i);
    // Dismissed → nothing was written.
    expect(seen).toHaveLength(0);
  });

  // test-plan #F12
  test("F12: a matching selection does not claim a mismatch", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await stubRuntimePost(page, { installs: [A, B], spawnKey: "repo-root", moduleKey: "repo-root" });
    await openPicker(page);
    await page.getByTestId("pi-row-repo-root-spawn").click();
    let text = "";
    page.once("dialog", (d) => {
      text = d.message();
      void d.accept();
    });
    await page.getByTestId("pi-apply").click();
    expect(text).not.toMatch(/DIFFERENT pi installs/i);
  });

  // test-plan #F13
  test("F13: a restart is offered for an import change and not for a spawn-only one", async ({ page }) => {
    // (a) import changed.
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await stubRuntimePost(page, { installs: [A, B], spawnKey: "repo-root", moduleKey: "repo-root" });
    await openPicker(page);
    await page.getByTestId("pi-row-repo-root-spawn").click();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("pi-apply").click();
    await expect(page.getByTestId("pi-restart-offer")).toBeVisible();

    // (b) spawn only.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubInstalls(page, {
      installs: [A, B],
      spawnKey: "managed",
      moduleKey: "managed",
      modulePinned: true,
    });
    await stubRuntimePost(page, {
      installs: [A, B],
      spawnKey: "repo-root",
      moduleKey: "managed",
      modulePinned: true,
    });
    await openPicker(page);
    await sync(page).uncheck();
    await page.getByTestId("pi-row-repo-root-spawn").click();
    page.once("dialog", (d) => void d.accept());
    await page.getByTestId("pi-apply").click();
    await expect(page.getByTestId("pi-restart-offer")).toHaveCount(0);
  });

  // test-plan #F14 — Electron-only. Skipped on the browser harness rather than
  // faked: `launchSource` is a server fact, and stubbing it would assert the
  // stub, not the host.
  test("F14: selecting outside the bundle warns but is permitted", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.launchSource = "electron";
      await route.fulfill({ response, json: body });
    });
    await openPicker(page);
    await page.getByTestId("pi-row-repo-root-spawn").click();
    await expect(page.getByTestId("pi-electron-bundle-warning")).toBeVisible();
    // Permitted: the selection stands.
    await expect(page.getByTestId("pi-row-repo-root-spawn")).toHaveAttribute("aria-pressed", "true");
  });

  // test-plan #F15
  test("F15: the Automatic row shows the current resolution and is never blank", async ({ page }) => {
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    await openPicker(page);
    const auto = page.getByTestId("pi-row-automatic");
    await expect(auto).toContainText("0.84.1");
    await expect(auto).toContainText("/opt/pi-a");
  });

  // test-plan #F16 — a mismatch created OUTSIDE the picker.
  test("F16: a mismatch created outside the picker is surfaced, not papered over", async ({ page }) => {
    await stubInstalls(page, {
      installs: [A, B],
      spawnKey: "managed",
      moduleKey: "repo-root",
      spawnPinned: true,
      modulePinned: true,
    });
    await openPicker(page);
    await expect(banner(page)).toBeVisible();
    await expect(sync(page)).not.toBeChecked();
  });

  // test-plan #F17
  test("F17: at 375px the row stacks, hit areas stay ≥44px, and nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await stubInstalls(page, { installs: [A, B], spawnKey: "managed", moduleKey: "managed" });
    const section = await openPicker(page);

    const row = page.getByTestId("pi-row-managed");
    const meta = await row.locator("> div").first().boundingBox();
    const spawnCell = await page.getByTestId("pi-row-managed-spawn").boundingBox();
    const importCell = await page.getByTestId("pi-row-managed-import").boundingBox();
    expect(meta).not.toBeNull();
    expect(spawnCell).not.toBeNull();
    expect(importCell).not.toBeNull();
    // Metadata sits ABOVE both cells (stacked, not side-by-side).
    expect(meta!.y + meta!.height).toBeLessThanOrEqual(spawnCell!.y + 1);
    // Both cells share a row and clear the 44px touch target.
    expect(Math.abs(spawnCell!.y - importCell!.y)).toBeLessThan(2);
    for (const box of [spawnCell!, importCell!]) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const sectionBox = await section.boundingBox();
    expect(sectionBox!.width).toBeLessThanOrEqual(375);
  });

  // test-plan #X13
  test("X13: a failing discovery endpoint degrades the section, not Settings", async ({ page }) => {
    await stubInstalls(page, { status: 500 });
    await openDeveloper(page);
    await expect(page.getByTestId("pi-runtime-error")).toBeVisible({ timeout: 20_000 });
    // The rest of Settings still renders.
    await expect(page.getByTestId("settings-content")).toBeVisible();
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible();
  });
});
