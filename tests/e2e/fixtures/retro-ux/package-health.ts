import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { ok, stubApi } from "./stubs.js";

/**
 * Add-ons ▸ Issues tab (`PackageHealthPanel` inside it) in its stale / missing /
 * duplicate / clean states, reached by answering `GET /api/packages/health`.
 * See change: addons-hub-folder-view (test-plan #F17).
 */

const HEALTH = "/api/packages/health";
const URL_ = "/settings/add-ons?tab=issues";

const report = (entries: Array<Record<string, unknown>>) => ({
  entries,
  summary: {
    ok: entries.filter((e) => e.status === "ok").length,
    staleNpm: entries.filter((e) => e.status === "stale-npm").length,
    missingPath: entries.filter((e) => e.status === "missing-path").length,
    duplicateGroups: [],
  },
});

const health = (entries: Array<Record<string, unknown>>) => (page: Page) =>
  stubApi(page, HEALTH, (route: Route) => ok(route, report(entries)), "GET");

const open = async (page: Page) => {
  await page.goto(URL_);
  await page.getByTestId("addons-issues-tab").waitFor({ state: "visible", timeout: 30_000 });
};

const base = { stubs: [HEALTH], open, root: (page: Page) => page.getByTestId("addons-issues-tab") };

const OK = { source: "npm:fine", status: "ok" };

export const packageHealthStates: UiState[] = [
  {
    id: "stale",
    label: "stale npm entries",
    ...base,
    install: health([{ source: "npm:gone-1", status: "stale-npm", reason: "not installed" }, { source: "npm:gone-2", status: "stale-npm", reason: "not installed" }, OK]),
  },
  {
    id: "missing",
    label: "missing local path",
    ...base,
    install: health([{ source: "/Users/dev/dead-checkout", status: "missing-path", reason: "directory does not exist" }, OK]),
  },
  {
    id: "duplicate",
    label: "four-member duplicate group",
    ...base,
    install: health(
      ["/a/pkg", "/b/pkg", "/c/pkg", "npm:pkg"].map((source, i) => ({
        source,
        status: i === 0 ? "missing-path" : "duplicate",
        duplicateGroupId: "dup:pkg",
        packageName: "pkg",
        reason: "same package name as 3 other entries",
      })),
    ),
  },
  { id: "clean", label: "no issues", ...base, install: health([OK]) },
];
