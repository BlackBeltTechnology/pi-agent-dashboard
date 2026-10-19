/**
 * craft-web plugin client barrel. Claim components are named exports matching the
 * manifest `component` names (the plugin registry imports by name): one per app, each a
 * thin binding of the generic `CraftFrameHost` to its app-table row. The default export
 * picks the app from the tab's extension (generic slot component).
 * See change: edit-office-in-pane-with-craft-web.
 */
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { CraftFrameHost } from "./CraftFrameHost.js";
import { appForPath, CRAFT_WEB_APPS } from "./craft-apps-table.js";

export { catalog } from "../i18n.js";
export { CraftFrameHost } from "./CraftFrameHost.js";
export { CRAFT_WEB_APPS } from "./craft-apps-table.js";

export function WordCraftHandler(props: FileHandlerProps) {
  return <CraftFrameHost app={CRAFT_WEB_APPS.wordcraft} {...props} />;
}

export function GridCraftHandler(props: FileHandlerProps) {
  return <CraftFrameHost app={CRAFT_WEB_APPS.gridcraft} {...props} />;
}

export function DeckCraftHandler(props: FileHandlerProps) {
  return <CraftFrameHost app={CRAFT_WEB_APPS.deckcraft} {...props} />;
}

/** Generic slot component: the app is derived from the tab's extension. */
export default function CraftFileHandler(props: FileHandlerProps) {
  const app = appForPath(props.path);
  // An unknown extension reaches here only through a stale claim: render the fail-closed gate.
  return <CraftFrameHost app={app ?? { id: "unknown", label: "Craft", extension: "", maxBytes: 0 }} {...props} />;
}
