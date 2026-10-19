import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { appleToolsStates } from "./fixtures/retro-ux/plugin-apple-tools.js";
import { automationStates } from "./fixtures/retro-ux/plugin-automation.js";
import { blackholeStates } from "./fixtures/retro-ux/plugin-blackhole.js";
import { browserInstall, browserStates } from "./fixtures/retro-ux/plugin-browser.js";
import { chatGatewayStates } from "./fixtures/retro-ux/plugin-chat-gateway.js";
import { costStates } from "./fixtures/retro-ux/plugin-cost-estimator.js";
import { answerBridge, bridgeSessions, bridgeStates } from "./fixtures/retro-ux/plugin-flows-anthropic-bridge.js";
import { flowsStates } from "./fixtures/retro-ux/plugin-flows.js";
import { goalStates } from "./fixtures/retro-ux/plugin-goal.js";
import { grammarStates } from "./fixtures/retro-ux/plugin-grammar.js";
import { hostChromeStates } from "./fixtures/retro-ux/plugin-host-chrome.js";
import { mcpClientStates } from "./fixtures/retro-ux/plugin-mcp-client.js";
import { obsStudioStates } from "./fixtures/retro-ux/plugin-obs-studio.js";
import { patchConfig, pluginPath } from "./fixtures/retro-ux/plugin-page.js";
import { quotaStates } from "./fixtures/retro-ux/plugin-quota.js";
import { subagentsStates } from "./fixtures/retro-ux/plugin-subagents.js";
import { systemOneStates } from "./fixtures/retro-ux/plugin-system-one.js";
import { expect, test } from "./fixtures.js";
import { colorDistance, ownBackground, resolveColor, setThemeMode } from "./helpers/computed-contrast.js";
import { resolveEvidencePath } from "./helpers/evidence-path.js";
import { gotoDashboard } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Plugin settings wave 2 — the 15 remaining plugin bodies plus the host chrome,
 * in every board state, theme and width (E36), and the targeted rendered checks
 * for the cost inputs (E37), the back link (E38), the table scroll (E39), the
 * collapsed browser card (F7) and the body rhythm (F8). Every state is reached
 * by `page.route` stubs; the probes are the repo's computed-contrast ones.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 6.8); a plain run writes nothing.
 *
 * See change: retro-ux-plugin-settings-wave-2 (test-plan E36–E39, F7, F8).
 */

const CHANGE = "retro-ux-plugin-settings-wave-2";

