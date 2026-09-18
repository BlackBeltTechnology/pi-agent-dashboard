# ir-fields.md — index

Pull-only condensed map. Source: `.pi/skills/deck3d/reference/ir-fields.md` (generated). Full per-field types/defaults live there; this file is the tuning cheat sheet.

## Rule
- `defaults` + `slides[]` = DERIVED. `parse` regenerates them. Edit → lost on re-parse (`validate` warns via `meta.derivedHash`).
- `overrides` = ONLY write region. Survives re-parse. Objects merge; arrays replace.
- Fix a `check` finding by writing its suggested `overrides` key — never patch HTML or engine code.

## Deck overrides
- `overrides.deck.*` — same fields as `defaults`: `mode` (dark|light), `palette` (blackbelt|zenit|dapp|custom), `material` (glass|metal|matte), `transition`, `quality` (low|medium|high), `depthRelief` (number, z per rank), `backgroundIntensity` 0–1, `extrudeDepth`, `camera.distance`, `labels.size`, `check.ignore[]`.
- `overrides.effects[]` — replaces the deck-level effect list. `{id, params?}`.
- `overrides.props[]` — `{source, id, licence, author, sha256, slide, role, size?, count?, restyle?, anim?}`. `role` = `hero|illustration|ambient|node:<id>`.

## Per-slide overrides
- Key `overrides.slides["<slideId>"]`; slide ids are ASCII-folded title slugs (`-<ordinal>` on collision) or `{#pin}`.
- Framing: `diagram.scale`, `diagram.offset.{x,y}`, `camera.distance`, `labels.size`.
- Palette/scene: `mode`, `palette`, `material`, `transition`, `quality`, `scene`, `backgroundIntensity`.
- Effects: `effects[]` (replaces this slide's derived defaults).
- Exemptions: `check.ignore[]` (ids still reported as `skipped`).

## Diagram-element overrides
- Node: `overrides.nodes["<slideId>/<nodeId>"]` — `shape` (rect|stadium|round|hexagon|circle|doublecircle|diamond|cylinder), `label`, `position.{x,y,z}`, `size.{w,h}`, `material`.
- Edge: `overrides.edges["<slideId>/<edgeId>"]` — `kind` (normal|dotted|thick), `material`.
- Edge ids are `<from>-><to>#<k>`; node ids are the mermaid node names.

## Suggestion map
- `fit` → `diagram.scale` / `diagram.offset` (or `camera.distance`).
- `legibility` → `labels.size` (or `camera.distance`).
- `overlap` / `occlusion` → `diagram.scale` / `diagram.offset` / `node.position`.
