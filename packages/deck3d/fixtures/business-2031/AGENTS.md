# DOX — packages/deck3d/fixtures/business-2031

Second fixture deck: a ten-slide cut of `presentations/business-next-5-years`,
kept small enough for CI while still exercising every built topology, both
mermaid kinds and the local-effect pipeline. See change: deck3d-cinematic-worlds.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `deck.md` | Ten slides (title, flowchart, sequence, and content slides driving `bars`/`funnel`/`globe`/`orbit-cluster`/`stack`/`timeline-rail`/`loop`). Inline `<!-- deck3d: … -->` overrides carry the per-slide camera + `check.ignore:["contrast"]`. |
| `deck.json` | Committed IR. `overrides` holds the Style pass: `palette: midnight`, per-slide effects (corpus + `local:`) and `diagram.kind`/`data`. |
| `fx/` | Six local effect modules + cards referenced by the deck: `agent-depth`, `fab-wafer`, `geo-fragments`, `horizon-2031`, `proof-gate`, `trust-ledger`. Hash-pinned in `deck.json`. |
