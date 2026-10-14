## Why

Beyond media, the ArtCraft Crafting Apps cover vector, layout, interface design, documents, slides, spreadsheets and photography — each provisioned and individually skilled by `add-craft-apps-core`. Common jobs chain several of them with existing skills (`nano-banana`, `anti-slop-brandkit`, `document-converter`, `deck3d`, PhotoCraft `replace-region`, the in-flight `add-lora-dataset-export-skill`). Agents need workflow skills with fixed hand-off formats and verification gates, as for media.

## What Changes

Five workflow skills shipped by `packages/craft-apps`:

- **`craft-brand-kit`** (W5) — brand direction (`anti-slop-brandkit` / `nano-banana`) → VectorCraft logo vectors + variants → PhotoCraft raster export set → DesignCraft one-pager → PdfCraft package.
- **`craft-doc-publish`** (W6) — Markdown (`document-converter`) → WordCraft or DesignCraft layout → PdfCraft combine/audit/secure; an alternative to the LibreOffice/pandoc PDF path.
- **`craft-deck`** (W7) — outline → DeckCraft slides (+ `render-transition` previews) ↔ `deck3d` → PdfCraft handout.
- **`craft-photo-pipeline`** (W8) — LightCraft raw develop/denoise → PhotoCraft retouch (`replace-region` + nano-banana) → export sets; optional dataset hand-off.
- **`craft-data-visual`** (W9) — GridCraft eval/charts → VectorCraft/DesignCraft infographic → DeckCraft slide.

Same rules as the media workflows: step contracts, `pi-craft verify` gates, resumable `craft-jobs/<slug>/`, soft references to sibling skills.

## Capabilities

### New Capabilities
- `craft-office-workflow-skills`: the five workflow skills, their step contracts, verification gates and soft references.

### Modified Capabilities
- None.

## Impact

- Code: 5 `SKILL.md` under `packages/craft-apps/.pi/skills/`; `pi.skills`; router table rows; lint coverage.
- Depends on: `add-craft-apps-core` and `add-craft-media-workflows` (must land first — it puts the Craft jobs / verify conventions in the `craft-studio` router that this change reuses).
- Implementation order (group `artcraft-craft-apps`): 3 of 4 — after `add-craft-media-workflows`, before `add-artcraft-studio`.
- No runtime code; no new deps. Rollback: remove skills from `pi.skills`.

## Discipline Skills

- `review-code` — before commit.
- None of `security-hardening` / `performance-optimization` / `observability-instrumentation` / `doubt-driven-review` apply: skill text only, no new inputs, services or irreversible steps.
