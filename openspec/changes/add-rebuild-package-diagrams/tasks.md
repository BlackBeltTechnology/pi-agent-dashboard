Skill dir: `S = packages/eng-disciplines/.pi/skills/rebuild-package-diagrams`.
Tests: `packages/eng-disciplines/src/__tests__/diagrams.test.ts` (run: `cd packages/eng-disciplines && npx vitest run`).

## 1. Script (TDD)

- [x] 1.1 Write `diagrams.test.ts` covering every scenario of the `rebuild-package-diagrams` spec (tmpdir fixtures) — verify: tests fail (script absent)
- [x] 1.2 Implement `S/scripts/diagrams.mjs` `extract-model`, `render-er`, `check-trace` — verify: tests green

## 2. Skill text

- [x] 2.1 Write `S/SKILL.md`, `S/references/er-mapping.md`, `S/references/bpmn-mapping.md`; self-contained path test + frontmatter trigger test — verify: tests green
- [x] 2.2 Wire `package.json` (`pi.skills[]`, keywords, description), README skills table, `packages/eng-disciplines/AGENTS.md` rows — verify: `package-wiring.test.ts` green

## 3. Real-target trial

- [x] 3.1 Run the skill on the Plantifier v2.11.1 rebuild package (ER overview + ≥1 BPMN use case); record outcome in the README/skill pitfalls if the run surfaces a gap — verify: `render-er` and `check-trace` exit 0 on the trial outputs
- [x] 3.2 `review-code` inline review; fix findings — verify: full package vitest green

## Notes

- 3.1 trial (2026-10-05): Plantifier v2.11.1 package → 8 ER diagrams (overview 24 hubs + 7 clusters, all `render-er` exit 0), `er-scope.md` 109 rows, `use-cases.md` 16 candidates, UC-01 BPMN `check-trace` exit 0 + bpmn-package-explorer layout/guard pass. Surfaced: `spec:` ref needs `;` before prose (documented), stdout truncation >64 KB on pipes (fixed: `process.exitCode`, regression test), bpmn-package-explorer self-symlinks on relative package dir (pitfall; bug belongs to pi-forms-bpmn).
