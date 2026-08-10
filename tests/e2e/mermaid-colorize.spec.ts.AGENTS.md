# mermaid-colorize.spec.ts — index

Playwright spec. Mermaid default-node colorization end-to-end via faux model. Sends `[[faux:mermaid-colorize]]` (scenario streams a flowchart: A/C default, `style B fill:#ff0000`). Waits for `.mermaid-diagram svg`, asserts default nodes A+C `rect` inline `style` has accent wash `rgba(...,0.08)`, authored node B keeps `#ff0000` with NO wash. Uses `spawnFreshGitSession`, `sendPrompt`. Needs `PI_E2E_SEED=1`. See change: colorize-mermaid-default-nodes.
