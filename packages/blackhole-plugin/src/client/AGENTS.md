# DOX — packages/blackhole-plugin/src/client

Files in this directory. One row per source file. See change: add-blackhole-plugin.

| File | Purpose |
|------|---------|
| `BlackholeSettings.tsx` | `settings-section` component (general tab). Three self-produced states: not-installed (registry says `pi-blackhole` missing), parse-error (NO form, explicit DISABLED save control, recovery actions), form (scalar accordions + chain editors). Saves through the host Save Bar via `useSettingsDraftSource({ id: "plugin:blackhole" })`. Exports `buildPayload(draft)` — scalars + chains split back to `<worker>Model`/`<worker>FallbackModels`, `null` unsets, `NaN`/`undefined` says nothing. Copy never demands a restart; apply is attributed to the extension. |
| `ChainEditor.tsx` | One worker's ordered chain. Ranked list, expandable per-model fields (`provider`, `id`, `thinking`, `cooldownHours`, `contextWindow`). Move-up/down/remove are real `<button>`s with accessible names naming the model; boundary controls DISABLED not absent; no remove on a single-entry chain. Renders the shared `base model → session model` tail as non-entry text, marked `data-excluded` when `sessionFallback` is off. |
| `blackhole-api.ts` | REST client. `getConfig` (a 409 parse-error is a RESULT, not a throw), `putConfig`, and `isExtensionInstalled` — reads `GET /api/plugins` `status.missingRequirements`, i.e. pi's package registry, NEVER the filesystem. An unreported probe resolves to installed so an unknown answer cannot fabricate a not-installed state. |
| `field-groups.ts` | Display copy + grouping only (control kind derives from `FIELD_DESCRIPTORS`). `FIELD_GROUPS` = compaction behaviour, observational memory, trigger thresholds, token budgets, runtime & diagnostics. `WORKER_META` = observer/reflector/dropper name, role, and config key pair. |
| `index.tsx` | Client entry barrel. Exports `BlackholeSettings` (name MUST match the manifest claim's `component`) and the i18n `catalog`. |
