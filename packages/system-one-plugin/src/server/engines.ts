/**
 * Managed engine catalog — package specifiers and launch shape, pinned to the
 * versions checked in task 6.11 (spec: system-one-managed-backends):
 *   - Von: `von-sdk` 1.2.3 (github.com/wfzyx/von @ fb6e7a9). `von serve
 *     --host --port --model`; serves `/v1/models`.
 *   - Laya: `laya[serve]` 0.3.20 (github.com/NandhaKishorM/laya @ 4066d5d).
 *     `laya-serve` takes NO CLI flags — host/port/checkpoint come from
 *     `LAYA_HOST` / `LAYA_PORT` / `LAYA_MODELS`; serves `/health` and
 *     `/v1/systemone` only (no `/v1/models`).
 * See change: add-system-one-registry.
 */
import { DEFAULT_CHECKPOINT } from "@blackbelt-technology/pi-system-one";

export interface EngineSpec {
  /** `uv tool install` specifier. */
  package: string;
  /** Executable name in the uv tool bin dir. */
  bin: string;
  argv(port: number, checkpoint: string): string[];
  env(port: number, checkpoint: string): Record<string, string>;
  verified: string;
}

/** Laya checkpoint aliases → the `LAYA_MODELS` preload key. */
const LAYA_KEYS: Record<string, string> = {
  laya: "english",
  english: "english",
  "laya-multilingual": "multilingual",
  multilingual: "multilingual",
  "laya-typed-decisions": "typed-decisions",
  "typed-decisions": "typed-decisions",
};

export const ENGINES: Record<"von" | "laya", EngineSpec> = {
  von: {
    package: "von-sdk==1.2.3",
    bin: "von",
    argv: (port, checkpoint) => ["serve", "--host", "127.0.0.1", "--port", String(port), "--model", checkpoint],
    env: () => ({}),
    verified: "von-sdk 1.2.3 (github.com/wfzyx/von @ fb6e7a9)",
  },
  laya: {
    package: "laya[serve]==0.3.20",
    bin: "laya-serve",
    argv: () => [],
    env: (port, checkpoint) => ({
      LAYA_HOST: "127.0.0.1",
      LAYA_PORT: String(port),
      LAYA_MODELS: LAYA_KEYS[checkpoint] ?? "english",
    }),
    verified: "laya 0.3.20 (github.com/NandhaKishorM/laya @ 4066d5d)",
  },
};

export const checkpointFor = (engine: "von" | "laya", checkpoint?: string): string => checkpoint ?? DEFAULT_CHECKPOINT[engine];
