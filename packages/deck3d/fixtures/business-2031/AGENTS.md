# DOX — packages/deck3d/fixtures/business-2031

Second fixture deck: a ten-slide cut of `presentations/business-next-5-years`,
kept small enough for CI while still exercising every built topology, both
mermaid kinds and the local-effect pipeline. See change: deck3d-cinematic-worlds.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `deck.md` | Ten slides (title, flowchart, sequence, and content slides driving `bars`/`funnel`/`globe`/`orbit-cluster`/`stack`/`timeline-rail`/`loop`). Inline `<!-- deck3d: … -->` overrides carry the per-slide camera + `check.ignore:["contrast"]`. |
| `deck.json` | Committed IR. `overrides` holds the Style pass: deck `palette: blackbelt` + `floor: water` + `rail: tunnel`, a deck-level effect list (`local:proof-gate`, `signal-pulse` — prepended to EVERY slide by `applyOverrides`), per-slide effects (corpus + `local:`) with tuned `params`, and `diagram.kind`/`data`. |
| `overrides.json` | Overrides-grammar patch applied via `deck3d overrides apply deck.json overrides.json`. Objects deep-merge, arrays replace — so each slide block carries the WHOLE `effects` array while leaving that slide's `camera`/`diagram`/`check` intact. |
| `fx/` | Six local effect modules + cards referenced by the deck: `agent-depth`, `fab-wafer`, `geo-fragments`, `horizon-2031`, `proof-gate`, `trust-ledger`. Hash-pinned in `deck.json`. |
