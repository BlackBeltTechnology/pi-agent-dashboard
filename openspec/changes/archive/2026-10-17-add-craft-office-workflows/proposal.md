## Why

Beyond media, the ArtCraft Crafting Apps cover vector, layout, documents, slides, spreadsheets and photography. `add-craft-apps-core` (archived 2026-10-14) provisions each app and ships one skill per app. Common jobs chain several apps with existing skills: `nano-banana-imagegen`, `anti-slop-brandkit`, `document-converter`, `deck3d`, and PhotoCraft `replace-region`. As with media, agents need workflow skills with fixed hand-off formats and verification gates.

Markdown → templated DOCX/PDF currently runs through the Dockerized `document-converter` engine (pandoc + LibreOffice/Gotenberg). That path needs Docker, and it fails on real templates: a broken pandoc `sectPr` makes LibreOffice reject the docx, and pandoc drops the cover logo. A live spike (design D2) showed that WordCraft, driven headless on the real `templates/default/template.docx`, keeps the template's styles, fonts, headers/footers and cover graphics. It also produces a correct TOC and PDF. Four gaps remain, and a small helper closes them:
- frontmatter is not parsed;
- `{{ var }}` in cover textboxes and the first-page header/footer is not filled;
- images are embedded only as data URIs;
- Mermaid is not supported.

## What Changes

Five workflow skills shipped by `packages/craft-apps`:

- **`craft-brand-kit`** (W5): by default it starts from a **user-supplied logo**. An svg is used as-is; a raster logo is traced to vector with VectorCraft `imageTrace.*`. Steps: VectorCraft logo variants → PhotoCraft raster export set → DesignCraft one-pager → PdfCraft package. `anti-slop-brandkit` is an **opt-in branch**. It runs only on explicit request, keeps its own confirmed paid-plan gate, and its outputs are labelled *concepts*. If no image backend credentials are available, the kit starts from the user's logo.
- **`craft-doc-publish`** (W6): the **default** Markdown → templated DOCX/PDF path. Steps: `pi-craft doc prepare` (frontmatter, template, variables, images, diagrams) → WordCraft (body into template, TOC, properties) → PDF via WordCraft → optional PdfCraft combine/audit/protect. `document-converter` keeps ingest/OCR, round-trip `extractForEdit`/`mergeBack` and `table_profiles`, and remains the fallback renderer.
- **`craft-deck`** (W7): outline → DeckCraft slides (+ `render-transition` previews) → PdfCraft handout. `deck3d` is an **alternative renderer** (outline → HTML deck). The two are never converted into each other.
- **`craft-photo-pipeline`** (W8): LightCraft raw develop/denoise → PhotoCraft retouch (`replace-region`, nano-banana backend) → export sets. No dataset hand-off.
- **`craft-data-visual`** (W9): GridCraft eval + chart export → VectorCraft/DesignCraft infographic → DeckCraft slide, with a cell read-back gate (GridCraft prints formula errors with exit 0).

New helper **`pi-craft doc prepare`** (TypeScript, in `packages/craft-apps`). It reads Markdown frontmatter using the doc-engine unified schema and resolves a template from the doc-engine `templates/<name>/` layout. It fills `{{ var }}` / `<var>` placeholders in every docx part (body, textboxes, all header/footer variants, split runs) with XML-escaped values. It inlines images as data URIs and renders Mermaid blocks to PNG: the host `mmdc` by default, or nano-banana when opted in via frontmatter, with the same md5 cache and mmdc fallback as doc-engine. Output: the filled template, a WordCraft-ready body `.md` and a `prepare.json` report.

The router `craft-studio` gains a workflow table. The skill lint gains a workflow-skill lint set, separate from the per-app lint.

Same rules as the media workflows, reused rather than redefined: step contracts, `pi-craft verify` gates, the router-owned "Craft jobs" convention (`craft-jobs/<slug>/`, `job.json`) from `add-craft-media-workflows`, and soft references to sibling skills.

## Capabilities

### New Capabilities
- `craft-office-workflow-skills`: the five workflow skills, their step contracts, verification gates, resumability and soft references.
- `craft-doc-prepare`: the `pi-craft doc prepare` helper (frontmatter, template resolution, placeholder fill, image/diagram inlining, report).

### Modified Capabilities
- `craft-app-skills` (rebased on the `add-craft-media-workflows` delta):
  - **Router skill**: the workflow table also names the five office workflows.
  - **Skills declared in the package manifest**: 18 → 23.
- `craft-cli-entrypoint`: subcommand dispatch accepts `doc`.

## Impact

- Code:
  - 5 `SKILL.md` under `packages/craft-apps/.pi/skills/`.
  - `src/doc-prepare.ts` + a `doc` branch in `src/bin/craft.ts`.
  - `package.json`: `pi.skills` 18 → 23. New runtime dependencies `yaml` + `fflate` of the craft-apps package; both versions already exist in the workspace and are bundled into `dist/craft.js` by `scripts/build.mjs`.
  - Router workflow-table rows.
  - `WORKFLOW_SKILL_NAMES` +5 and packaging count 18 → 23.
  - README + `AGENTS.md` rows.
- No dashboard server/client code.
- Depends on `add-craft-apps-core` (archived) and on `add-craft-media-workflows`, which **must be archived first**. This change's `craft-app-skills` delta and the workflow lint build on media's; see `openspec/groups/groups.json` group `artcraft-craft-apps` (this change is 3 of 4).
- Host tools: `mmdc` is optional. Without it, Mermaid blocks stay as code blocks and `prepare.json` warns.
- Rollback: revert the five manifest entries, the router rows, the `doc` subcommand + helper + its two dependencies, and the test count/name changes. `craft-jobs/` directories are user data and are kept. `document-converter` remains fully functional throughout.

## Discipline Skills

- `doubt-driven-review`: W6 replaces the default document path, and the shared `job.json` contract crosses changes.
- `security-hardening`: `doc prepare` handles untrusted Markdown/frontmatter. This means XML-escaping variable values injected into docx parts, confining image/template paths, spawning `mmdc` with an argv vector (no shell), and the nano-banana key/network. PdfCraft/WordCraft protect passwords must never land in `job.json` or verify reports.
- `review-code`: before commit.
- `performance-optimization` / `observability-instrumentation` do not apply. These are offline batch steps whose evidence is the `prepare.json` + verify reports.
