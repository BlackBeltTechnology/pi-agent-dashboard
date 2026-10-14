import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { discoveryStates } from "./fixtures/retro-ux/discovery.js";
import { knownServersStates } from "./fixtures/retro-ux/known-servers.js";
import { serverSelectorStates } from "./fixtures/retro-ux/server-selector.js";
import { hitCount, resetHits } from "./fixtures/retro-ux/stubs.js";
import { impactStates, usersStates } from "./fixtures/retro-ux/users.js";
import { expect, type Page, test } from "./fixtures.js";
import { resolveColor, setThemeMode } from "./helpers/computed-contrast.js";
import { resolveEvidencePath } from "./helpers/evidence-path.js";
import { gotoDashboard } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Identity + connectivity surfaces (Users, passkey impact note, server selector,
 * known servers, network discovery) against the UI contract, in every named
 * state, theme and width. Each state is reached by `page.route` stubs; the
 * probes are the repo's computed-contrast ones.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 3.7); a plain run writes nothing.
 *
 * See change: retro-ux-identity-connectivity (test-plan E13, E14, F6–F9).
 */

const CHANGE = "retro-ux-identity-connectivity";

const SURFACES: Record<string, UiState[]> = {
  users: [...usersStates, ...impactStates],
  "server-selector": serverSelectorStates,
  "known-servers": knownServersStates,
  discovery: discoveryStates,
};

const byId = (states: UiState[], id: string): UiState => {
  const s = states.find((x) => x.id === id);
  if (!s) throw new Error(`no fixture state ${id}`);
  return s;
};

const cell = (r: CaptureResult) => `${r.state} ${r.theme}-${r.mode} ${r.width}px`;
const failures = (results: CaptureResult[]): string[] =>
  results.flatMap((r) => [
    ...r.contrast.map((f) => `${cell(r)} contrast: ${f}`),
    ...r.size.map((f) => `${cell(r)} size: ${f}`),
    ...r.focus.map((f) => `${cell(r)} focus: ${f}`),
    ...r.overflow.map((f) => `${cell(r)} overflow: ${f}`),
  ]);

/** path → mtime of every file under the change's `mockups/after/` (empty when absent). */
function afterSnapshot(): Record<string, number> {
  const dir = join(dirname(resolveEvidencePath(CHANGE)), "mockups", "after");
  const out: Record<string, number> = {};
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p] = statSync(p).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

test.describe("retro-ux identity + connectivity", () => {
  for (const [surface, states] of Object.entries(SURFACES)) {
    // RETRO_UX_ONLY=id[,id] narrows a run to named states (debugging aid); other surfaces skip.
    const only = process.env.RETRO_UX_ONLY?.split(",").filter((id) => states.some((s) => s.id === id));
    test(`E13: ${surface} passes the contract probes in every state, theme and width`, async ({ page }) => {
      test.skip(only?.length === 0, "RETRO_UX_ONLY names no state of this surface");
      test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 12_000);
      const before = process.env.RETRO_UX_CAPTURE === "1" ? null : afterSnapshot();
      await gotoDashboard(page); // arms the first-launch dismissal for the whole page lifetime
      const results = await captureStates(page, { change: CHANGE, surface, states, only });
      expect(results).toHaveLength((only?.length ?? states.length) * RETRO_UX_THEMES.length * 3);
      expect(failures(results)).toEqual([]);
      if (before) expect(afterSnapshot()).toEqual(before); // a plain run writes no evidence
    });
  }

  test("F6: the portalled selector menu is probed non-vacuously in all 3 themes", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoDashboard(page);
    const results = await captureStates(page, {
      change: CHANGE,
      surface: "server-selector",
      states: serverSelectorStates,
      only: ["open-mixed"],
      widths: [1440],
    });
    expect(results.map((r) => `${r.theme}-${r.mode}`)).toEqual(["base-dark", "base-light", "nord-dark"]);
    for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
    expect(failures(results)).toEqual([]);
  });

  test("F7: stubs survive the theme reload (users unstable)", async ({ page }) => {
    await gotoDashboard(page);
    const unstable = byId(usersStates, "unstable");
    resetHits();
    await unstable.install(page);
    await page.goto("/settings/security");
    await expect(page.getByTestId("users-unstable")).toBeVisible(); // first answer served
    await setThemeMode(page, "light", "base"); // reloads; the stubbed request fires again
    await unstable.open(page);
    await expect(page.getByTestId("users-unstable")).toBeVisible();
    expect(hitCount("/api/users")).toBeGreaterThanOrEqual(2);
  });

  test("F8: the menu is open at screenshot time at both widths", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoDashboard(page);
    const mixed = byId(serverSelectorStates, "open-mixed");
    const seen: number[] = [];
    const checked: UiState = {
      ...mixed,
      open: async (p: Page) => {
        await mixed.open(p);
        await expect(p.getByRole("menu")).toBeVisible();
        seen.push(p.viewportSize()?.width ?? -1);
      },
    };
    await captureStates(page, {
      change: CHANGE,
      surface: "server-selector",
      states: [checked],
      themes: [{ theme: "base", mode: "dark" }],
      widths: [375, 1440],
    });
    expect(seen).toEqual([375, 1440]);
  });

  test("E14: Users action targets meet the size floors at 375 and 1440", async ({ page }) => {
    const list = byId(usersStates, "list");
    await gotoDashboard(page);
    await list.install(page);
    for (const [width, addMin] of [
      [375, 44],
      [1440, 36],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await list.open(page);
      const height = async (loc: ReturnType<Page["locator"]>) => (await loc.first().boundingBox())?.height ?? 0;
      // "Add user" is disabled until a name is typed, but its box is laid out regardless.
      expect(await height(page.getByRole("button", { name: "Add user" })), `Add user @${width}`).toBeGreaterThanOrEqual(addMin);
      expect(await height(page.getByLabel("Tier for Anna Kovács")), `tier select @${width}`).toBeGreaterThanOrEqual(32);
      expect(await height(page.getByTestId("user-invite-u1")), `Invite QR @${width}`).toBeGreaterThanOrEqual(32);
      expect(await height(page.getByRole("button", { name: "Revoke Anna Kovács" })), `Revoke @${width}`).toBeGreaterThanOrEqual(32);
    }
  });

  test("F9: every Users control shows a solid ≥2px --focus-ring outline when keyboard-focused", async ({ page }) => {
    test.setTimeout(180_000);
    const list = byId(usersStates, "list");
    await gotoDashboard(page);
    await list.install(page);
    for (const { theme, mode } of RETRO_UX_THEMES) {
      await page.goto("/");
      await setThemeMode(page, mode, theme);
      await list.open(page);
      const ring = await resolveColor(page, "var(--focus-ring)");
      const controls = await list.root(page).locator("button:visible:not([disabled]), select:visible:not([disabled]), input:visible:not([disabled])").all();
      expect(controls.length).toBeGreaterThan(3);
      for (const c of controls) {
        await c.focus();
        await page.keyboard.press("Shift"); // keyboard modality → :focus-visible
        const o = await c.evaluate((e) => {
          const s = getComputedStyle(e);
          return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth), color: s.outlineColor };
        });
        const label = await c.evaluate((e) => e.getAttribute("data-testid") ?? e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 24) ?? e.tagName);
        expect(o.style, `${theme}-${mode} ${label} outline-style`).toBe("solid");
        expect(o.width, `${theme}-${mode} ${label} outline-width`).toBeGreaterThanOrEqual(2);
        expect(await resolveColor(page, o.color), `${theme}-${mode} ${label} outline colour`).toEqual(ring);
      }
    }
  });
});
