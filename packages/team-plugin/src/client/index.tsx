/**
 * Client entry barrel for the team plugin: the `sidebar-folder-section` slot
 * component referenced by the manifest + the i18n catalog. The embedded app
 * claims (`shell-overlay-route` presentation "content") arrive with
 * `add-plugin-app-host`; until then the folder entry opens the standalone app.
 * See change: add-team-plugin.
 */
export { catalog } from "../i18n.js";
export { FolderTeamSection } from "./FolderTeamSection.js";
