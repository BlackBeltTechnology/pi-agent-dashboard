/**
 * Effect registry — GENERATED corpus index. Each entry pairs a metadata card
 * with its module factory (design D9).
 */

import { create as accent_cycle } from "./accent-cycle.js";
import accent_cycleCard from "./accent-cycle.meta.json";
import { create as aurora } from "./aurora.js";
import auroraCard from "./aurora.meta.json";
import { create as bloom } from "./bloom.js";
import bloomCard from "./bloom.meta.json";
import { create as camera_drift } from "./camera-drift.js";
import camera_driftCard from "./camera-drift.meta.json";
import { create as chromatic_aberration } from "./chromatic-aberration.js";
import chromatic_aberrationCard from "./chromatic-aberration.meta.json";
import { create as constellation } from "./constellation.js";
import constellationCard from "./constellation.meta.json";
import { create as dashed_flow } from "./dashed-flow.js";
import dashed_flowCard from "./dashed-flow.meta.json";
import { create as data_columns } from "./data-columns.js";
import data_columnsCard from "./data-columns.meta.json";
import { create as depth_of_field } from "./depth-of-field.js";
import depth_of_fieldCard from "./depth-of-field.meta.json";
import { create as dolly } from "./dolly.js";
import dollyCard from "./dolly.meta.json";
import { create as emissive } from "./emissive.js";
import emissiveCard from "./emissive.meta.json";
import { create as fade } from "./fade.js";
import fadeCard from "./fade.meta.json";
import { create as film } from "./film.js";
import filmCard from "./film.meta.json";
import { create as float } from "./float.js";
import floatCard from "./float.meta.json";
import { create as flythrough } from "./flythrough.js";
import flythroughCard from "./flythrough.meta.json";
import { create as fog } from "./fog.js";
import fogCard from "./fog.meta.json";
import { create as glass } from "./glass.js";
import glassCard from "./glass.meta.json";
import { create as glow_tube } from "./glow-tube.js";
import glow_tubeCard from "./glow-tube.meta.json";
import { create as glyph_rain } from "./glyph-rain.js";
import glyph_rainCard from "./glyph-rain.meta.json";
import { create as god_rays } from "./god-rays.js";
import god_raysCard from "./god-rays.meta.json";
import { create as grid_horizon } from "./grid-horizon.js";
import grid_horizonCard from "./grid-horizon.meta.json";
import { create as hex_grid } from "./hex-grid.js";
import hex_gridCard from "./hex-grid.meta.json";
import { create as holo_fresnel } from "./holo-fresnel.js";
import holo_fresnelCard from "./holo-fresnel.meta.json";
import { create as iridescent } from "./iridescent.js";
import iridescentCard from "./iridescent.meta.json";
import { create as iris } from "./iris.js";
import irisCard from "./iris.meta.json";
import { create as lightformers } from "./lightformers.js";
import lightformersCard from "./lightformers.meta.json";
import { create as matcap } from "./matcap.js";
import matcapCard from "./matcap.meta.json";
import { create as metal } from "./metal.js";
import metalCard from "./metal.meta.json";
import { create as mirror_floor } from "./mirror-floor.js";
import mirror_floorCard from "./mirror-floor.meta.json";
import { create as n8ao } from "./n8ao.js";
import n8aoCard from "./n8ao.meta.json";
import { create as orbit } from "./orbit.js";
import orbitCard from "./orbit.meta.json";
import { create as particle_stream } from "./particle-stream.js";
import particle_streamCard from "./particle-stream.meta.json";
import { create as particles } from "./particles.js";
import particlesCard from "./particles.meta.json";
import { create as rings } from "./rings.js";
import ringsCard from "./rings.meta.json";
import { create as room_ibl } from "./room-ibl.js";
import room_iblCard from "./room-ibl.meta.json";
import { create as selective_bloom } from "./selective-bloom.js";
import selective_bloomCard from "./selective-bloom.meta.json";
import { create as signal_pulse } from "./signal-pulse.js";
import signal_pulseCard from "./signal-pulse.meta.json";
import { create as smaa } from "./smaa.js";
import smaaCard from "./smaa.meta.json";
import { create as soft_shadows } from "./soft-shadows.js";
import soft_shadowsCard from "./soft-shadows.meta.json";
import { create as stagger_reveal } from "./stagger-reveal.js";
import stagger_revealCard from "./stagger-reveal.meta.json";
import { create as starfield } from "./starfield.js";
import starfieldCard from "./starfield.meta.json";
import { create as swarm } from "./swarm.js";
import swarmCard from "./swarm.meta.json";
import { create as tokens } from "./tokens.js";
import tokensCard from "./tokens.meta.json";
import { create as trail } from "./trail.js";
import trailCard from "./trail.meta.json";
import type { FxCard, FxEntry } from "./types.js";
import { create as vignette } from "./vignette.js";
import vignetteCard from "./vignette.meta.json";
import { create as volumetric_spot } from "./volumetric-spot.js";
import volumetric_spotCard from "./volumetric-spot.meta.json";
import { create as wireframe_overlay } from "./wireframe-overlay.js";
import wireframe_overlayCard from "./wireframe-overlay.meta.json";

