/**
 * Environment-variable configuration for pi-image-fit.
 *
 * Read once on extension load. Invalid values fall back to documented
 * defaults and emit a single warning line naming the offending variable
 * per spec: Environment-variable configuration.
 *
 * Defaults rationale (see design.md D4):
 *  - maxEdge 1568 px — Anthropic's server-side downscale target;
 *    landing under this avoids double-downscale.
 *  - maxBytes 4 MiB   — comfortable headroom under Anthropic's ~5 MB
 *    per-image ceiling and the 30 MB per-request total.
 *  - quality 85       — webp sweet spot; visible quality cliff <80,
 *    diminishing returns >90.
 */

import { parseBool } from "./env.js";
import * as log from "./log.js";

export interface ImageFitConfig {
  /** When true, extension registers no hooks. */
  disabled: boolean;
  /** Long-edge pixel threshold; resize fires if exceeded. */
  maxEdge: number;
  /** Byte-size threshold; resize fires if exceeded. */
  maxBytes: number;
  /** webp output quality, 1–100. */
  quality: number;
}

export const DEFAULTS: Readonly<ImageFitConfig> = Object.freeze({
  disabled: false,
  maxEdge: 1568,
  maxBytes: 4 * 1024 * 1024, // 4 MiB
  quality: 85,
});

interface ParseRules {
  min: number;
  max: number;
}

function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  rules: ParseRules,
  warn: (msg: string) => void,
): number {
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  // Integer-only parse: reject floats, NaN, hex, scientific notation,
  // anything that isn't a positive integer literal.
  if (!/^\d+$/.test(trimmed)) {
    warn(`[pi-image-fit] WARN invalid ${name}="${raw}", falling back to ${fallback}`);
    return fallback;
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < rules.min || n > rules.max) {
    warn(`[pi-image-fit] WARN out-of-range ${name}="${raw}", falling back to ${fallback}`);
    return fallback;
  }
  return n;
}

export interface ReadConfigOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (msg: string) => void;
}

/**
 * Read configuration from environment variables.
 * Pure function: no side effects beyond the provided `warn` callback.
 */
export function readConfigFromEnv(opts: ReadConfigOptions = {}): ImageFitConfig {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? log.warn;

  const disabled = parseBool(env.PI_IMAGE_FIT_DISABLE);
  const maxEdge = parsePositiveInt(
    "PI_IMAGE_FIT_MAX_EDGE",
    env.PI_IMAGE_FIT_MAX_EDGE,
    DEFAULTS.maxEdge,
    { min: 1, max: 100_000 },
    warn,
  );
  const maxBytes = parsePositiveInt(
    "PI_IMAGE_FIT_MAX_BYTES",
    env.PI_IMAGE_FIT_MAX_BYTES,
    DEFAULTS.maxBytes,
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    warn,
  );
  const quality = parsePositiveInt(
    "PI_IMAGE_FIT_QUALITY",
    env.PI_IMAGE_FIT_QUALITY,
    DEFAULTS.quality,
    { min: 1, max: 100 },
    warn,
  );

  return { disabled, maxEdge, maxBytes, quality };
}
