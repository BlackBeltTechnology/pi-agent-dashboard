import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { hold, stubApi } from "./stubs.js";

/**
 * Settings ▸ Plugins ▸ Context-mode states, reached by answering
 * `GET /api/plugins/context-mode-settings/config` (real response patched, so the
 * descriptor table stays the server's). See change: retro-ux-plugin-settings-forms.
 */

const CONFIG = "/api/plugins/context-mode-settings/config";
const PATH = "/settings/plugins/context-mode-settings";

type Patch = (cfg: { exists: boolean; fields: Record<string, { value: unknown; isDefault: boolean }> }) => void;

/** Fetch the real answer, patch it, fulfil. */
const patched = (patch: Patch) => (page: Page) =>
  stubApi(
    page,
    CONFIG,
    async (route: Route) => {
      const res = await route.fetch();
      const cfg = (await res.json()) as Parameters<Patch>[0];
      patch(cfg);
      await route.fulfill({ response: res, json: cfg });
    },
    "GET",
  );

const root = (page: Page) => page.getByTestId("cms-root");
const goto = async (page: Page) => {
  await page.goto(PATH);
  await root(page).waitFor({ state: "visible", timeout: 30_000 });
};

const override = (cfg: Parameters<Patch>[0]) => {
  cfg.exists = true;
  cfg.fields["search.maxResultsAfter"] = { value: 5, isDefault: false };
};

export const contextModeStates: UiState[] = [
  {
    id: "loading",
    label: "config request pending",
    stubs: [CONFIG],
    install: (page) => stubApi(page, CONFIG, hold, "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("cms-loading").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("cms-loading"),
  },
  {
    id: "load-error",
    label: "config request fails",
    stubs: [CONFIG],
    install: (page) => stubApi(page, CONFIG, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }), "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("cms-load-error").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("cms-load-error"),
  },
  { id: "populated", label: "one overridden field", stubs: [CONFIG], install: patched(override), open: goto, root },
  {
    id: "not-created",
    label: "settings file not yet created",
    stubs: [CONFIG],
    install: patched((cfg) => {
      cfg.exists = false;
    }),
    open: goto,
    root,
  },
  {
    id: "invalid-dirty",
    label: "invalid value typed, unsaved",
    stubs: [CONFIG],
    install: patched(override),
    open: async (page) => {
      await goto(page);
      await page.getByTestId("cms-input-search.maxResultsAfter").fill("-2");
      await page.getByTestId("cms-error-search.maxResultsAfter").waitFor({ state: "visible" });
    },
    root,
  },
];
