# usePiCompatibility.ts — index

NEW. Fetches `/api/health` on mount + every 60s (instance-scoped: invoke ONCE per panel, pass fields down). Returns `{ compatibility, piRuntime }`, each null when absent/unresolvable. Exports `PiCompatibility`, `PiRuntimeHealth` (mirrors server `PiDivergenceHealth` — versions + divergence only, D2 gate). Breaking: was nullable `PiCompatibility` (now a field of the returned object, null when absent). See change: restore-pi-version-skew-surface, surface-pi-runtime-on-general.
