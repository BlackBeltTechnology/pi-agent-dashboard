/**
 * Effect corpus types — one interface every effect module implements, plus the
 * metadata card schema (design D9). Cards are the LLM's typed catalogue.
 */
import type * as THREE from "three";
import type { PaletteColors } from "../runtime/palette.js";
import type { QualityProfile } from "../runtime/quality.js";

export type FxKind = "background" | "post" | "material" | "light" | "motion" | "edge" | "transition";
export type FxMode = "dark" | "light" | "both";

export type FxParams = Record<string, number | string | boolean>;

export interface FxCard {
  id: string;
  kind: FxKind;
  tags: { mood: string[]; content: string[] };
  cost: number;
  modes: FxMode;
  /** JSON Schema (object) for the effect's `params`. */
  params: Record<string, unknown>;
  conflicts: string[];
  source: string;
  licence: string;
}

export interface FxContext {
  THREE: typeof THREE;
  palette: PaletteColors;
  mode: "dark" | "light";
  quality: QualityProfile;
}

export interface FxHandle {
  object?: THREE.Object3D;
  /** A composer pass id (post effects) or other runtime hook name. */
  pass?: string;
  material?: THREE.Material;
  tick?: (t: number) => void;
  dispose: () => void;
}

export type FxFactory = (ctx: FxContext, params: FxParams) => FxHandle;

export interface FxEntry {
  card: FxCard;
  create: FxFactory;
}

/** SPDX ids the corpus admits (design D9). */
export const PERMISSIVE_LICENCES = ["MIT", "Zlib", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "Apache-2.0", "OFL-1.1"] as const;
