# DOX — packages/deck3d/src/fx

Curated, licence-clean effect corpus + deterministic defaults + composition (design D9). See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `types.ts` | `FxKind`/`FxMode`/`FxCard`/`FxContext`/`FxHandle`/`FxFactory`/`FxEntry` + `PERMISSIVE_LICENCES`. Every effect module implements `create(ctx, params) → { object?, pass?, material?, tick?, dispose() }`. |
| `meta.schema.json` | Card JSON Schema (draft-07): id, kind, tags, cost 1–5, modes, params schema, conflicts, https source, SPDX licence enum. |
| `index.ts` | GENERATED registry: pairs each `<id>.meta.json` card with its `<id>.ts` factory; `FX_IDS`, `cardFor`. |
| `<id>.ts` + `<id>.meta.json` | One module + card per effect (47 ids, see `reference/effects.md`). `tokens`/`rings`/`swarm`/`particles` delegate to `runtime/backgrounds.ts`; the rest are permissive three.js-example ports behind the interface. |
| `compose.ts` | `composeEffects(effects, mode, quality, slideId)`: mode gating (skip + warn), conflicts, quality budget (low 6 / medium 12 / high 20). `validateEffectParams(ir)`: card-bound param checks with `overrides.slides["<id>"].effects[i].params.<p>` paths (E24). |
| `defaults.ts` | `defaultEffectsFor` / `defaultSceneFor`: deterministic keyword + diagram-kind → effect list (title→swarm, flowchart→tokens+signal-pulse, sequence→rings+signal-pulse, security→glyph-rain, data→data-columns). Wired into `parse`. |
| `catalogue.ts` | `catalogue()` sorted rows, `renderCatalogue()` → `reference/effects.md`, `catalogueHash()` (drift detector). |
