/**
 * craft-web plugin client barrel — deliberately light: only the i18n catalog is imported
 * eagerly by the generated plugin registry. The claim components live in `./handlers.tsx`
 * (manifest `claims[].module`) and load on first render.
 * See change: edit-office-in-pane-with-craft-web.
 */
export { catalog } from "../i18n.js";
