# DOX — packages/system-one-plugin/src

See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `i18n.ts` | `catalog` {zh-CN, hu}: identical 123-key sets, UNPREFIXED leaves merged under `plugin.system-one.*`; English lives in `t(key, vars, default)` fallbacks; `{var}` placeholders. |
| `__tests__/manifest.test.ts` | L1: manifest validates (`validateManifest`), settings-section claim, barrel exports `SystemOneSettings` + `catalog`. |
