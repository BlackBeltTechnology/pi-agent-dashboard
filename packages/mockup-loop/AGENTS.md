# DOX — packages/mockup-loop

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/frontend-mockup-loop/SKILL.md` | NL-triggered skill: GROUND→CONTRACT→MOCKUP→TEST→FIX→PROMOTE→LEARN loop for frontend surfaces, defeats distributional convergence. GROUND = real component source + cited external public rules; CONTRACT = ui-contract.md token control plane (no raw hex/px); serve_mockup returns local+LAN URL not screenshot; score_mockup = breakpoints + 5-step expert protocol, score = passed/N in code. validate_mockup: L1 token-lint + L2 a11y = hard gates, L3/L4 advisory, pass = gate-only. Presets shadcn/mui/material-3/fluent-2/apple-hig. Pairs with anti-slop-frontend (advisory). |
| `README.md` | Package overview. pi package (extension + skill) for disciplined frontend design loop: GROUND → CONTRACT → MOCKUP → TEST → FIX → PROMOTE → LEARN. Defeats distributional convergence (agent regressing to generic mean). Generic: any React/Tailwind/shadcn or plain HTML project. |
| `presets-data/apple-hig/rules.md` | Apple HIG rule pack. Checkable subset for HTML approximation of iOS screen (servable by `serve_mockup`, auditable by `hig-doctor`). Semantic colors: `label`/`secondaryLabel` text, `systemBackground` surfaces, `separator` hairlines, `systemBlue`/`systemGreen`/`systemRed`. SwiftUI emitted only on PROMOTE. |
| `references/ux-best-practices.md` | UX best-practices rule corpus consulted by `frontend-mockup-loop` skill. Expert-designer ground truth: every decision grounded in externally documented public design rule + cited source. Adapt principle (USWDS CC0, GOV.UK OGL, Material/Carbon Apache-2.0); never copy proprietary (Apple HIG, Refactoring UI, Mobbin). Source hierarchy + universal laws/heuristics. |
| `vitest.config.ts` | vitest config. include src/**/__tests__/**/*.test.ts, node env, forks pool, maxWorkers 1, testTimeout 30000. See change: add-selectable-design-systems. |
