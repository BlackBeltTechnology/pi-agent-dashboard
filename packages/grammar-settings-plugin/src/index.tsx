/**
 * Grammar-settings plugin — client entry barrel.
 *
 * Re-exports every component referenced by the plugin manifest's `claims[]`
 * array plus the i18n `catalog`. Each export name MUST match the manifest
 * `component` / `i18nCatalog` field exactly so the vite-plugin's named-import
 * generator can resolve it.
 *
 * See change: add-grammar-settings-plugin.
 */

export { GrammarComposerPanel } from "./GrammarComposerPanel.js";
export { GrammarSettings } from "./GrammarSettings.js";
export { catalog } from "./i18n.js";
