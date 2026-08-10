/**
 * Presentation metadata for the scalar half of the settings form: the accordion
 * groups from `mockups/blackhole-settings/index.html` and, per managed key, its
 * human label, help text and optional unit.
 *
 * The control KIND is derived from the shared `FIELD_DESCRIPTORS` (single source
 * of truth for type/enum/bounds) — this module carries display copy and grouping
 * only. The model chains are not listed here; they are rendered by `ChainEditor`.
 *
 * See change: add-blackhole-plugin.
 */
import type { BlackholeConfig } from "../shared/blackhole-config.js";

export interface FieldMeta {
  key: keyof BlackholeConfig;
  label: string;
  help: string;
  unit?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldMeta[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Compaction behaviour",
    fields: [
      {
        key: "compaction",
        label: "Trigger",
        help: "auto — blackhole fires on its own. manual — only /blackhole. off — pi handles auto-compaction and /compact.",
      },
      {
        key: "compactionEngine",
        label: "Engine",
        help: "Who produces the summary — blackhole's algorithmic pipeline (no LLM cost, deterministic) or pi's built-in LLM compaction.",
      },
      {
        key: "tailBehavior",
        label: "Tail behaviour",
        help: "How much conversation stays visible after a compaction. minimal keeps the last user message; pi-default keeps roughly 20k tokens.",
      },
      {
        key: "midRunCompaction",
        label: "Mid-run compaction",
        help: "Whether the threshold is checked during a long tool loop. resume is experimental and fails closed on unsupported pi internals.",
      },
    ],
  },
  {
    title: "Observational memory",
    fields: [
      {
        key: "memory",
        label: "Enable memory workers",
        help: "Off = no observer/reflector/dropper and no memory injection. Compaction still runs.",
      },
      {
        key: "sessionFallback",
        label: "Fall back to the session model",
        help: "When every configured model is exhausted or cooling down, run the worker on the session's own model instead of skipping it.",
      },
    ],
  },
  {
    title: "Trigger thresholds",
    fields: [
      {
        key: "observeAfterTokens",
        label: "Observe after",
        help: "Accumulated tokens before the observer runs.",
        unit: "tokens",
      },
      {
        key: "reflectAfterTokens",
        label: "Reflect after",
        help: "Accumulated tokens before the reflector runs.",
        unit: "tokens",
      },
      {
        key: "compactAfterTokens",
        label: "Compact after",
        help: "The one to tune first — aim for 60–70% of your model's context window.",
        unit: "tokens",
      },
    ],
  },
  {
    title: "Token budgets",
    fields: [
      {
        key: "observationsPoolMaxTokens",
        label: "Observation pool max",
        help: "Pool size that makes the dropper start pruning.",
        unit: "tokens",
      },
      {
        key: "observationsPoolTargetTokens",
        label: "Observation pool target",
        help: "Size the dropper prunes down to.",
        unit: "tokens",
      },
      {
        key: "observerChunkMaxTokens",
        label: "Observer chunk max",
        help: "Newest-first cap on the observer's input.",
        unit: "tokens",
      },
      {
        key: "observerPreambleMaxTokens",
        label: "Observer preamble max",
        help: "Older context prepended to the chunk. 0 auto-computes from the chunk cap.",
        unit: "tokens",
      },
      {
        key: "reflectorInputMaxTokens",
        label: "Reflector input max",
        help: "Cap on what the reflector reads per run.",
        unit: "tokens",
      },
      {
        key: "dropperInputMaxTokens",
        label: "Dropper input max",
        help: "Cap on what the dropper reads per run.",
        unit: "tokens",
      },
      {
        key: "dropperPressureThreshold",
        label: "Dropper pressure threshold",
        help: "Pressure-relief valve — fraction of the reflector input cap at which the dropper fires even with no new data.",
        // The accepted interval is OPEN at 0 — the validator rejects 0, so a
        // "0–1" label would invite a request that 400s.
        unit: "> 0 and ≤ 1",
      },
    ],
  },
  {
    title: "Runtime & diagnostics",
    fields: [
      {
        key: "agentMaxTurns",
        label: "Max agent turns",
        help: "Tool-calling turns a worker's agent loop may take.",
        unit: "turns",
      },
      {
        key: "providerIdleTimeoutMs",
        label: "Provider idle timeout",
        help: "Body-idle timeout for background provider streams. 0 disables the wrapper.",
        unit: "ms · 0 = off",
      },
      {
        key: "debug",
        label: "Debug output",
        help: "Verbose worker diagnostics in the session.",
      },
      {
        key: "debugLog",
        label: "Debug log file",
        help: "Write worker diagnostics to disk.",
      },
    ],
  },
];

/** Human-facing description of each worker chain, in render order. */
export const WORKER_META = [
  {
    worker: "observer" as const,
    name: "Observer",
    role: "Extracts timestamped facts · runs most often",
    primaryKey: "observerModel" as const,
    fallbackKey: "observerFallbackModels" as const,
  },
  {
    worker: "reflector" as const,
    name: "Reflector",
    role: "Distils observations into durable reflections",
    primaryKey: "reflectorModel" as const,
    fallbackKey: "reflectorFallbackModels" as const,
  },
  {
    worker: "dropper" as const,
    name: "Dropper",
    role: "Prunes low-value observations under pressure",
    primaryKey: "dropperModel" as const,
    fallbackKey: "dropperFallbackModels" as const,
  },
];
