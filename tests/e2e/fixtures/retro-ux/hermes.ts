import type { Page, Route } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { hold, ok, stubApi } from "./stubs.js";

/**
 * Settings ▸ Plugins ▸ Hermes memory states, reached by answering
 * `GET /api/plugins/hermes-memory/config` (real response patched) and, for the
 * model-unavailable state, `GET /api/models`. See change: retro-ux-plugin-settings-forms.
 */

const CONFIG = "/api/plugins/hermes-memory/config";
const MODELS = "/api/models";
const PATH = "/settings/plugins/hermes-memory";

type Cfg = { exists: boolean; fields: Record<string, { value: unknown; default?: unknown; isDefault: boolean }> };

const patched = (patch: (cfg: Cfg) => void) => (page: Page) =>
  stubApi(
    page,
    CONFIG,
    async (route: Route) => {
      const res = await route.fetch();
      const cfg = (await res.json()) as Cfg;
      patch(cfg);
      await route.fulfill({ response: res, json: cfg });
    },
    "GET",
  );

const root = (page: Page) => page.getByTestId("hermes-root");
/** The raw-JSON dialog (the settings overlay is a dialog too, so name it). */
const dialog = (page: Page) => page.getByRole("dialog", { name: "Resolved configuration" });

/** Open every group so the probe sees every field (groups start collapsed). */
const goto = async (page: Page) => {
  await page.goto(PATH);
  await root(page).waitFor({ state: "visible", timeout: 30_000 });
  await root(page).evaluate((el) => {
    for (const d of el.querySelectorAll("details")) d.open = true;
  });
};

const populate = (cfg: Cfg) => {
  cfg.exists = true;
  cfg.fields.nudgeInterval = { value: 20, isDefault: false };
  cfg.fields.llmModelOverride = { value: "openrouter/deepseek/deepseek-v4-flash", isDefault: false };
};

export const hermesStates: UiState[] = [
  {
    id: "loading",
    label: "config request pending",
    stubs: [CONFIG],
    install: (page) => stubApi(page, CONFIG, hold, "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("hermes-loading").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("hermes-loading"),
  },
  {
    id: "load-error",
    label: "config file unreadable",
    stubs: [CONFIG],
    install: (page) => stubApi(page, CONFIG, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "ENOENT: no such file" }) }), "GET"),
    open: async (page) => {
      await page.goto(PATH);
      await page.getByTestId("hermes-load-error").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: (page) => page.getByTestId("hermes-load-error"),
  },
  { id: "populated", label: "overrides incl. an unlisted model", stubs: [CONFIG], install: patched(populate), open: goto, root },
  {
    id: "invalid-dirty",
    label: "non-number typed, unsaved",
    stubs: [CONFIG],
    install: patched(populate),
    open: async (page) => {
      await goto(page);
      // A number input rejects "abc"; clearing it is the same invalid state ("Enter a number").
      await page.getByTestId("hermes-input-memoryCharLimit").fill("");
      await page.locator('[data-testid="hermes-input-memoryCharLimit"][aria-invalid="true"]').waitFor({ state: "visible" });
    },
    root,
  },
  {
    id: "model-unavailable",
    label: "no models offered",
    stubs: [CONFIG, MODELS],
    install: async (page) => {
      await patched(populate)(page);
      await stubApi(page, MODELS, (route) => ok(route, [], { object: "list" }), "GET");
    },
    open: async (page) => {
      await goto(page);
      await page.getByTestId("hermes-no-models-llmModelOverride").waitFor({ state: "visible", timeout: 20_000 });
    },
    root,
  },
  {
    id: "raw-json",
    label: "raw-JSON dialog open",
    stubs: [CONFIG],
    install: patched(populate),
    open: async (page) => {
      await goto(page);
      await page.getByRole("button", { name: "View raw JSON" }).click();
      await dialog(page).waitFor({ state: "visible" });
    },
    root: dialog,
  },
];
