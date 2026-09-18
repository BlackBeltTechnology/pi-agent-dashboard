# DOX — packages/deck3d/src/ir

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `schema.json` | Deck IR JSON Schema (draft-07), `description` on every field. Enforces `additionalProperties:false` everywhere (unknown-key rejection) and the single `overrides` grammar. Source of truth for `validate` and the generated field reference. |
| `types.ts` | TypeScript mirror of `schema.json` (DeckIR, Defaults, Slide, Diagram, Overrides, and the render-only Merged* view). |
| `ids.ts` | Stable id derivation: `slugify`/`foldAscii`, `parseHeading` (`{#pin}`), `assignSlideIds` (`-<ordinal>` collisions), `edgeId` (`<from>-><to>#<k>`), `messageId` (`m<i>`). Ids come from author source, never render counters. |
| `hash.ts` | Canonical JSON (sorted keys) + sha256; `computeDerivedHash` over `defaults`+`slides` so `validate` can detect edits made outside `overrides`. |
| `defaults.ts` | `DECK_DEFAULTS` (mirrors the schema `default` keywords) + `resolveDefaults`, so a bare deck is fully specified and `derivedHash` is stable. |
| `merge.ts` | The override merge grammar: objects deep-merge, arrays replace. `applyOverrides` returns a fresh merged view; `findOrphanOverrides`/`orphanOverridePath` keep vanished targets inert + warned. |
| `validate.ts` | Ajv schema validation + derived-data referential integrity (errors) + orphan overrides and derivedHash mismatch (warnings). `formatPath` renders ajv pointers as the `overrides` grammar (`overrides.slides["arch"].camera.distance`). |
| `field-reference.ts` | Walks the schema into flat `FieldRow`s and renders `reference/ir-fields.md`; used by `scripts/gen-ir-fields.ts` and its test. |