export const REGISTRY: Record<string, FxEntry> = {
  "tokens": { card: tokensCard as FxCard, create: tokens },
  "rings": { card: ringsCard as FxCard, create: rings },
  "swarm": { card: swarmCard as FxCard, create: swarm },
  "particles": { card: particlesCard as FxCard, create: particles },
  "bloom": { card: bloomCard as FxCard, create: bloom },
  "film": { card: filmCard as FxCard, create: film },
  "glass": { card: glassCard as FxCard, create: glass },
  "metal": { card: metalCard as FxCard, create: metal },
  "emissive": { card: emissiveCard as FxCard, create: emissive },
  "mirror-floor": { card: mirror_floorCard as FxCard, create: mirror_floor },
  "fog": { card: fogCard as FxCard, create: fog },
  "soft-shadows": { card: soft_shadowsCard as FxCard, create: soft_shadows },
  "room-ibl": { card: room_iblCard as FxCard, create: room_ibl },
  "signal-pulse": { card: signal_pulseCard as FxCard, create: signal_pulse },
  "dolly": { card: dollyCard as FxCard, create: dolly },
  "starfield": { card: starfieldCard as FxCard, create: starfield },
  "aurora": { card: auroraCard as FxCard, create: aurora },
  "grid-horizon": { card: grid_horizonCard as FxCard, create: grid_horizon },
  "hex-grid": { card: hex_gridCard as FxCard, create: hex_grid },
  "data-columns": { card: data_columnsCard as FxCard, create: data_columns },
  "glyph-rain": { card: glyph_rainCard as FxCard, create: glyph_rain },
  "constellation": { card: constellationCard as FxCard, create: constellation },
  "vignette": { card: vignetteCard as FxCard, create: vignette },
  "chromatic-aberration": { card: chromatic_aberrationCard as FxCard, create: chromatic_aberration },
  "depth-of-field": { card: depth_of_fieldCard as FxCard, create: depth_of_field },
  "god-rays": { card: god_raysCard as FxCard, create: god_rays },
  "n8ao": { card: n8aoCard as FxCard, create: n8ao },
  "selective-bloom": { card: selective_bloomCard as FxCard, create: selective_bloom },
  "smaa": { card: smaaCard as FxCard, create: smaa },
  "holo-fresnel": { card: holo_fresnelCard as FxCard, create: holo_fresnel },
  "wireframe-overlay": { card: wireframe_overlayCard as FxCard, create: wireframe_overlay },
  "iridescent": { card: iridescentCard as FxCard, create: iridescent },
  "matcap": { card: matcapCard as FxCard, create: matcap },
  "lightformers": { card: lightformersCard as FxCard, create: lightformers },
  "accent-cycle": { card: accent_cycleCard as FxCard, create: accent_cycle },
  "volumetric-spot": { card: volumetric_spotCard as FxCard, create: volumetric_spot },
  "float": { card: floatCard as FxCard, create: float },
  "orbit": { card: orbitCard as FxCard, create: orbit },
  "stagger-reveal": { card: stagger_revealCard as FxCard, create: stagger_reveal },
  "trail": { card: trailCard as FxCard, create: trail },
  "camera-drift": { card: camera_driftCard as FxCard, create: camera_drift },
  "dashed-flow": { card: dashed_flowCard as FxCard, create: dashed_flow },
  "glow-tube": { card: glow_tubeCard as FxCard, create: glow_tube },
  "particle-stream": { card: particle_streamCard as FxCard, create: particle_stream },
  "fade": { card: fadeCard as FxCard, create: fade },
  "iris": { card: irisCard as FxCard, create: iris },
  "flythrough": { card: flythroughCard as FxCard, create: flythrough },
};

export const FX_IDS: string[] = Object.keys(REGISTRY);

export function cardFor(id: string): FxCard | undefined {
  return REGISTRY[id]?.card;
}
