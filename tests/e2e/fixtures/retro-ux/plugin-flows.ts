import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfig } from "./plugin-page.js";

/**
 * Flows settings state, reached by patching the real `GET /api/config`
 * (`plugins.flows.editFlow`). See change: retro-ux-plugin-settings-wave-2.
 */
export const flowsStates: UiState[] = [
  bodyState("flows", {
    id: "default",
    label: "edit mode on",
    stubs: ["/api/config"],
    install: patchConfig("flows", { editFlow: true }),
    ready: (page) => page.getByTestId("flows-edit-mode-toggle"),
  }),
];
