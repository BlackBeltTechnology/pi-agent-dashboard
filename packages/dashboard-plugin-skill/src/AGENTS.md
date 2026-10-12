# DOX — packages/dashboard-plugin-skill/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Package barrel. Re-exports `render`, `FsSink`, `InMemorySink` from `./render.js` and types `Answers`, `NewModeAnswers`, `AugmentModeAnswers`, `AugmentProposal`, `WriteSink`, `SlotId`. Also exports `writeProjectId`, `validateAppScope`, `AppScopeAnswers`. See change: add-project-scoped-apps. |
| `project-identity.ts` | `writeProjectId(folder, id, deps?)` → merge id into `<folder>/.pi/dashboard/project.json`; atomic temp+rename; refuses symlink/non-regular/>64 KiB/non-object/`schemaVersion`≠1/different existing `id`. See change: add-project-scoped-apps. |
| `render.ts` | Template renderer for `dashboard-plugin-scaffold`. Two modes: `new` (write fresh `packages/<id>-plugin/` tree) and `augment` (mutate existing `package.json` + scaffold `src/dashboard/*`). Exports `SlotId` (10 slots), `NewModeAnswers`, `AugmentProposal`, `AugmentModeAnswers`, `Answers`, `WriteSink` iface, `InMemorySink`, `FsSink`, `render(answers,sink)` entry. Reads `.tmpl` files from `templates/`, builds `claims` via `SLOT_SECTIONS`. Mode `new` takes `appScope` (`none|global|project-type|project-specific`): `validateAppScope`, app files `src/app/{app,AppRoute}.tsx`, claims, `projectTypes`; no standalone for scoped apps. See change: add-project-scoped-apps. |
