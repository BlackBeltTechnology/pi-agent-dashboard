/**
 * Live-control command lists of VectorCraft (design D4, D8): derived from `engine.commands` of the build
 * named by `VECTORCRAFT_CONTROL_VERSION` (task 1.1 re-spike, `docs/craft-web-plugin.md` §14.8). Host-side
 * only: the frame profile never carries them, so editing a list never forces a re-prepare.
 *
 * Rules: every id exists in the verified build's `engine.commands`; none runs scripts/batches/macros, opens
 * or imports a document, or closes/reverts/quits (`manifest.test.ts` pins the pattern); every read-only id
 * leaves the `document.inspect` digest unchanged (spike-verified).
 *
 * See change: add-craft-live-control (D4, D8, tasks 1.1, 2.1).
 */

/** The upstream web build these lists were verified against (must equal the registry `webVersion`). */
export const VECTORCRAFT_CONTROL_VERSION = "0.16.0";

/** `engine.execute` commands an agent may run: edit, selection, style, layout and the two save commands. */
export const VECTORCRAFT_ALLOWED_COMMANDS: readonly string[] = [
  "shape.rectangle", "shape.ellipse", "shape.polygon", "shape.star", "shape.line", "shape.arc", "shape.spiral",
  "text.create", "text.setText", "text.setStyle", "text.setRangeStyle", "path.create", "path.appendAnchor",
  "path.moveAnchors", "path.setAnchors", "path.reverse", "path.join", "select.all", "select.none", "select.set",
  "select.add", "select.toggle", "select.inverse", "select.allOnArtboard", "object.move", "object.rotate",
  "object.scale", "object.reflect", "object.shear", "object.transform", "object.nudge", "object.setProps",
  "object.setBounds", "object.group", "object.ungroup", "object.lock", "object.hide", "object.unlockAll",
  "object.showAll", "object.arrange.bringToFront", "object.arrange.bringForward", "object.arrange.sendBackward",
  "object.arrange.sendToBack", "object.align", "object.distribute", "object.pathfinder.unite",
  "object.pathfinder.minusFront", "object.pathfinder.intersect", "object.pathfinder.exclude",
  "object.pathfinder.divide", "object.pathfinder.trim", "object.pathfinder.merge", "object.pathfinder.crop",
  "object.pathfinder.outline", "object.pathfinder.minusBack", "object.compoundPath.make",
  "object.compoundPath.release", "object.clippingMask.make", "object.clippingMask.release", "paint.setFill",
  "paint.setStroke", "paint.swap", "paint.none", "paint.default", "stroke.set", "stroke.setAdvanced",
  "transparency.set", "appearance.addFill", "appearance.addStroke", "layer.setProps", "layer.setCurrent",
  "layer.move", "layer.duplicate", "artboard.setProps", "artboard.move", "edit.undo", "edit.redo", "edit.clear",
  "edit.duplicate", "file.save", "file.export.svg", "document.info", "document.node", "document.find",
  "document.formats", "document.json", "text.getRange", "text.fonts", "text.fontList", "stroke.widthProfile.list",
  "transparency.info", "transparency.opacityMaskInfo", "object.blend.info", "text.thread.info", "text.tabs.get",
  "paint.recent",
];

/** Pure queries inside the allowlist: leave the document unchanged, so they never mark the tab unsaved. */
export const VECTORCRAFT_READ_ONLY_COMMANDS: readonly string[] = [
  "document.info", "document.node", "document.find", "document.formats", "document.json", "text.getRange",
  "text.fonts", "text.fontList", "stroke.widthProfile.list", "transparency.info", "transparency.opacityMaskInfo",
  "object.blend.info", "text.thread.info", "text.tabs.get", "paint.recent",
];

/** Save / export commands: `file.save` opens the in-app Save As; `file.export.svg` with params writes the own `.svg` at once. */
export const VECTORCRAFT_SAVE_COMMANDS: readonly string[] = ["file.save", "file.export.svg"];
