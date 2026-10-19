import type { Page } from "@playwright/test";
import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfig } from "./plugin-page.js";

/**
 * Provider Quota settings states: config only, from the real `GET /api/config`
 * patched (`plugins.quota`). Per-provider status pills ("Signed in", "Request
 * refused") arrive over the dashboard WebSocket and are not faked here.
 * See change: retro-ux-plugin-settings-wave-2.
 */

const CONFIG = ["/api/config"];
const ready = (page: Page) => page.getByTestId("quota-settings");

export const quotaStates: UiState[] = [
  bodyState("quota", {
    id: "populated",
    label: "tracking on, two providers ticked",
    stubs: CONFIG,
    install: patchConfig("quota", { enabled: true, providers: { anthropic: { enabled: true }, "github-copilot": { enabled: true } } }),
    ready,
  }),
  bodyState("quota", {
    id: "retries-on",
    label: "retry policy on with a schedule preview",
    stubs: CONFIG,
    install: patchConfig("quota", {
      enabled: true,
      providers: { anthropic: { enabled: true } },
      retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 },
    }),
    ready: (page) => page.getByTestId("quota-retry-preview"),
  }),
];
