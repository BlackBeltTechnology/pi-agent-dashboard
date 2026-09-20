# DOX — packages/deck3d/fixtures/business-2031

Second fixture deck: the corpus SHOWROOM. 40 slides — the 23 narrative slides
of `presentations/business-next-5-years` verbatim plus 17 authored ones —
presenting EVERY corpus card exactly once (80 cards + 1 local module), plus
every built topology, both mermaid kinds and the local-effect pipeline.
`src/fx/__tests__/e53-fixture-fx-coverage.test.ts` fails when a new card is
added and not placed here. See change: deck3d-cinematic-worlds.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `build-deck.mjs` | GENERATOR for `deck.md`. Lifts the 23 narrative slides verbatim from `presentations/business-next-5-years/deck.md`, appends the 17 authored slides (`EXTRA`). Authored copy is qualitative on purpose — no invented statistics. Run `node build-deck.mjs`. |
| `build-overrides.mjs` | GENERATOR for `overrides.json`. `PLAN` maps slide id → cards; THROWS on a card used twice, a corpus card never presented, or an unknown id. `DIAGRAMS` holds curated short node labels (auto-derived diagrams feed raw bullet text into nodes and overlap past the IoU gate). `PARAMS` carries the reviewed tuning. |
| `deck.md` | GENERATED — edit `build-deck.mjs`, not this. 40 slides (title, flowchart, sequence, and content slides driving all nine built topologies). Inline `<!-- deck3d: … -->` overrides carry the per-slide camera + `check.ignore:["contrast"]`. |
| `deck.json` | Committed IR. `overrides` holds the Style pass: deck `palette: blackbelt` + `floor: water` + `rail: tunnel`, `overrides.effects` deliberately EMPTY (deck scope prepends to every slide = duplication by construction), per-slide effects with tuned `params`, and `diagram.kind`/`data`. Regenerate: `rm deck.json && deck3d parse deck.md -o deck.json && deck3d overrides apply deck.json overrides.json`. NEVER regenerate while `deck3d serve` runs on this dir — an in-flight rebuild writes its stale IR back over the file. |
| `overrides.json` | GENERATED — edit `build-overrides.mjs`. Overrides-grammar patch applied via `deck3d overrides apply`. Objects deep-merge, arrays replace — so each slide block carries the WHOLE `effects` array while leaving that slide's `camera`/`check` intact. |
| `fx/` | ONE local module: `closing-mark` (scaffolded, hash-pinned in `deck.json`) — keeps the local-effect pipeline exercised. The previous six (`agent-depth`, `fab-wafer`, `geo-fragments`, `horizon-2031`, `proof-gate`, `trust-ledger`) were promoted into `src/fx` in Section 16, so the deck now references the corpus ids instead (`horizon-2031` → `horizon-gates`). |
