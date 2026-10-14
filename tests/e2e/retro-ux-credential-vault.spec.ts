import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountsStates, chipStates, chipTriggerStates, importStates, shellStates, variablesStates, vault } from "./fixtures/retro-ux/vault.js";
import { expect, test } from "./fixtures.js";
import { resolveEvidencePath } from "./helpers/evidence-path.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, type UiState } from "./helpers/ui-capture.js";

/**
 * Credential-vault surfaces (page shell, Variables, Accounts, Import, session
 * chip + dialog) against the UI contract, in every board state, theme and width.
 * Each state is reached by `page.route` stubs of the vault REST routes; the
 * probes are the repo's computed-contrast ones.
 *
 * `RETRO_UX_CAPTURE=1` additionally writes the after-screenshots into the
 * change's `mockups/after/` folder (task 3.12); a plain run writes nothing.
 *
 * See change: retro-ux-credential-vault (test-plan E28).
 */

const CHANGE = "retro-ux-credential-vault";

/** The 27 board states, by surface. `session-chip-trigger` additionally probes the closed header chip. */
const SURFACES: Record<string, UiState[]> = {
  "page-shell": shellStates,
  variables: variablesStates,
  accounts: accountsStates,
  import: importStates,
  "session-chip": chipStates,
  "session-chip-trigger": chipTriggerStates,
};
/** These surfaces live in a session header and need one live session. */
const NEEDS_SESSION = new Set(["session-chip", "session-chip-trigger"]);

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

test.describe("retro-ux credential vault", () => {
  test("E28: the board has 27 fixture states over 5 surfaces", () => {
    const board = Object.entries(SURFACES).filter(([surface]) => surface !== "session-chip-trigger");
    expect(board).toHaveLength(5);
    expect(board.flatMap(([, states]) => states.map((s) => s.id))).toHaveLength(27);
  });

  for (const [surface, states] of Object.entries(SURFACES)) {
    // RETRO_UX_ONLY=id[,id] narrows a run to named states (debugging aid); other surfaces skip.
    const only = process.env.RETRO_UX_ONLY?.split(",").filter((id) => states.some((s) => s.id === id));
    test(`E28: ${surface} passes the contract probes in every state, theme and width`, async ({ page }) => {
      test.skip(only?.length === 0, "RETRO_UX_ONLY names no state of this surface");
      test.setTimeout(states.length * RETRO_UX_THEMES.length * 3 * 12_000 + 60_000);
      const before = process.env.RETRO_UX_CAPTURE === "1" ? null : afterSnapshot();
      if (NEEDS_SESSION.has(surface)) {
        // The chip lives in the header of a live session; its id keys the stubbed route.
        const card = await spawnFreshGitSession(page);
        vault.sessionId = (await card.getAttribute("data-session-id")) ?? "";
        expect(vault.sessionId).not.toBe("");
      } else {
        await gotoDashboard(page); // arms the first-launch dismissal for the whole page lifetime
      }
      const results = await captureStates(page, { change: CHANGE, surface, states, only });
      expect(results).toHaveLength((only?.length ?? states.length) * RETRO_UX_THEMES.length * 3);
      for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
      expect(failures(results)).toEqual([]);
      if (before) expect(afterSnapshot()).toEqual(before); // a plain run writes no evidence
    });
  }
});
