import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, chromeOf, patchConfig, pluginPath, patchRow } from "./plugin-page.js";

/**
 * Host chrome (`PluginSettingsPage`) states: the card above every plugin body,
 * the back link and the disabled notice. Each state patches one row of the real
 * `GET /api/plugins` answer. "Developer internals" is the per-browser
 * `pi-dashboard:show-plugin-internals` preference, so it runs LAST (the key
 * outlives the reload). See change: retro-ux-plugin-settings-wave-2.
 */

const ROWS = ["/api/plugins"];
const INTERNALS_KEY = "pi-dashboard:show-plugin-internals";

const visit = (id: string, waitFor: (page: Page) => ReturnType<Page["getByTestId"]>) => async (page: Page) => {
  // Always navigate: consecutive states share a path, and the patched
  // `/api/plugins` row is only read on load.
  await page.goto(pluginPath(id));
  await waitFor(page).waitFor({ state: "visible", timeout: 30_000 });
};

export const hostChromeStates: UiState[] = [
  {
    id: "full-enabled",
    label: "healthy plugin, enabled",
    stubs: ROWS,
    install: patchRow("flows", () => {}),
    open: visit("flows", chromeOf),
    root: chromeOf,
  },
  {
    id: "missing-requirement",
    label: "enabled, a required path is missing (apple-tools)",
    stubs: ROWS,
    install: patchRow("apple-tools", (row) => {
      row.status = {
        ...(row.status ?? {}),
        enabled: true,
        loaded: true,
        requirements: { piExtensions: [], binaries: [], services: [], paths: [{ name: "/Applications/iMCP.app/Contents/MacOS/imcp-server", satisfied: false }] },
        missingRequirements: ["/Applications/iMCP.app/Contents/MacOS/imcp-server"],
      };
    }),
    open: visit("apple-tools", (page) => page.getByTestId("plugin-page-missing-requirements")),
    root: chromeOf,
  },
  {
    id: "disabled",
    label: "plugin switched off, disabled notice in place of the body",
    stubs: [...ROWS, "/api/config"],
    // The client seeds `enabled` from the persisted config (`usePluginList`),
    // which wins over the runtime row — patch both.
    install: all(
      patchRow("flows", (row) => {
        row.status = { ...(row.status ?? {}), enabled: false, loaded: false };
      }),
      patchConfig("flows", { enabled: false }),
    ),
    open: visit("flows", (page) => page.getByTestId("plugin-page-disabled-notice")),
    root: (page) => page.getByTestId("plugin-settings-page-flows"),
  },
  {
    id: "load-failed-internals",
    label: "failed to load, with Developer ▸ Show plugin internals on",
    stubs: ROWS,
    install: patchRow("goal", (row) => {
      row.status = { ...(row.status ?? {}), enabled: true, loaded: false, error: "Bridge path conflict: goal cannot load" };
    }),
    open: async (page) => {
      await page.evaluate((key) => localStorage.setItem(key, "true"), INTERNALS_KEY);
      await page.goto(pluginPath("goal"));
      await page.getByTestId("plugin-page-internals").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("plugin-page-internals").evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });
    },
    root: chromeOf,
  },
];