const SURFACES: Record<string, UiState[]> = {
  "host-chrome": hostChromeStates,
  "apple-tools": appleToolsStates,
  browser: browserStates,
  "chat-gateway": chatGatewayStates,
  "flows-anthropic-bridge": bridgeStates,
  automation: automationStates,
  blackhole: blackholeStates,
  cost: costStates,
  grammar: grammarStates,
  quota: quotaStates,
  "obs-studio": obsStudioStates,
  "mcp-client": mcpClientStates,
  "system-one": systemOneStates,
  goal: goalStates,
  flows: flowsStates,
  subagents: subagentsStates,
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

test.describe("retro-ux plugin settings wave 2", () => {
  for (const [surface, states] of Object.entries(SURFACES)) {
    // RETRO_UX_ONLY=id[,id] narrows a run to named states (debugging aid); other surfaces skip.
    const only = process.env.RETRO_UX_ONLY?.split(",").filter((id) => states.some((s) => s.id === id));
    test(`E36: ${surface} passes the contract probes in every state, theme and width`, async ({ page }) => {
      test.skip(only?.length === 0, "RETRO_UX_ONLY names no state of this surface");
      test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 15_000);
      const before = process.env.RETRO_UX_CAPTURE === "1" ? null : afterSnapshot();
      await gotoDashboard(page); // arms the first-launch dismissal for the whole page lifetime
      const results = await captureStates(page, { change: CHANGE, surface, states, only });
      expect(results).toHaveLength((only?.length ?? states.length) * RETRO_UX_THEMES.length * 3);
      for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
      expect(failures(results)).toEqual([]);
      if (before) expect(afterSnapshot()).toEqual(before); // a plain run writes no evidence
    });
  }

  test("E37: Cost inputs look editable in every theme (border, --border-secondary, --bg-tertiary)", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoDashboard(page);
    await patchConfig("cost-estimator", { seatPlan: "custom", seatMonthlyUsd: 40, seats: 2, gapCapMinutes: 15 })(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const { theme, mode } of RETRO_UX_THEMES) {
      await setThemeMode(page, mode, theme);
      await page.goto(pluginPath("cost-estimator"));
      await page.getByTestId("cost-settings").waitFor({ state: "visible", timeout: 30_000 });
      const border = await resolveColor(page, "var(--border-secondary)");
      const background = await resolveColor(page, "var(--bg-tertiary)");
      for (const id of ["cost-seats", "cost-gap-cap", "cost-seat-monthly"]) {
        const input = page.getByTestId(id);
        const where = `${id} ${theme}-${mode}`;
        await expect(input, where).toBeVisible();
        const style = await input.evaluate((el) => {
          const s = getComputedStyle(el);
          const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
          cv.fillStyle = "#000";
          cv.fillStyle = s.borderTopColor;
          cv.fillRect(0, 0, 1, 1);
          const d = cv.getImageData(0, 0, 1, 1).data;
          return { tag: el.tagName, width: Number.parseFloat(s.borderTopWidth), style: s.borderTopStyle, color: [d[0], d[1], d[2]] };
        });
        expect(style.tag, `${where} is the input itself`).toBe("INPUT");
        expect(style.style, `${where} border style`).not.toBe("none");
        expect(style.width, `${where} border width`).toBeGreaterThanOrEqual(1);
        expect(colorDistance(style.color, border), `${where} border colour vs --border-secondary`).toBeLessThanOrEqual(1);
        expect(colorDistance(await ownBackground(input), background), `${where} background vs --bg-tertiary`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("E38: the back link is a ≥44 px target at 375 and ≥32 px at 1440, above the chrome card", async ({ page }) => {
    await gotoDashboard(page);
    for (const [width, min] of [
      [375, 44],
      [1440, 32],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pluginPath("flows"));
      const back = page.getByTestId("plugin-page-back-to-index");
      const chrome = page.getByTestId("plugin-page-chrome");
      await expect(chrome).toBeVisible({ timeout: 30_000 });
      const [b, c] = [await back.boundingBox(), await chrome.boundingBox()];
      expect(b, `back link box at ${width}px`).not.toBeNull();
      expect(c, `chrome box at ${width}px`).not.toBeNull();
      expect(b!.height, `back link height at ${width}px`).toBeGreaterThanOrEqual(min);
      expect(b!.y + b!.height, `back link sits above the chrome card at ${width}px`).toBeLessThanOrEqual(c!.y + 0.5);
    }
  });

  test("E39: degraded bridge table at 375 scrolls inside its wrapper, the page does not", async ({ page }) => {
    await gotoDashboard(page);
    await answerBridge(bridgeSessions.degraded)(page);
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(pluginPath("flows-anthropic-bridge"));
    const row = page.getByTestId("flows-anthropic-bridge-session-4302");
    await expect(row).toBeVisible({ timeout: 30_000 });
    const wrapper = row.locator("xpath=ancestor::table[1]/parent::div[1]");
    const page_ = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(page_.scrollWidth, "document scrollWidth within the viewport").toBeLessThanOrEqual(page_.innerWidth);
    const box = await wrapper.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(box.overflowX, "wrapper overflow-x").toBe("auto");
    expect(box.scrollWidth, "wrapper content is wider than the wrapper (it scrolls)").toBeGreaterThan(box.clientWidth);
    await wrapper.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await wrapper.evaluate((el) => el.scrollLeft), "wrapper actually scrolls").toBeGreaterThan(0);
  });

  test("F7: the browser profile card collapses and expands from the keyboard, pills and focus ring intact", async ({ page }) => {
    await gotoDashboard(page);
    await browserInstall(page);
    await page.goto(pluginPath("browser"));
    const item = page.getByTestId("browser-profile-Default");
    const summary = page.getByTestId("browser-summary-Default");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const open = () => item.evaluate((el) => (el as HTMLDetailsElement).open);
    const pills = ["browser-installed-Default", "browser-has-token-Default", "browser-connected-Default"];
    const pillsVisible = async (when: string) => {
      for (const id of pills) await expect(page.getByTestId(id), `${id} ${when}`).toBeVisible();
    };

    // Tab on from the relay switch (the last control above the profile list) until the summary has focus.
    await page.getByTestId("browser-enabled-toggle").focus();
    let focused = false;
    for (let i = 0; i < 80 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await summary.evaluate((el) => el === document.activeElement);
    }
    expect(focused, "Tab reaches the profile summary").toBe(true);
    const ring = await summary.evaluate((el) => {
      const s = getComputedStyle(el);
      return (s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0) || (/rgb/.test(s.boxShadow) && s.boxShadow !== "none");
    });
    expect(ring, "focus ring on the summary").toBe(true);

    expect(await open(), "starts expanded").toBe(true);
    await pillsVisible("while expanded");
    await page.keyboard.press("Enter");
    expect(await open(), "Enter collapses").toBe(false);
    await pillsVisible("while collapsed");
    await expect(page.getByTestId("browser-token-input-Default"), "body hidden while collapsed").toBeHidden();
    await page.keyboard.press("Enter");
    expect(await open(), "Enter expands again").toBe(true);
    await expect(page.getByTestId("browser-token-input-Default")).toBeVisible();
  });

  test("F8: two top-level blocks in a plugin body sit one host spacing step apart, neither with a top margin", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto(pluginPath("flows"));
    const body = page.getByTestId("plugin-page-body-flows");
    await expect(page.getByTestId("flows-edit-mode-toggle")).toBeVisible({ timeout: 30_000 });
    // A second top-level block, appended the way a plugin's second claim would be.
    const m = await body.evaluate((el) => {
      const extra = document.createElement("div");
      extra.textContent = "second block";
      el.appendChild(extra);
      const [a, b] = [el.children[0] as HTMLElement, extra];
      const probe = document.createElement("div");
      probe.className = "grid gap-3"; // the host spacing step, from the same utility the wrapper uses
      document.body.appendChild(probe);
      const step = getComputedStyle(probe).rowGap;
      probe.remove();
      const s = getComputedStyle(el);
      return {
        display: s.display,
        rowGap: s.rowGap,
        step,
        gap: b.getBoundingClientRect().top - a.getBoundingClientRect().bottom,
        marginTops: [getComputedStyle(a).marginTop, getComputedStyle(b).marginTop],
        children: el.children.length,
      };
    });
    expect(m.children).toBeGreaterThanOrEqual(2);
    expect(m.display).toBe("grid");
    expect(m.step).toBe("12px");
    expect(m.rowGap).toBe(m.step);
    expect(m.gap).toBeCloseTo(Number.parseFloat(m.step), 0);
    expect(m.marginTops).toEqual(["0px", "0px"]);
  });
});
