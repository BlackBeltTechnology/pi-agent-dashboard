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

/**
 * Closed topic vocabulary (design D3). `parse` routes a content slide to the
 * cheapest `background` card carrying the matched topic, so the list is a
 * contract between the keyword table and the corpus — not free-form like
 * `tags.content`.
 */
export const FX_TOPICS = [
  "ai",
  "agents",
  "geo",
  "trust",
  "security",
  "compute",
  "data",
  "money",
  "work",
  "timeline",
  "sales",
  "process",
] as const;
export type FxTopic = (typeof FX_TOPICS)[number];

export interface FxCard {
  id: string;
  kind: FxKind;
  tags: { mood: string[]; content: string[]; topic?: FxTopic[] };
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
  /** Seeded LCG — the only randomness an effect may use (keeps render deterministic). */
  rng: () => number;
  /** Read-only metadata of the slide the effect is being built for. */
  slide: { id: string; title: string; kind: string };
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
