/**
 * Client entry barrel for the web-access plugin.
 *
 * Exports every name the manifest claims reference (`WebSearchEntryCard`) plus
 * the i18n catalog. The generated plugin registry imports these by name.
 *
 * See change: render-unclaimed-custom-entries.
 */
export { catalog } from "../i18n.js";
export { WebSearchEntryCard } from "./WebSearchEntryCard.js";
