## 1. Tests first

- [x] 1.1 `src/__tests__/diagrams.test.ts`: budget parameters; IFML areas/parts/action groups + per-part XMI passes `check-ifml`; state-machine merge (SCXML unchanged); sequence parts + `ref` blocks; ER cluster split; `check-size --strict`; byte-identical rerun. Verify red.

## 2. Implementation

- [x] 2.1 `scripts/split.mjs`: `budgetOf`, `ifmlParts`, `mergeParallel`, `sequenceParts`, `erChunks`, `sizeReport`.
- [x] 2.2 `diagrams.mjs`: `check-size`; `--max-nodes`/`--max-edges` on `build-site`. `site.mjs` embeds budget, IFML overview + parts (XMI each), split behaviour, ER clusters.
- [x] 2.3 `behaviour.mjs`: state/sequence Mermaid honour the budget; `behaviour` export writes part `.mmd`.
- [x] 2.4 `catalog.js`/`.css`: IFML overview + part view + breadcrumb; sequence/state split views; ER cluster split.
- [x] 2.5 `render.sh`: `MAX_NODES`/`MAX_EDGES`, `check-size` report, IFML part `.xmi` export.

## 3. Docs + pilot

- [x] 3.1 SKILL.md + `references/splitting.md`; AGENTS.md rows.
- [x] 3.2 Pilot: every part within budget (`check-size --strict`), two runs byte-identical, browser check.

## Notes

- Pilot at 30/40: IFML 858 elements → 8 areas, 44 parts (all `check-ifml` clean), `SM-process-locked` 79 → 9 edges, `SEQ-task-set-done` → 3 parts; `check-size --strict` 0 over; two pilot runs byte-identical; overview, part, sequence, state machine and ER (`--max-nodes 12`: 19 entities → 2 diagrams) checked in the browser.
- Pilot findings fixed test-first: one part per trigger kind was too fragmented (70 parts) → adjacent groups packed (44); a single `alt` of 41 messages stayed over → fragments cut into balanced framed pieces; ER per-cluster split too fragmented → adjacent pieces packed; long part titles/ids → clipped name, kinds abbreviated after 3; overview drawn TB.
- Known limit: a screen's first part carries its whole form; at budget 20 two such parts stay over (forms are not cut).
