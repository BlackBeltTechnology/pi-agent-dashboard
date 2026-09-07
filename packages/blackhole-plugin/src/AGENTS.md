# DOX — packages/blackhole-plugin/src

Files in this directory. One row per source file. See change: add-blackhole-plugin.

| File | Purpose |
|------|---------|
| `configSchema.json` | draft-07 plugin-level config. `{ enabled }` only — the blackhole `UnifiedConfig` fields live in the external file, not dashboard config. `additionalProperties: false`. |
| `i18n.ts` | Plugin i18n `catalog` (unprefixed keys, merged under `plugin.blackhole.*`). `zh-CN` + `hu` blocks, identical key sets (scripts/i18n-parity). English at call sites via `t(key, vars, fallback)`. Field labels/help are DATA (client/field-groups.ts), not i18n keys. Gains subcard/detail keys: worker states, lag (exact vs stale), proximity approximation + caveat, cooldown/pending advisories, detail-view provenance labels. See change: add-blackhole-plugin, add-blackhole-session-pipeline. |

| `__tests__/manifest-discoverability.test.ts` | L1 (E12, E13). Manifest component/shouldRender/predicate names resolve to real client-entry exports; `shouldRenderMemorySubcard()` sync-fails closed; blackhole `priority` strictly > flows'; no per-claim `priority`; E13 — `shared/src/dashboard-plugin/slot-types.ts`/`slot-props.ts` absent from the change diff. See change: add-blackhole-session-pipeline. |
