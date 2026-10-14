import { RETRO_UX_CHAT_TAIL } from "../../qa/fixtures/faux-scenarios.js";
import { chat, openChat, reveal } from "./fixtures/retro-ux/chat-session.js";
import { customEntryStates } from "./fixtures/retro-ux/custom-entry.js";
import { mermaidStates } from "./fixtures/retro-ux/mermaid.js";
import { webSearchStates } from "./fixtures/retro-ux/web-search.js";
import { expect, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Chat-rendering rows (mermaid block, web-search / fetch row, unclaimed custom
 * entry) against the UI contract, in every named state, theme and width, plus the
 * behaviours the board decided: row alignment with the tool timeline, zoom
 * targets and keyboard zoom. One live session (faux scenario
 * `retro-ux-chat-rendering`) holds every row; payload states are reached by
 * stubbing `/api/sessions/:id/entry/:entryId`, never by seeding the server.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 3.11); a plain run writes nothing.
 *
 * See change: retro-ux-chat-rendering (test-plan G1–G6).
 */

const CHANGE = "retro-ux-chat-rendering";

// The app's service worker answers hashed assets from its own cache, bypassing `page.route` (the mermaid `loading` state).
test.use({ serviceWorkers: "block" });

test.describe.configure({ mode: "serial" });

/** Spawn the scenario session once and remember its id for the fixtures. */
async function ensureSession(page: Page): Promise<void> {
  if (chat.sessionId) return;
  const card = await spawnFreshGitSession(page);
  const id = await card.getAttribute("data-session-id");
  expect(id).toBeTruthy();
  chat.sessionId = id as string;
  await card.click();
  await sendPrompt(page, "[[faux:retro-ux-chat-rendering]] go");
  await expect(page.getByText(RETRO_UX_CHAT_TAIL).first()).toBeVisible({ timeout: 90_000 });
}

const cell = (r: CaptureResult) => `${r.state} ${r.theme}-${r.mode} ${r.width}px`;
const failures = (results: CaptureResult[]): string[] =>
  results.flatMap((r) => [
    ...r.contrast.map((f) => `${cell(r)} contrast: ${f}`),
    ...r.size.map((f) => `${cell(r)} size: ${f}`),
    ...r.focus.map((f) => `${cell(r)} focus: ${f}`),
    ...r.overflow.map((f) => `${cell(r)} overflow: ${f}`),
  ]);

const SURFACES: Array<[string, string, UiState[]]> = [
  ["G1", "mermaid", mermaidStates],
  ["G2", "web-search", webSearchStates],
  ["G3", "custom-entry", customEntryStates],
];

test.describe("retro-ux chat rendering", () => {
  for (const [id, surface, states] of SURFACES) {
    // RETRO_UX_ONLY=id[,id] narrows a run to named states (debugging aid); other surfaces skip.
    const only = process.env.RETRO_UX_ONLY?.split(",").filter((s) => states.some((x) => x.id === s));
    test(`${id}: ${surface} passes the contract probes in every state, theme and width`, async ({ page }) => {
      test.skip(only?.length === 0, "RETRO_UX_ONLY names no state of this surface");
      test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 20_000 + 180_000);
      await ensureSession(page);
      const results = await captureStates(page, { change: CHANGE, surface, states, only });
      expect(results).toHaveLength((only?.length ?? states.length) * RETRO_UX_THEMES.length * 3);
      // A probe scope that measured nothing must not pass vacuously.
      expect(results.filter((r) => r.measured === 0).map(cell)).toEqual([]);
      expect(failures(results)).toEqual([]);
    });
  }

  for (const width of [375, 1440]) {
    test(`G4: web-search and custom rows share the tool rows' left edge at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await ensureSession(page);
      await page.setViewportSize({ width, height: 900 });
      await openChat(page);
      await reveal(page, page.getByTestId("web-search-entry"));
      await reveal(page, page.getByTestId("custom-entry-card").filter({ hasText: "e2e:kv" }));

      // For every claimed or fallback row, compare against the tool rows (`border-l-2` wrapper)
      // that share its container: the burst body when absorbed, else the transcript itself.
      const rows = await page.evaluate(() => {
        const edge = (el: Element) => Math.round(el.getBoundingClientRect().left * 10) / 10;
        const out: Array<{ kind: string; absorbed: boolean; left: number; toolLefts: number[]; toolInfo: string[] }> = [];
        for (const row of document.querySelectorAll('[data-testid="web-search-entry"], [data-testid="custom-entry-card"]')) {
          const burst = row.closest('[data-testid="tool-burst-body"]');
          const scope = burst ?? row.closest('[data-testid="chat-scroll-container"]') ?? document.body;
          const tools = [...scope.querySelectorAll(":scope .border-l-2")].filter(
            (t) =>
              !row.contains(t) &&
              !t.closest(".items-end") && // the user's own message bubble also carries `border-l-2`
              !t.closest('[data-testid="web-search-entry"], [data-testid="custom-entry-card"]') &&
              (burst !== null || !t.closest('[data-testid="tool-burst-body"]')),
          );
          out.push({
            kind: row.getAttribute("data-testid") ?? "?",
            absorbed: Boolean(burst),
            left: edge(row),
            toolLefts: tools.map(edge),
            toolInfo: tools.map((t) => `${edge(t)}:${(t.parentElement?.getAttribute("data-testid") ?? t.parentElement?.className ?? "").slice(0, 40)}:${(t.textContent ?? "").slice(0, 25)}`),
          });
        }
        return out;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.absorbed), "an absorbed row is part of the scenario").toBe(true);
      for (const r of rows) {
        expect(r.toolLefts.length, `${r.kind} (absorbed=${r.absorbed}) has a tool row to compare with`).toBeGreaterThan(0);
        for (const t of r.toolLefts) expect(Math.abs(t - r.left), `${r.kind} absorbed=${r.absorbed} left=${r.left} vs ${r.toolInfo.join(" | ")}`).toBeLessThanOrEqual(1);
      }
    });
  }

  for (const width of [375, 1440]) {
    test(`G5: zoom buttons meet the tap-target at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await ensureSession(page);
      await page.setViewportSize({ width, height: 900 });
      await openChat(page);
      const vp = page.getByRole("group", { name: /^Diagram\./ }).first();
      await vp.click();
      await page.getByRole("button", { name: "Zoom in" }).click(); // the % readout appears off the initial scale
      const min = width < 640 ? 44 : 32;
      for (const name of ["Zoom in", "Zoom out", "Reset zoom"]) {
        const box = await page.getByRole("button", { name }).first().boundingBox();
        expect(box, name).not.toBeNull();
        expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(min - 0.5);
        expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(min - 0.5);
      }
      const readout = page.locator('[aria-live="polite"]').filter({ hasText: "%" }).first();
      await expect(readout).toBeVisible();
      const fontSize = await readout.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(11);
    });
  }

  test("G6: a diagram zooms from the keyboard and Escape returns focus to the viewport", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureSession(page);
    await openChat(page);
    const vp = page.getByRole("group", { name: /^Diagram\./ }).first();
    const scaleOf = () =>
      vp.locator(".mermaid-diagram-inner").evaluate((el) => {
        const m = /scale\(([^)]+)\)/.exec((el as HTMLElement).style.transform);
        return m ? Number.parseFloat(m[1]) : Number.NaN;
      });
    await vp.focus();
    await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0); // focus alone does not activate
    await page.keyboard.press("Enter");
    const before = await scaleOf();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(scaleOf).toBeGreaterThan(before);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
    await expect(vp).toBeFocused();
  });
});
