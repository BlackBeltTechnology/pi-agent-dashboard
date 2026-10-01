/**
 * Built-in catalog of known System-1 models (spec: system-one-settings-ui,
 * "Backend catalog with capability metadata"). A backend whose `model` (http)
 * or `engine` + `checkpoint` (managed) matches an entry inherits its
 * capabilities, `keyRef` and price, unless overridden in config.
 * `languages`: `multi` = any language. See change: add-system-one-registry.
 */
import type { Backend, Capabilities, Primitive } from "./types.js";

const ALL: Primitive[] = ["choice", "score", "noul"];

export interface CatalogEntry {
  model: string;
  capabilities: Required<Capabilities>;
  /** Display label for the language column. */
  languageLabel: string;
  hosted: boolean;
  keyRef?: string;
  priceUsdPerMTok?: number;
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    model: "jev-1.13.0",
    capabilities: { maxContextTokens: 32_000, maxOptions: 255, languages: ["en", "multi"], primitives: ALL },
    languageLabel: "en-first",
    hosted: true,
    keyRef: "TYPESAFE_API_KEY",
    priceUsdPerMTok: 0.042,
  },
  { model: "von-1.2", capabilities: { maxContextTokens: 8_192, maxOptions: null, languages: ["en"], primitives: ALL }, languageLabel: "en", hosted: false },
  { model: "laya", capabilities: { maxContextTokens: 512, maxOptions: null, languages: ["en"], primitives: ALL }, languageLabel: "en", hosted: false },
  {
    model: "laya-multilingual",
    capabilities: { maxContextTokens: 1_024, maxOptions: null, languages: ["multi"], primitives: ALL },
    languageLabel: "multi",
    hosted: false,
  },
  {
    model: "laya-typed-decisions",
    capabilities: { maxContextTokens: 1_024, maxOptions: null, languages: ["en"], primitives: ALL },
    languageLabel: "en",
    hosted: false,
  },
  { model: "kev", capabilities: { maxContextTokens: null, maxOptions: null, languages: ["en"], primitives: ALL }, languageLabel: "en", hosted: false },
];

/** Default checkpoint per managed engine. */
export const DEFAULT_CHECKPOINT = { von: "von-1.2", laya: "laya" } as const;

/** The model id a backend is expected to serve (null for `llm`). */
export function backendModel(b: Backend): string | null {
  if (b.kind === "http") return b.model;
  if (b.kind === "managed") return b.checkpoint ?? DEFAULT_CHECKPOINT[b.engine];
  return null;
}

export function catalogEntry(b: Backend): CatalogEntry | undefined {
  const m = backendModel(b);
  return m === null ? undefined : CATALOG.find((e) => e.model === m);
}

const UNKNOWN: Required<Capabilities> = { maxContextTokens: null, maxOptions: null, languages: null, primitives: null };

/** Catalog capabilities overlaid by config (an explicit `null` means unknown). */
export function effectiveCapabilities(b: Backend): Required<Capabilities> {
  const base = catalogEntry(b)?.capabilities ?? UNKNOWN;
  const o = b.capabilities ?? {};
  const pick = <K extends keyof Capabilities>(k: K) => (Object.hasOwn(o, k) ? (o[k] ?? null) : base[k]) as Required<Capabilities>[K];
  return {
    maxContextTokens: pick("maxContextTokens"),
    maxOptions: pick("maxOptions"),
    languages: pick("languages"),
    primitives: pick("primitives"),
  };
}

export function effectiveKeyRef(b: Backend): string | undefined {
  if (b.kind !== "http") return undefined;
  return b.keyRef ?? catalogEntry(b)?.keyRef;
}
