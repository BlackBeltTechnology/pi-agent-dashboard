import type { Page } from "@playwright/test";
import { expect } from "../../fixtures.js";
import { gotoDashboard, pinDirectory } from "../../helpers/index.js";
import type { UiState } from "../../helpers/ui-capture.js";
import { hold, stubApi } from "./stubs.js";

/**
 * KB folder pill states, reached by stubbing `GET /api/kb/stats` (every cwd gets
 * the same answer, so the first folder's pill shows the state). The pill is a
 * SlotPill in the sidebar folder card; `pinning` is the denied state with the
 * Pin action in flight. See change: retro-ux-plugin-settings-forms.
 * See change: fix-slot-pill-legend-and-stale-overflow (overflow probe root).
 */

const STATS = { files: 412, chunks: 19397, indexed: true, staleCount: 0, indexing: false, jobStatus: "idle", sourceCount: 2 };

const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export const statsAre = (over: Record<string, unknown>, status = 200) => (page: Page) =>
  stubApi(page, "/api/kb/stats", (route) => json(route, status === 200 ? { ...STATS, ...over } : over, status), "GET");

const pill = (page: Page) => page.getByTestId("folder-kb-section").first();

/** Writable fixture folder with a knowledge_base.json (docker/fixtures/kb-sample); pinning it puts a KB pill in the sidebar. */
const KB_FIXTURE = "/fixtures/kb-sample";

/** Pins the fixture folder (idempotent) so a sidebar folder card with a KB pill exists. */
async function pinKbFixture(page: Page): Promise<void> {
  await gotoDashboard(page);
  const skip = page.getByRole("button", { name: /^skip$/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.getByTestId("onboarding-step-2-cta").or(page.getByTestId("dashboard-add-folder-btn")).first()).toBeVisible({
    timeout: 30_000,
  });
  if ((await page.getByTestId(`folder-actions-menu-${KB_FIXTURE}`).count()) === 0) await pinDirectory(page, KB_FIXTURE);
}

/** Brings the pill into view and waits for the stubbed state. */
export const showing = (state: string) => async (page: Page) => {
  if ((await page.getByTestId("folder-kb-section").count()) === 0) await pinKbFixture(page);
  await page.locator(`[data-testid="folder-kb-section"][data-state="${state}"]`).first().waitFor({ state: "visible", timeout: 20_000 });
};

/** Overflow probe root = the SlotPill itself (not the wrapper that also holds the card control); the capsule legend overhangs the top by design. */
const overflowRoot = (page: Page) => page.getByTestId("folder-kb-open-settings").first();

const base = { stubs: ["/api/kb/stats"], root: pill, overflowRoot, overflowTopExempt: "[data-slot-pill-legend]" };

export const kbPillStates: UiState[] = [
  { id: "loading", label: "stats request pending", ...base, install: (page) => stubApi(page, "/api/kb/stats", hold, "GET"), open: showing("loading") },
  { id: "populated", label: "indexed folder", ...base, install: statsAre({}), open: showing("populated") },
  { id: "stale", label: "3 sources drifted", ...base, install: statsAre({ staleCount: 3 }), open: showing("stale") },
  { id: "indexing", label: "reindex running", ...base, install: statsAre({ indexing: true, jobStatus: "running" }), open: showing("indexing") },
  {
    id: "no-sources",
    label: "no sources configured",
    ...base,
    install: statsAre({ chunks: 0, files: 0, indexed: false, sourceCount: 0 }),
    open: showing("no-sources"),
  },
  { id: "not-indexed", label: "sources, never indexed", ...base, install: statsAre({ chunks: 0, files: 0, indexed: false }), open: showing("not-indexed") },
  {
    id: "denied",
    label: "folder not admitted",
    ...base,
    install: statsAre({ error: "cwd not allowed", reason: "not pinned", hint: "pin the folder" }, 403),
    open: showing("denied"),
  },
  {
    id: "pinning",
    label: "pin requested, awaiting the server",
    ...base,
    install: statsAre({ error: "cwd not allowed", reason: "not pinned", hint: "pin the folder" }, 403),
    open: async (page) => {
      await showing("denied")(page);
      await page.locator('[data-testid^="folder-actions-menu-"]').first().click();
      const item = page.getByTestId("folder-menu-item-kb-reindex");
      if (await item.isVisible().catch(() => false)) await item.click();
      await page.locator('[data-testid="folder-kb-section"][data-state="pinning"]').first().waitFor({ state: "visible", timeout: 10_000 });
    },
  },
  { id: "missing", label: "folder removed from disk", ...base, install: statsAre({ folderMissing: true, sourceCount: 0, chunks: 0, indexed: false }), open: showing("missing") },
  { id: "error", label: "last index failed", ...base, install: statsAre({ jobStatus: "error", lastError: "walk failed" }), open: showing("error") },
];
