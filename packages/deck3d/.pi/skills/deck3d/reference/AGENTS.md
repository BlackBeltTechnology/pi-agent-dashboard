# DOX — packages/deck3d/.pi/skills/deck3d/reference

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `ir-fields.md` | GENERATED IR field reference (from `src/ir/schema.json` via the package build's field-reference generator). The LLM's knob lookup; never hand-edit. |
| `ir-fields.agent.md` | Pull-only condensed tuning cheat sheet indexing `ir-fields.md`. |
| `effects.md` | GENERATED effect catalogue from `src/fx/<id>.meta.json` cards (id, kind, tags, cost, modes, params, source, licence, thumbnail path). Never hand-edit. |
| `effects.agent.md` | Pull-only condensed index of `effects.md`: effect → kind, cost, modes, topics, params, plus the topic-routing rule. Regenerate alongside `npm run gen:effects`. See change: deck3d-cinematic-worlds. |
