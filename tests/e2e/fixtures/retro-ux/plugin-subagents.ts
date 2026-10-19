import type { UiState } from "../../helpers/ui-capture.js";
import { bodyState, patchConfig } from "./plugin-page.js";

/**
 * Subagent Inspector settings state, reached by patching the real
 * `GET /api/config` (`plugins.subagents.inheritContext`).
 * See change: retro-ux-plugin-settings-wave-2.
 */
export const subagentsStates: UiState[] = [
  bodyState("subagents", {
    id: "default",
    label: "share the parent conversation",
    stubs: ["/api/config"],
    install: patchConfig("subagents", { inheritContext: true }),
    ready: (page) => page.getByTestId("subagents-inherit-context"),
  }),
];
