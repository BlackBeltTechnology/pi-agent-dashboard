/**
 * Dashboard built-ins plugin — client entry barrel.
 *
 * Re-exports every component referenced by the plugin manifest's
 * `claims[]` array. Each export name MUST match the `component` field
 * exactly so the vite-plugin's named-import generator can find it.
 *
 * See change: fix-pi-flows-end-to-end (Group 5).
 */

export { catalog } from "./i18n.js";
export { BuiltInRolesSettings } from "./RolesSettingsSection.js";
