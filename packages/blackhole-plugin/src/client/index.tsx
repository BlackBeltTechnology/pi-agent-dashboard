/**
 * Client entry barrel for the blackhole-plugin.
 *
 * Exports every name the manifest claims reference (the name MUST match the
 * manifest's `component`/`shouldRender`/`predicate` strings) plus the i18n
 * catalog. The generated plugin registry imports these by name.
 *
 * The module-scope boot check kicks off here — GUARDED so it never runs under
 * vitest/jsdom (F4): in tests the import must issue no network request, while
 * `resolveInstalled` stays explicitly invokable with an injected fetch. See
 * installed-gate.ts for the guard's design (D4).
 *
 * See change: add-blackhole-plugin, add-blackhole-session-pipeline.
 */

import { isTestEnvironment, resolveInstalled } from "./installed-gate.js";

if (!isTestEnvironment()) {
  resolveInstalled();
}

export { catalog } from "../i18n.js";
export { BlackholeSettings } from "./BlackholeSettings.js";
export { MemorySubcard } from "./MemorySubcard.js";
export { PipelineDetailView } from "./PipelineDetailView.js";
export { shouldRenderMemorySubcard } from "./installed-gate.js";
export { isPipelineDetailActive } from "./detail-navigation.js";
