import { expect, test } from "@playwright/test";
import { byTestId, ensureGitSession } from "./helpers/index.js";

// Level-1 E2E for the polymorphic Initialize button (change: project-init-skill-and-profiles).
//
// The baked `sample-git` fixture ships NO `.pi/settings.json#worktreeInit` hook,
// so the worktree-init-status endpoint reports `hasHook: false` for its folder
// group. In that state the folder-action-bar renders the `project-init-btn`
// Initialize button (NOT the change-A hook-run button), and clicking it spawns
// a fresh interactive session in that cwd pre-injected with `/skill:project-init`.
//
// This spec proves the real Docker render + spawn round-trip end to end:
//   1. the no-hook folder row shows `project-init-btn`, and
//   2. clicking it spawns a NEW session card (the WS spawn round-trip).
//
// The scaffold conversation itself (skill asks profile → writes files) is
// agent-driven and covered deterministically by unit tests — not re-asserted
// here (it would require hand-scripting the faux model's whole tool sequence).

const CARD = '[data-testid="session-card-desktop"]';

async function sessionIds(page: import("@playwright/test").Page): Promise<Set<string>> {
  const ids = (await page
    .locator(CARD)
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id")))) as (string | null)[];
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

test.describe("project-init Initialize button (no-hook folder)", () => {
  test("no-hook folder shows project-init-btn; clicking spawns a new session", async ({ page }) => {
    // Guarantees the sample-git folder group (no worktreeInit hook) is present.
    await ensureGitSession(page);

    // 1. The polymorphic Initialize button renders for the no-hook folder.
    const initBtn = byTestId(page, "projectInitBtn").first();
    await expect(initBtn).toBeVisible({ timeout: 20_000 });

    // 2. Clicking it spawns a fresh session in that cwd (WS spawn round-trip).
    const before = await sessionIds(page);
    await initBtn.click();

    await expect
      .poll(async () => {
        const now = await sessionIds(page);
        return [...now].some((id) => !before.has(id));
      }, { timeout: 60_000 })
      .toBe(true);
  });
});
