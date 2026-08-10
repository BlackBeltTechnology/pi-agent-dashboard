# DOX — packages/hermes-memory-plugin/src

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `configSchema.json` | draft-07 plugin-level config. `{ enabled }` only — the hermes `MemoryConfig` fields live in the external file, not dashboard config. `additionalProperties: false`. |
| `i18n.ts` | Plugin i18n `catalog` (unprefixed keys, merged under `plugin.hermes-memory.*`). `zh-CN` + `hu` blocks, identical key sets (scripts/i18n-parity). English at call sites via `t(key, vars, fallback)`. Field labels/help are DATA (field-groups.ts), not i18n keys. |
