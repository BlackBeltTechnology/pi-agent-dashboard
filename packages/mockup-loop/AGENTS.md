# DOX — packages/mockup-loop

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. pi package (extension + skill) for disciplined frontend design loop: GROUND → CONTRACT → MOCKUP → TEST → FIX → PROMOTE → LEARN. Defeats distributional convergence (agent regressing to generic mean). Generic: any React/Tailwind/shadcn or plain HTML project. |
| `presets-data/apple-hig/rules.md` | Apple HIG rule pack. Checkable subset for HTML approximation of iOS screen (servable by `serve_mockup`, auditable by `hig-doctor`). Semantic colors: `label`/`secondaryLabel` text, `systemBackground` surfaces, `separator` hairlines, `systemBlue`/`systemGreen`/`systemRed`. SwiftUI emitted only on PROMOTE. |
| `references/ux-best-practices.md` | UX best-practices rule corpus consulted by `frontend-mockup-loop` skill. Expert-designer ground truth: every decision grounded in externally documented public design rule + cited source. Adapt principle (USWDS CC0, GOV.UK OGL, Material/Carbon Apache-2.0); never copy proprietary (Apple HIG, Refactoring UI, Mobbin). Source hierarchy + universal laws/heuristics. |
| `vitest.config.ts` | vitest config. include src/**/__tests__/**/*.test.ts, node env, forks pool, maxWorkers 1, testTimeout 30000. See change: add-selectable-design-systems. |
