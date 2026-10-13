import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { contextModeStates } from "./fixtures/retro-ux/context-mode.js";
import { gmailStates } from "./fixtures/retro-ux/gmail.js";
import { hermesStates } from "./fixtures/retro-ux/hermes.js";
import { kbPillStates } from "./fixtures/retro-ux/kb-pill.js";
import { expect, test } from "./fixtures.js";
import { resolveEvidencePath } from "./helpers/evidence-path.js";
import { gotoDashboard } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Plugin settings forms (context-mode, hermes-memory, Gmail) and the KB folder
 * pill against the UI contract, in every named state, theme and width. Each state
 * is reached by `page.route` stubs; the probes are the repo's computed-contrast
 * ones.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 3.11); a plain run writes nothing.
 *
 * See change: retro-ux-plugin-settings-forms (test-plan E24).
 */

const CHANGE = "retro-ux-plugin-settings-forms";

const SURFACES: Record<string, UiState[]> = {
  "context-mode": contextModeStates,
  hermes: hermesStates,
  gmail: gmailStates,
  "kb-pill": kbPillStates,
};

const cell = (r: CaptureResult) => `${r.state} ${r.theme}-${r.mode} ${r.width}px`;
const failures = (results: CaptureResult[]): string[] =>
  results.flatMap((r) => [
    ...r.contrast.map((f) => `${cell(r)} contrast: ${f}`),
    ...r.size.map((f) => `${cell(r)} size: ${f}`),
    ...r.focus.map((f) => `${cell(r)} focus: ${f}`),
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

test.describe("retro-ux plugin settings forms", () => {
  for (const [surface, states] of Object.entries(SURFACES)) {
    // RETRO_UX_ONLY=id[,id] narrows a run to named states (debugging aid); other surfaces skip.
    const only = process.env.RETRO_UX_ONLY?.split(",").filter((id) => states.some((s) => s.id === id));
    test(`E24: ${surface} passes the contract probes in every state, theme and width`, async ({ page }) => {
      test.skip(only?.length === 0, "RETRO_UX_ONLY names no state of this surface");
      test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 12_000);
      const before = process.env.RETRO_UX_CAPTURE === "1" ? null : afterSnapshot();
      await gotoDashboard(page); // arms the first-launch dismissal for the whole page lifetime
      const results = await captureStates(page, { change: CHANGE, surface, states, only });
      expect(results).toHaveLength((only?.length ?? states.length) * RETRO_UX_THEMES.length * 3);
      for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
      expect(failures(results)).toEqual([]);
      if (before) expect(afterSnapshot()).toEqual(before); // a plain run writes no evidence
    });
  }
});
