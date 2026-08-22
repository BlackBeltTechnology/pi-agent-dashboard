import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * Test-plan S-25 — the scope × path decision table (tasks 7.2, 7.3).
 *
 * Ten destinations reach one grid through two entry points: five global
 * `/settings/<type>` paths and the five folder-scoped
 * `/folder/<cwd>/settings/<type>` mirrors. C4 resolved the shape as two entry
 * points into one panel with a scope preset, so folder and global URLs stay
 * distinct and each must render the resource type NAMED IN ITS OWN PATH.
 *
 * Two failure modes this pins, both silent:
 *   - a path falls through to the card list or 404s instead of rendering;
 *   - a path renders the WRONG type (the two entry points keep separate
 *     page→type maps, so one can drift from the other without a type error).
 *
 * `data-type` on `resource-grid-panel` is the observable — asserting only that
 * a grid appeared would pass while showing skills under /themes.
 *
 * See change: add-route-backed-overlay-dialogs.
 */

const ENCODED_CWD = Buffer.from(FIXTURE_GIT).toString("base64url");

/** page id → the `data-type` its grid must render. */
const RESOURCE_PAGES: [string, string][] = [
  ["skills", "skill"],
  ["agents", "agent"],
  ["extensions", "extension"],
  ["prompts", "prompt"],
  ["themes", "theme"],
];

const SCOPES: [string, (page: string) => string][] = [
  ["global", (p) => `/settings/${p}`],
  ["folder", (p) => `/folder/${ENCODED_CWD}/settings/${p}`],
];

test.describe("resource scope × path decision table (S-25)", () => {
  for (const [scope, buildUrl] of SCOPES) {
    for (const [pageId, expectedType] of RESOURCE_PAGES) {
      test(`${scope} /${pageId} renders exactly one grid of type ${expectedType}`, async ({
        page,
      }) => {
        // Arms the first-launch-modal dismissal (its backdrop would otherwise
        // intercept interaction on a freshly wiped container).
        await gotoDashboard(page);
        await page.goto(buildUrl(pageId));

        const grid = page.getByTestId("resource-grid-panel");
        await grid.waitFor({ state: "visible", timeout: 20_000 });

        // 7.3 — exactly one grid mounts per matched route. Both entry points
        // are now reachable inside an overlay, so a stray second mount would
        // mean the underlay is rendering a live grid behind the dialog.
        await expect(grid).toHaveCount(1);
        // 7.2 — and it is the type the PATH names, not merely some grid.
        await expect(grid).toHaveAttribute("data-type", expectedType);
        // The URL is untouched: no redirect, no fallthrough to the card list.
        await expect(page).toHaveURL(new RegExp(`${pageId}$`));

        // The SCOPE PRESET is what task 7.1 moved out of the two call sites and
        // onto the matched route (C4). Asserting only the grid's presence would
        // pass with both entry points collapsed to one scope, which is the
        // exact regression the collapse risks.
        if (scope === "folder") {
          // Folder scope spans local+global, so the filter is meaningful.
          await expect(page.getByTestId("resource-scope-filter")).toBeVisible();
          await expect(page.getByTestId("resource-global-pill")).toHaveCount(0);
        } else {
          // Global scope has one tier: a filter would be inert, and the static
          // pill states the scope instead.
          await expect(page.getByTestId("resource-global-pill")).toBeVisible();
          await expect(page.getByTestId("resource-scope-filter")).toHaveCount(0);
        }
      });
    }
  }
});
