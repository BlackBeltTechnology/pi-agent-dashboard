/**
 * Client entry barrel for the blackhole-plugin.
 *
 * Exports the settings-section component referenced by the `pi-dashboard-plugin`
 * manifest claim (the name MUST match `component`) plus the i18n catalog. The
 * generated plugin registry imports these by name.
 *
 * See change: add-blackhole-plugin.
 */

export { catalog } from "../i18n.js";
export { BlackholeSettings } from "./BlackholeSettings.js";
