/**
 * Canonical deck-level defaults. Mirrors the `default` keywords in
 * `schema.json`; `parse` merges front-matter over this so a bare deck is fully
 * specified and `derivedHash` is stable.
 */
import type { Defaults } from "./types.js";

export const DECK_DEFAULTS: Required<
  Pick<
    Defaults,
    | "mode"
    | "palette"
    | "material"
    | "envReflections"
    | "mirrorFloor"
    | "softShadows"
    | "bloom"
    | "rimLight"
    | "fog"
    | "backgroundIntensity"
    | "transition"
    | "durationSec"
    | "depthRelief"
    | "quality"
    | "extrudeDepth"
    | "titleEdge"
    | "camera"
    | "labels"
    | "check"
  >
> = {
  mode: "dark",
  palette: "blackbelt",
  material: "glass",
  envReflections: true,
  mirrorFloor: true,
  softShadows: true,
  bloom: true,
  rimLight: true,
  fog: true,
  backgroundIntensity: 0.7,
  transition: "dolly",
  durationSec: 1.4,
  depthRelief: 0.7,
  quality: "high",
  extrudeDepth: 0.18,
  titleEdge: "none",
  camera: { distance: 9 },
  labels: { size: 0.28 },
  check: { ignore: [] },
};

/** Merge front-matter (or override) defaults over the canonical defaults. */
export function resolveDefaults(partial: Defaults | undefined): Defaults {
  return {
    ...DECK_DEFAULTS,
    ...partial,
    camera: { ...DECK_DEFAULTS.camera, ...partial?.camera },
    labels: { ...DECK_DEFAULTS.labels, ...partial?.labels },
    check: { ...DECK_DEFAULTS.check, ...partial?.check },
  };
}
