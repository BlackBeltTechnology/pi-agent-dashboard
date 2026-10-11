# DOX — packages/deck3d/src/variants

The variant loop: `style.json` records each creative decision; candidates render side by side, are previewed live, picked atomically and replayed. Spec deck3d-variant-loop.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `schema.json` | `style.json` JSON Schema: 2–4 variants per step, `picked`/`note`/`round`/`pending`, optional `drop`/`replaceStep` kept for replay. See change: deck3d-pptx-import. |
| `style.ts` | Types, `validateStyle` (errors vs dangling-slide warnings, fragments checked against the overrides schema), atomic `writeAtomic`, `pendingStep`/`interruptedMessage`. See change: deck3d-pptx-import. |
| `pick.ts` | `pickVariant` (validation + ownership guard + 3 atomic writes), `noteStep`, `replayPicks` (idempotent, reports orphans). `ownershipConflicts`: arrays replace, so a fragment may not silently drop effect/prop ids another writer added. See change: deck3d-pptx-import. |
| `render.ts` | `renderStep` (contact sheet: one render per variant in memory, snapshots, chromium-composed grid, temp HTML removed), `renderWithFragment` (also used by `serve ?variant=`). See change: deck3d-pptx-import. |
