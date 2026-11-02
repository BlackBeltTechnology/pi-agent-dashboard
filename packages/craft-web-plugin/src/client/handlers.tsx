/**
 * craft-web claim components: one per manifest claim, each a thin binding of the generic `CraftFrameHost`
 * to its claim row (`craft-apps-table.ts`, projected from the adapter profiles). Lives in its own module so
 * the manifest's lazy-claim `module` keeps `CraftFrameHost`, the frame protocol and the message catalogs
 * off the dashboard's cold landing chunk. `manifest.test.ts` pins every claim's `component` to an export here.
 * See change: edit-office-in-pane-with-craft-web, extend-craft-web-to-all-apps (D1).
 */
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { CraftFrameHost } from "./CraftFrameHost.js";
import { CRAFT_WEB_APPS } from "./craft-apps-table.js";

/** Claim component bound to claim `claimId`. */
function bind(claimId: string) {
  const Handler = (props: FileHandlerProps) => <CraftFrameHost app={CRAFT_WEB_APPS[claimId]} {...props} />;
  Handler.displayName = `CraftHandler(${claimId})`;
  return Handler;
}

export const WordCraftHandler = bind("wordcraft");
export const GridCraftHandler = bind("gridcraft");
export const PdfCraftHandler = bind("pdfcraft");
export const FilmCraftHandler = bind("filmcraft");
export const CADCraftHandler = bind("cadcraft");
export const DesignCraftHandler = bind("designcraft");
export const SoundCraftHandler = bind("soundcraft");
export const PhotoCraftHandler = bind("photocraft");
export const PhotoCraftRasterHandler = bind("photocraft-raster");
export const VectorCraftHandler = bind("vectorcraft");
export const DeckCraftHandler = bind("deckcraft");
export const DeckCraftNativeHandler = bind("deckcraft-native");
export const LightCraftHandler = bind("lightcraft");
/** Test fixture (add-craft-live-control D8): live only when the server runs with PI_DASHBOARD_FIXTURE_PLUGINS=1. */
export const FakeCraftHandler = bind("fakecraft");
