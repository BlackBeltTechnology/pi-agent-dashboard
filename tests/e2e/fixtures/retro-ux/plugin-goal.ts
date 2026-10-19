import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfig } from "./plugin-page.js";

/**
 * Goal settings state. The only setting lives in `localStorage`, so the stub is
 * the real config answer passed through (keeps the page hermetic).
 * See change: retro-ux-plugin-settings-wave-2.
 */
export const goalStates: UiState[] = [
  bodyState("goal", {
    id: "default",
    label: "auto-restart default, this browser",
    stubs: ["/api/config"],
    install: patchConfig("goal", {}),
    ready: (page) => page.getByTestId("goal-settings-browser-pill"),
  }),
];
