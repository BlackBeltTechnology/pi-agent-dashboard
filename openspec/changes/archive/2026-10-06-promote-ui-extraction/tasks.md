## 1. Tests first
- [x] 1.1 ui-extract.test.ts: ported plan/kit unit tests; adapter by path; no toolbar hook → no filtering; unlinked control exits 1
- [x] 1.2 diagrams.test.ts: render.sh minimal package (skips arch/IFML, writes catalog); failing gate stops it

## 2. Implementation
- [x] 2.1 copy ui-extract programs, reference adapter, prompt, references into reverse-spec-for-rebuild
- [x] 2.2 `loadAdapter(nameOrPath)` in lib.mjs used by every program; `toolbar` adapter hook
- [x] 2.3 render.sh + vendored ifml-js + NOTICE
- [x] 2.4 SKILL.md phases (both skills), references/ui-extraction.md, AGENTS.md rows

## 3. Pilot
- [x] 3.1 Delta-Dot run-pilot.sh uses the skill copies + render.sh; local copies deleted; outputs byte-identical

## Notes

- Pilot proof: Delta-Dot `run-pilot.sh` switched to the skill copies + `render.sh`, local programs deleted; all 49 outputs byte-identical to before the move except bpmn-package-explorer `diagnostics.json` `generatedAt` and the catalog `meta.built` date (UTC day rolled over; with the date normalized the catalog hash matches).
- Genericized while moving: adapter by name or path (`loadAdapter`), toolbar convention as adapter hook `toolbar {ref, assign}` (was hard-coded `OpBar`), optional `strings`/`planAssets`, no Plantifier default effective-config file.
- Biome `--error-on-warnings` clean: 8 over-complex pilot functions split into helpers (behaviour unchanged, proven by the byte-identical outputs).
