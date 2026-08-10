# DOX — docs/qa

docs/qa/ holds QA planning artifacts + test-case inventories.

| File | Purpose |
|------|---------|
| `distilled-current-test-cases.md` | Code-verified current-state Playwright test-case suite. 340 distinct cases distilled from 1811 historic candidates. Each checked against live source digest (packages/client/src + plugin src/client): testids, visible text, roles, handlers. Drifted behaviors dropped. Grouped by 18 functional surfaces. Tagged [NEW] (320 coverage gaps) or [COVERED] (20 already in tests/e2e). Companion to archived-frontend-test-cases.md. Built via 2-stage google/gemma-4-31b-it worker pipeline (ground+distill, then dedup+coverage-tag). |
| `archived-frontend-test-cases.md` | Generated Playwright test-case inventory. 431 archived frontend-touching OpenSpec changes (of 574). Per change: frontend surface, user-facing behavior, atomic Playwright-candidate assertions, drift risk (High/Medium/Low). 1811 total test cases. Historic — drift-rated; re-verify High/Medium against live client before authoring specs. Built by parallel google/gemma-4-31b-it workers from proposal WHY/WHAT + tasks verification sections. |
