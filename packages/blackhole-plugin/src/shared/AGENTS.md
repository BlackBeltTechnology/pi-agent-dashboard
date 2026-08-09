# DOX — packages/blackhole-plugin/src/shared

Files in this directory. One row per source file. See change: add-blackhole-plugin.

| File | Purpose |
|------|---------|
| `blackhole-config.ts` | Re-declared `BlackholeConfig` + `ModelRef`, `FIELD_DESCRIPTORS` (kind/enum/bounds — the managed-key allowlist), `KNOWN_KEYS`, `DEFAULTS`, `THINKING_LEVELS`, `WORKER_CHAINS`, and `validateBlackholeConfig(body)` — the security boundary for `PUT` (rejects unknown keys, enum/type/bound violations; rejection is atomic). Bounds mirror blackhole's `positiveInt` (>0), `nonNegativeInt` (>=0, `cooldownHours`) and `dropperPressureThreshold` `(0,1]`. `null` explicitly UNSETS a model/chain key. `SOURCE-VERSION PIN: pi-blackhole@0.4.5`. |
| `chain-model.ts` | Pure chain algebra: `readChain`/`writeChain` (index 0 = `<worker>Model`, rest = `<worker>FallbackModels`), `moveEntry`, `removeEntry`, `canRemove` (a chain of one is never emptied), `normalizeModel` (trims strings, drops a cleared `contextWindow`/`cooldownHours` as ABSENT not `0`, preserves `_`-annotation keys). |
| `example-config.snapshot.json` | Vendored snapshot of `pi-blackhole@0.4.5` `example-config.json`. Drift guard input only — refreshed by hand when the SOURCE-VERSION PIN is bumped. Detects OUR descriptors drifting from the pin (key-set only), never upstream drift; no network fetch in CI. |
