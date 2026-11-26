/**
 * Single entry the bridge imports for the sudo credential prompt.
 * See change: add-sudo-credential-prompt.
 */

export { createSudoAskpass } from "./controller.js";
export type { SudoAskpass, SudoAskpassDeps } from "./controller.js";
export { createInFlightTracker } from "./in-flight.js";
export type { InFlightTracker } from "./in-flight.js";
export { buildPromptDisplay, escapePromptText } from "./prompt-text.js";
export { createSudoConfigReader } from "./config-reader.js";
