## 1. Question register (TDD)

- [x] 1.1 Tests in `diagrams.test.ts`: questions embedded with refs; dangling ref → exit 1 naming id + ref, no HTML; duplicate id → exit 1; no `questions.json` → empty register — verify: fail first
- [x] 1.2 `lib.mjs` `checkQuestions`, `site.mjs` reads/validates/embeds `questions` — verify: tests green

## 2. Cross-links (catalog.js)

- [x] 2.1 Questions tab + question view; item view: capabilities links, questions, flow steps (parsed from embedded BPMN documentation); capability view: rules/quirks/gaps + questions; requirement + use-case + merged views: open questions with shared marker — verify: browser check on the pilot app
- [x] 2.2 SKILL.md + AGENTS rows; biome `--error-on-warnings`; full package vitest — verify: green

## 3. Pilot app trial

- [x] 3.1 Generate `diagrams/questions.json` from `_doccmp/*.json` (140) + 17 key questions; rebuild `catalog.html`; verify links in browser — verify: build exit 0

## Notes

- 3.1 the pilot app (2026-10-05): `questions.json` 17 key (`K-`, no refs — summaries) + 140 claim questions (`Q-`, 122 with refs); build exit 0; all 1184 items get ≥1 capability. Browser: merge UC-01/03/05 → 17 open questions; BR-244 → capability, Q-063, 3 flow steps; QUIRK-224 → capability via `Spec:`, Q-049; Q-001 → BR-182/193, UC-01, 2 requirements; capability page 71 items + questions.
