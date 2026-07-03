# DOX — packages/dashboard-plugin-skill/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Package barrel. Re-exports `render`, `FsSink`, `InMemorySink` from `./render.js` and types `Answers`, `NewModeAnswers`, `AugmentModeAnswers`, `AugmentProposal`, `WriteSink`, `SlotId`. |
| `render.ts` | Template renderer for `dashboard-plugin-scaffold`. Two modes: `new` (write fresh `packages/<id>-plugin/` tree) and `augment` (mutate existing `package.json` + scaffold `src/dashboard/*`). Exports `SlotId` (10 slots), `NewModeAnswers`, `AugmentProposal`, `AugmentModeAnswers`, `Answers`, `WriteSink` iface, `InMemorySink`, `FsSink`, `render(answers,sink)` entry. Reads `.tmpl` files from `templates/`, builds `claims` via `SLOT_SECTIONS`. |
