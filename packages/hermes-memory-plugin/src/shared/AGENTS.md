# DOX — packages/hermes-memory-plugin/src/shared

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `hermes-config.ts` | Re-declared `MemoryConfig` (mirror of pi-hermes-memory@0.9.10 types.ts) + `FIELD_DESCRIPTORS` (type/enum/bounds per key), `KNOWN_KEYS`, `DEFAULTS` (mirror of DEFAULT_CONFIG). `validateHermesConfig(body) → { ok, errors[] }`: rejects non-object, unknown key, wrong type, out-of-range enum, negative/non-integer number, uncompilable `correction*Patterns` regex. Security boundary for the PUT route (design D6). SOURCE-VERSION PIN — re-check on hermes upgrade (risk D-R1). `FieldDescriptor` gains `{kind:"model"}`; `llmModelOverride` maps to it, validated as string. See change: add-context-mode-settings-plugin. 44 keys; `llmThinkingOverride` enum adds `max`; `consolidationChunkChars` number ≥ 500 (stricter than upstream); `sessionRetentionDays` integer ≥ 0 (stricter); `flushCompactTimeoutMs` any finite (min `-Infinity`); `overflowGraceMs` number ≥ 0; `LEGACY_0_8_1_DEFAULTED_KEYS` (23, frozen) + `LEGACY_CONSOLIDATION_TIMEOUT_MS` for the heal; `consolidationTimeoutMs` default 180000. Drift guard: `__tests__/fixtures/hermes-0.9.10-fields.json` (`version`/`keys`/`defaults`) (generated from upstream `loadConfig()`). See change: resync-hermes-memory-config-0-9. |
