// craft-web format-validator DISPATCHER (D7). Registered once per edit claim (`server/index.ts`), run in the
// core validator worker pool (plain ESM, node built-ins only). `validate(bytes, ext)` routes on the
// extension and rejects any extension without a route; claim membership of `ext` is enforced by core
// before the module runs. Every check is reject-only and bounded.
// See change: extend-craft-web-to-all-apps.
import { validateDwg } from "./dwg.mjs";
import { validateDxf } from "./dxf.mjs";
import { validateFcproj } from "./fcproj.mjs";
import { validateOdfText } from "./odf-text.mjs";
import { validate as validateOoxml } from "./ooxml.mjs";
import { validatePdf } from "./pdf.mjs";
import { validatePsd } from "./psd.mjs";
import { RASTER_EXTENSIONS, validateRaster } from "./raster.mjs";
import { validateRtf } from "./rtf.mjs";
import { validateSvg } from "./svg.mjs";
import { validateVectorcraft } from "./vectorcraft.mjs";
import { validateZipMembers } from "./zip-members.mjs";

/**
 * Extension → check. The drift test pins every claimed edit + sibling extension to a route (claim → route,
 * one way). `.odt`, `.rtf` and `.dwg` are reserved: their fixture spikes failed (design.md, Implementation
 * findings), so no claim routes to them until a follow-up adds them.
 */
export const ROUTES = {
  ".docx": validateOoxml,
  ".xlsx": validateOoxml,
  ".pptx": validateOoxml,
  ".odt": validateOdfText,
  ".rtf": validateRtf,
  ".pdf": validatePdf,
  ".dxf": validateDxf,
  ".dwg": validateDwg,
  ".designcraft": validateZipMembers,
  ".scraftz": validateZipMembers,
  ".deckcraft": validateZipMembers,
  ".psd": validatePsd,
  ...Object.fromEntries(RASTER_EXTENSIONS.map((e) => [e, validateRaster])),
  ".svg": validateSvg,
  ".vectorcraft": validateVectorcraft,
  ".fcproj": validateFcproj,
};

/**
 * @param {Uint8Array} bytes the document about to be written
 * @param {string} ext lower-case extension with leading dot
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validate(bytes, ext) {
  const route = Object.hasOwn(ROUTES, ext) ? ROUTES[ext] : undefined;
  if (!route) return { ok: false, reason: `unsupported extension ${String(ext)}` };
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, reason: "empty document" };
  return route(bytes, ext);
}
