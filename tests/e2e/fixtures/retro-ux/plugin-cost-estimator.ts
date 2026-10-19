import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfig } from "./plugin-page.js";

/**
 * Cost estimator settings states: config only, via the real `GET /api/config`
 * patched (`plugins.cost-estimator`). See change: retro-ux-plugin-settings-wave-2.
 */

const CONFIG = ["/api/config"];
const ready = (page: Page) => page.getByTestId("cost-settings");

export const costStates: UiState[] = [
  bodyState("cost-estimator", {
    id: "plan",
    label: "a stored subscription plan",
    stubs: CONFIG,
    install: patchConfig("cost-estimator", { seatPlan: "anthropic-max-5x", seats: 2, gapCapMinutes: 15 }),
    ready,
  }),
  bodyState("cost-estimator", {
    id: "custom-plan-invalid",
    label: "custom plan, Seats cleared (invalid, unsaved)",
    stubs: CONFIG,
    install: patchConfig("cost-estimator", { seatPlan: "custom", seatMonthlyUsd: 40, seats: 2, gapCapMinutes: 15 }),
    ready,
    extra: async (page) => {
      await page.getByTestId("cost-seats").fill("");
    },
  }),
];
