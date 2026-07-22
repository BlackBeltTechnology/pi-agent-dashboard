# DOX — packages/hermes-memory-plugin/src/client

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `hermes-api.ts` | REST client. `getConfig(apiBase?)` GET + `putConfig(full, apiBase?)` PUT against `/api/plugins/hermes-memory/config`. `EffectiveConfig`/`FieldView` types. Content-type guard; 400 `errors[]` surfaced as a joined message. |
| `field-groups.ts` | Presentation metadata: 9 accordion groups (`FIELD_GROUPS`) + per-key `FieldMeta` (label/help/unit). Control KIND derives from shared `FIELD_DESCRIPTORS`; this module carries display copy + grouping only. |
| `settings-model.ts` | Pure helpers: `linesToArray`/`arrayToLines` (textarea⇄array), `valueEquals`, `fieldError(key,value)` (client mirror of server numeric/regex checks — task 6.1), `buildResolvedConfig(values, overridden)` (full-write payload, design D5; skips undefined + empty overridden strings, keeps `[]`). |
| `HermesMemorySettings.tsx` | `settings-section` claim component. Grouped accordion form over every `MemoryConfig` field: effective value, DEFAULT badge when unset, per-field Reset, sticky save bar w/ change count, raw-JSON view, "applies to new sessions" notice. Folds UX deferrals: inline validation (Save disabled while invalid), `memoryPolicyCustomText` revealed only when `memoryPolicyStyle==="custom"`, prefers-reduced-motion guard. Tokens map 1:1 to `index.css` vars. |
| `index.tsx` | Client barrel. Exports `HermesMemorySettings` + `catalog` for the plugin-registry (names match manifest claim). |
