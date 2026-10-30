import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, json } from "./plugin-page.js";
import { stubApi } from "./stubs.js";

/**
 * Flows settings state. The edit-mode toggle reads the global pi settings
 * through `GET /api/plugins/flows/edit-mode-default` (no longer plugin
 * config), so the "on" state stubs that route.
 * See change: retro-ux-plugin-settings-wave-2; stop-flows-edit-mode-project-writes.
 */
export const flowsStates: UiState[] = [
  bodyState("flows", {
    id: "default",
    label: "edit mode on",
    stubs: ["/api/plugins/flows/edit-mode-default"],
    install: (page) => stubApi(page, "/api/plugins/flows/edit-mode-default", (route) => json(route, { enabled: true }), "GET"),
    ready: (page) => page.getByTestId("flows-edit-mode-toggle"),
  }),
];
