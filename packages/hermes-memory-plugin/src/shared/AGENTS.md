# DOX — packages/hermes-memory-plugin/src/shared

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `hermes-config.ts` | Re-declared `MemoryConfig` (mirror of pi-hermes-memory@0.8.1 types.ts) + `FIELD_DESCRIPTORS` (type/enum/bounds per key), `KNOWN_KEYS`, `DEFAULTS` (mirror of DEFAULT_CONFIG). `validateHermesConfig(body) → { ok, errors[] }`: rejects non-object, unknown key, wrong type, out-of-range enum, negative/non-integer number, uncompilable `correction*Patterns` regex. Security boundary for the PUT route (design D6). SOURCE-VERSION PIN — re-check on hermes upgrade (risk D-R1). |
