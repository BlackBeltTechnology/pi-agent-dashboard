# DOX — docs/pipeline-map

Spec-first pipeline diagrams. 6 Mermaid sources + rendered PNGs + render config. Embedded in CONTRIBUTING.md. Re-render: `mmdc -i <n>.mmd -o <n>.png -b white -s 2 -c mmdc.json`.

| File | Purpose |
|------|---------|
| `1-overview.mmd` | Mermaid source. 5 phases + both boundary crossings: worktree boundary, reverse boundary via SHIP_IT_BLOCKED.md. |
| `1-overview.png` | Rendered 1-overview.mmd. White bg, 2× scale. |
| `2-plan.mmd` | Mermaid source. PLAN internals: artifacts → doubt-review → mockups → scenario-design → fold → fold-completeness gate → commit. |
| `2-plan.png` | Rendered 2-plan.mmd. |
| `3-build.mmd` | Mermaid source. BUILD internals: steps 1, 2, 2.5, 3, 4, 4.4, 4.5 + escape hatch. |
| `3-build.png` | Rendered 3-build.mmd. |
| `4-ship.mmd` | Mermaid source. SHIP internals: steps 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 10, 10.5, 11. |
| `4-ship.png` | Rendered 4-ship.mmd. |
| `5-ci.mmd` | Mermaid source. GitHub Actions: blocking PR workflows, workflow_dispatch-only, post-merge + nightly + release. |
| `5-ci.png` | Rendered 5-ci.mmd. |
| `6-loops.mmd` | Mermaid source. 6 inner loops, actor + stop condition each. |
| `6-loops.png` | Rendered 6-loops.mmd. |
| `mmdc.json` | mermaid-cli render config. wrappingWidth 460, useMaxWidth false, nodeSpacing/rankSpacing 55, fontSize 15px. |
