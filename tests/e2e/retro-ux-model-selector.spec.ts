import { chainStates, gotoGrammar, grammarTrigger, hostStates, pickerDropdown, pickerStates, rolesStates, stubGrammarHost } from "./fixtures/retro-ux/model-selector.js";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Model selector + role refs against the UI contract, in every reachable named
 * state, theme and width. Picker / host states are reached with `page.route`
 * stubs (see the fixture header for what is L1-only); the roles page runs on a
 * real live session. Probes are the repo's computed-contrast ones.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 3.13); a plain run writes nothing.
 *
 * See change: retro-ux-model-selector (test-plan G1–G6).
 */

const CHANGE = "retro-ux-model-selector";

const cell = (r: CaptureResult) => `${r.state} ${r.theme}-${r.mode} ${r.width}px`;
const failures = (results: CaptureResult[]): string[] =>
  results.flatMap((r) => [
    ...r.contrast.map((f) => `${cell(r)} contrast: ${f}`),
    ...r.size.map((f) => `${cell(r)} size: ${f}`),
    ...r.focus.map((f) => `${cell(r)} focus: ${f}`),
  ]);

async function probe(page: Page, surface: string, states: UiState[]): Promise<void> {
  test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 12_000);
  const results = await captureStates(page, { change: CHANGE, surface, states });
  expect(results).toHaveLength(states.length * RETRO_UX_THEMES.length * 3);
  for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
  expect(failures(results)).toEqual([]);
}

test.describe("retro-ux model selector", () => {
  test("G1: the picker passes the contract probes in every state, theme and width", async ({ page }) => {
    await gotoDashboard(page);
    await probe(page, "picker", pickerStates);
  });

  test("G2: host triggers and Blackhole chain slots pass the contract probes", async ({ page }) => {
    await gotoDashboard(page);
    await probe(page, "hosts", [...hostStates, ...chainStates]);
  });

  test("G3: the roles settings pass the contract probes", async ({ page }) => {
    await spawnFreshGitSession(page); // the roles list reaches the browser through a live session
    await probe(page, "roles", rolesStates);
  });

  test("G4: trigger, ★ toggle and tabs meet the size floors at 375 and 1440", async ({ page }) => {
    await gotoDashboard(page);
    await stubGrammarHost(page, { role: "@fast" });
    for (const [width, floor] of [
      [375, 44],
      [1440, 32],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await gotoGrammar(page);
      const trigger = grammarTrigger(page);
      expect((await trigger.boundingBox())?.height ?? 0, `trigger @${width}`).toBeGreaterThanOrEqual(floor);
      await trigger.click();
      const dropdown = pickerDropdown(page);
      for (const id of ["model-tab-model", "model-tab-role"]) {
        expect((await dropdown.getByTestId(id).boundingBox())?.height ?? 0, `${id} @${width}`).toBeGreaterThanOrEqual(floor);
      }
      await dropdown.getByTestId("model-tab-model").click();
      const star = dropdown.getByTestId("model-fav-toggle").first();
      const box = await star.boundingBox();
      expect(box?.height ?? 0, `★ height @${width}`).toBeGreaterThanOrEqual(floor);
      expect(box?.width ?? 0, `★ width @${width}`).toBeGreaterThanOrEqual(floor);
      await page.keyboard.press("Escape");
    }
  });

  test("G5: a role ref reads the same in the trigger and the Roles tab, and the roles pill uses the same display", async ({ page }) => {
    await gotoDashboard(page);
    await stubGrammarHost(page, { role: "@fast" });
    await gotoGrammar(page);
    const trigger = grammarTrigger(page);
    const read = async (ref: ReturnType<Page["locator"]>) => ({
      visible: await ref.evaluate((el) => {
        // visible text: every text node not inside `.sr-only`
        const out: string[] = [];
        const walk = (n: Node) => {
          if (n.nodeType === 3) out.push((n.textContent ?? "").trim());
          else if (!(n as Element).classList?.contains("sr-only")) n.childNodes.forEach(walk);
        };
        walk(el);
        return out.filter(Boolean).join(" ");
      }),
      full: (await ref.textContent())?.replace(/\s+/g, " ").trim(),
    });
    const fromTrigger = await read(trigger.locator("[data-role-ref]"));
    expect(fromTrigger.visible).toBe("@fast claude-haiku-4-5 low");
    expect(fromTrigger.full).toContain("anthropic/claude-haiku-4-5");

    await trigger.click(); // opens on the Roles tab (current is a role ref)
    const row = pickerDropdown(page).locator('[data-testid="role-row"][data-role="fast"] [data-role-ref]');
    const fromRow = await read(row);
    expect(fromRow).toEqual(fromTrigger);
    await page.keyboard.press("Escape");

    // The roles page renders its pills through the same display (token + model chip).
    await spawnFreshGitSession(page);
    await page.goto("/settings/plugins/roles");
    const pill = page.getByTestId("roles-row-fast").locator("[data-role-ref]");
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill.locator("[data-role-ref-token]")).toHaveText("@fast");
  });

  test("G6: composer picker end to end by keyboard", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    const trigger = page.getByTestId("model-selector-button");
    await expect(trigger).toBeEnabled({ timeout: 15_000 });
    const before = ((await trigger.textContent()) ?? "").trim();

    await trigger.focus();
    await page.keyboard.press("Enter");
    const filter = page.getByTestId("model-filter");
    await expect(filter).toBeFocused({ timeout: 10_000 });
    await page.keyboard.type("son");
    const rows = page.getByTestId("model-row");
    const count = await rows.count();
    test.skip(count < 1, "the harness catalogue has no model matching 'son'");
    if (count > 1) await page.keyboard.press("ArrowDown");
    await expect(filter).toHaveAttribute("aria-activedescendant", /-row-\d+$/);
    const activeId = (await filter.getAttribute("aria-activedescendant")) as string;
    const picked = ((await page.locator(`[id="${activeId}"]`).textContent()) ?? "").trim();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("model-dropdown")).toBeHidden();
    await expect(trigger).toBeFocused();
    // The trigger now names the picked model (or is unchanged when it was already current).
    const after = ((await trigger.textContent()) ?? "").trim();
    expect(picked.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    if (after === before) return; // picked the model that was already current
    await expect(trigger).not.toHaveText(before);
  });
});
