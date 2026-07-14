/**
 * Client entry barrel for the kb-plugin.
 *
 * Exports the slot components referenced by the `pi-dashboard-plugin` manifest
 * claims. The generated plugin-registry imports these by name.
 * See change: add-kb-folder-slot.
 */
export { catalog } from "../i18n.js";
export { FolderKbSection } from "./FolderKbSection.js";
export { KbSettingsClaim } from "./KbSettingsClaim.js";
