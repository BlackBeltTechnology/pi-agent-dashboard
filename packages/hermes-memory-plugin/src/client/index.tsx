/**
 * Client entry barrel for the hermes-memory-plugin.
 *
 * Exports the settings-section component referenced by the
 * `pi-dashboard-plugin` manifest claim (name MUST match `component`) + the
 * i18n catalog. The generated plugin-registry imports these by name.
 *
 * See change: add-hermes-memory-settings-plugin.
 */

export { catalog } from "../i18n.js";
export { HermesMemorySettings } from "./HermesMemorySettings.js";
