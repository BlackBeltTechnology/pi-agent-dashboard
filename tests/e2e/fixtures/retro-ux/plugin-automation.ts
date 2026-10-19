import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfigs } from "./plugin-page.js";

/**
 * Automations settings states: config from the real `GET /api/config` patched
 * (`plugins.automation`, plus the model catalogue the picker reads from
 * `plugins.roles.models`). See change: retro-ux-plugin-settings-wave-2.
 */

const CONFIG = ["/api/config"];
const ready = (page: Page) => page.getByTestId("automation-plugin-settings");

const MODELS = [
  { provider: "openrouter", id: "google/gemini-2.5-flash-lite" },
  { provider: "openrouter", id: "openai/gpt-4o-mini" },
];

export const automationStates: UiState[] = [
  bodyState("automation", {
    id: "populated",
    label: "non-default values, models available",
    stubs: CONFIG,
    install: patchConfigs({
      automation: { defaultVisibility: "shown", retentionPerAutomation: 25, defaultModel: "openrouter/google/gemini-2.5-flash-lite" },
      roles: { models: MODELS },
    }),
    ready,
  }),
  bodyState("automation", {
    id: "no-models",
    label: "no models available",
    stubs: CONFIG,
    install: patchConfigs({ roles: { models: [] } }),
    ready: (page) => page.getByTestId("automation-default-model"),
  }),
];
