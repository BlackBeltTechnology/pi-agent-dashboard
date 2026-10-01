/**
 * The config the settings UI starts from when no file exists (spec:
 * system-one-config, "Built-in presets"): presets `hosted` (Jev, then `llm`
 * on `@fast`) and `local-only` (managed only), `activePreset: "local-only"`,
 * `allowOffMachine: false`. Written by the first save.
 * See change: add-system-one-registry.
 */
import type { SystemOneConfig } from "@blackbelt-technology/pi-system-one";

export function seedConfig(): SystemOneConfig {
  return {
    version: 1,
    allowOffMachine: false,
    backends: {
      jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" },
      fast: { kind: "llm", role: "@fast" },
      von: { kind: "managed", engine: "von" },
    },
    presets: {
      hosted: { chain: ["jev", "fast"] },
      "local-only": { chain: ["von"] },
    },
    activePreset: "local-only",
    calibration: {},
  };
}
