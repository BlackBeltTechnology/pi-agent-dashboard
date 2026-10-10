Skill dir: `S = packages/eng-disciplines/.pi/skills/rebuild-package-diagrams`.
Tests: `packages/eng-disciplines/src/__tests__/diagrams.test.ts` (run: `cd packages/eng-disciplines && npx vitest run`).

## 1. Script (TDD)

- [x] 1.1 Write `diagrams.test.ts` covering every scenario of the `rebuild-package-diagrams` spec (tmpdir fixtures) — verify: tests fail (script absent)
- [x] 1.2 Implement `S/scripts/diagrams.mjs` `extract-model`, `render-er`, `check-trace` — verify: tests green

## 2. Skill text

- [x] 2.1 Write `S/SKILL.md`, `S/references/er-mapping.md`, `S/references/bpmn-mapping.md`; self-contained path test + frontmatter trigger test — verify: tests green
- [x] 2.2 Wire `package.json` (`pi.skills[]`, keywords, description), README skills table, `packages/eng-disciplines/AGENTS.md` rows — verify: `package-wiring.test.ts` green

## 3. Real-target trial

- [x] 3.1 Run the skill on the pilot app rebuild package (ER overview + ≥1 BPMN use case); record outcome in the README/skill pitfalls if the run surfaces a gap — verify: `render-er` and `check-trace` exit 0 on the trial outputs
- [x] 3.2 `review-code` inline review; fix findings — verify: full package vitest green

## Notes

- 3.1 trial (2026-10-05): the pilot app package → 8 ER diagrams (overview 24 hubs + 7 clusters, all `render-er` exit 0), `er-scope.md` 109 rows, `use-cases.md` 16 candidates, UC-01 BPMN `check-trace` exit 0 + bpmn-package-explorer layout/guard pass. Surfaced: `spec:` ref needs `;` before prose (documented), stdout truncation >64 KB on pipes (fixed: `process.exitCode`, regression test), bpmn-package-explorer self-symlinks on relative package dir (pitfall; bug belongs to pi-forms-bpmn).

## 4. Browsable catalog (use-cases.json + build-site)

- [x] 4.1 Spec delta: Gated use-case catalog + Single-file browsable catalog — verify: `openspec validate add-rebuild-package-diagrams`
- [x] 4.2 Tests first in `diagrams.test.ts`: check-use-cases (pass, unknown entity, dangling req/ref, missing bpmn, duplicate id), build-site (embedded JSON content, `</script` escaping, inlined libs, no-lib notice) — verify: fail
- [x] 4.3 Implement `check-use-cases`, `build-site`, `templates/catalog.{html,css,js}` — verify: tests green, biome clean
- [x] 4.4 SKILL.md procedure + AGENTS rows — verify: skill-text tests green
- [x] 4.5 Pilot app trial: `use-cases.json` (16), ≥3 more BPMN flows, `catalog.html` built and browsed (select + merge + cross-links) — verify: gates exit 0, browser check
- 4.5 trial (2026-10-05): `use-cases.json` 16 (gate exit 0), flows UC-01/03/05/09 (check-trace + layout guard pass), `catalog.html` 5.3 MB (1184 items, 18 caps, 109 entities); browser: 3-UC merge → 7 requirements, 56 refs with shared ×2, 10 entities ER, related ranking; flow switch, element-click refs, entity ER, search, backlinks verified. Fixed: empty selection bar visible (`.selbar[hidden]`).
