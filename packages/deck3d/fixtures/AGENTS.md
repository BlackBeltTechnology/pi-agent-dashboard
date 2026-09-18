# DOX — packages/deck3d/fixtures

Fixture decks used by the harvest/parse/render test suites.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `harvest.md` | Two-slide mermaid deck (Hungarian `flowchart LR` + `sequenceDiagram`) exercising shapes, edge kinds, actors/messages and accented labels. Parse determinism + unsupported-type CLI tests. |
| `strategy-lab.md` | The strategy-lab mockup reproduced as Markdown: seven slides (Hungarian titles, `flowchart LR` + `sequenceDiagram`). Parity fixture for the render/check suites. |
| `strategy-lab.json` | Parsed IR for `strategy-lab.md` (written by `build`). Committed expected IR. |
