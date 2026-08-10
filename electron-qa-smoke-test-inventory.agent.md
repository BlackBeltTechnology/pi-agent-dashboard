# electron-qa-smoke-test-inventory — index

Reference inventory of QA/smoke/verification items across EVERY archived OpenSpec proposal. Extends original Electron QA inventory to all archived proposals. Source: `openspec/changes/archive/`. Purpose: find + build MISSING tests. Extracted by parallel LLM workers (electron/gemma 35, deepseek 539), one worker per proposal.

## Summary (top of file)
- Proposals covered: 574 / 574.
- Test/verification items extracted: 11864.
- Proposals with no QA/smoke tests: 7.
- By type: unit 5878 · integration 1662 · e2e 372 · smoke 445 · manual 2347 · ci 1160.
- Extraction source: electron/gemma 35 · deepseek 539.

## Bullet format
Each item: `**[type]** what it verifies — `file path` — (status)`. type ∈ unit·integration·e2e·smoke·manual·ci. status = proposal's claim at archive time, NOT live audit.

## Structure — grouped by month (`# YYYY-MM`), then per-proposal (`## YYYY-MM-DD-<slug>`)
Navigate to a proposal by its dated slug heading. Month sections + proposal counts:
- `# 2025-06` — 1 proposal (redesign-ask-user-question-cards).
- `# 2026-03` — 93 proposals (early dashboard: chat renderer, session cards/sync/persistence, themes, zrok, openspec cards, mobile-responsive, terminal-emulator, oauth).
- `# 2026-04` — 127 proposals (flow-dashboard, monorepo-split, electron bundle/branding/packaging, bootstrap-resolution, dashboard-plugin-architecture, windows parity, mdns discovery, trusted-networks).
- `# 2026-05` — 160 proposals (largest month).
- `# 2026-06` — 156 proposals.
- `# 2026-07` — 37 proposals (latest: through 2026-07-04-wire-discipline-skills-into-openspec).

## Usage
Grep by proposal slug (`## 2026-04-10-monorepo-split`), by type tag (`[e2e]`, `[manual]`), or by touched path to find existing coverage before authoring a new test. 7 proposals list no QA items — candidates for missing-test backfill.
