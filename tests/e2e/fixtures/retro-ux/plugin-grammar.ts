import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { all, bodyOf, bodyState, json, patchConfig, pluginPath } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Grammar & Spelling settings states: config from the real `GET /api/config`
 * patched (`plugins.grammar`), the model list from `GET /api/models`.
 * See change: retro-ux-plugin-settings-wave-2.
 */

const MODELS = "/api/models";
/** Toggled by the load-error state's `open` only. */
let failConfig = false;
const LLM = { provider: "openrouter", model: "google/gemini-2.5-flash-lite" };

const models = (page: Page) =>
  stubApi(
    page,
    MODELS,
    (route) =>
      json(route, {
        data: [
          { id: "openrouter/google/gemini-2.5-flash-lite", provider: "openrouter" },
          { id: "openrouter/openai/gpt-4o-mini", provider: "openrouter" },
        ],
      }),
    "GET",
  );

const settled = (page: Page) => page.getByTestId("grammar-group-checking");

export const grammarStates: UiState[] = [
  bodyState("grammar", {
    id: "populated",
    label: "enabled with a chosen model",
    stubs: ["/api/config", MODELS],
    install: all(patchConfig("grammar", { enabled: true, llm: LLM }), models),
    ready: settled,
  }),
  bodyState("grammar", {
    id: "no-model",
    label: "enabled, no model chosen",
    stubs: ["/api/config", MODELS],
    install: all(patchConfig("grammar", { enabled: true }), models),
    ready: (page) => page.getByTestId("grammar-model-required"),
  }),
  bodyState("grammar", {
    id: "invalid-advanced",
    label: "Wait after typing cleared (invalid)",
    stubs: ["/api/config", MODELS],
    install: all(patchConfig("grammar", { enabled: true, llm: LLM }), models),
    ready: settled,
    extra: async (page) => {
      await page.getByTestId("grammar-debounce").fill("");
    },
  }),
  {
    id: "load-error",
    label: "config request fails when the settings body mounts",
    stubs: ["/api/config"],
    install: (page) =>
      stubApi(
        page,
        "/api/config",
        (route) => (failConfig ? json(route, { error: "boom" }, 500) : route.fallback()),
        "GET",
      ),
    // Boot on another plugin page with the app's own config read healthy, then fail the
    // read and reach Grammar through the rail (same document), so only the body's read breaks.
    open: async (page) => {
      failConfig = false;
      await page.goto(pluginPath("flows"));
      await page.getByTestId("plugin-page-body-flows").waitFor({ state: "visible", timeout: 30_000 });
      failConfig = true;
      await page.getByTestId("settings-nav-rail").getByTestId("nav-plugin-grammar").click();
      await page.getByTestId("grammar-load-error").waitFor({ state: "visible", timeout: 30_000 });
    },
    root: bodyOf("grammar"),
  },
];
