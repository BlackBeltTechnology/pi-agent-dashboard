/**
 * craft-web claim components: one per claimed app, each a thin binding of the generic `CraftFrameHost`
 * to its app-table row (GridCraft/DeckCraft add theirs when their spike passes). Lives in its own
 * module so the manifest's lazy-claim `module` keeps `CraftFrameHost`, the frame protocol and the
 * message catalogs off the dashboard's cold landing chunk.
 * See change: edit-office-in-pane-with-craft-web.
 */
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { CraftFrameHost } from "./CraftFrameHost.js";
import { CRAFT_WEB_APPS } from "./craft-apps-table.js";

export function WordCraftHandler(props: FileHandlerProps) {
  return <CraftFrameHost app={CRAFT_WEB_APPS.wordcraft} {...props} />;
}
