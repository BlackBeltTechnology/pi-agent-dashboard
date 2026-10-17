## 0. Preconditions and gating probes

- [x] 0.0 Confirm `add-craft-media-workflows` is archived (its `craft-app-skills` delta, the router "Craft jobs" section and `WORKFLOW_SKILL_NAMES` are present on `develop`). If it is not, stop and rebase this change's `specs/craft-app-skills/spec.md` on the then-current text — verified: `add-craft-media-workflows` archived 2026-10-17 (`openspec/changes/archive/2026-10-17-add-craft-media-workflows`); its delta is on `develop`
- [x] 0.1 VectorCraft: `imageTrace.make` / `imageTrace.makeAndExpand` headless round-trip png → svg; `vectorcraft-cli convert in.svg out.png --scale N` preview — verified, see `spike-wordcraft.md`
- [x] 0.2 WordCraft: re-run `spike-wordcraft.md` rows 3–8 against the in-repo fixture template and the real `~/Documents/templates/default` (when present); record any drift in the spike file — re-run: two drifts (TOC order; Markdown-imported images collide with a template's `rId1`) — recorded in `spike-wordcraft.md`, design D3 and the `craft-doc-prepare` delta
- [x] 0.3 LightCraft: headless raw develop on a real camera RAW; `denoise.models.install` + denoise run (network/model download noted) — verified with a synthetic DNG; AI denoise needs a user-supplied model + licence acceptance (recorded)
- [x] 0.4 GridCraft `insert.chart` + chart export to svg/png; DeckCraft `insert.picture` (svg/png) + `render` to pdf — verified: no chart image command — pdf export + `pdfcraft render` + `image.trim`
- [x] 0.5 ffprobe `pix_fmt` on an alpha tiff; enable `--alpha` on tiff in the W5/W8 skills only if it reports alpha — verified: ffprobe reports `rgba` for an alpha tiff; `--alpha` stays png-only per spec
- [x] 0.6 `pi-nano-banana` invocation used by document-converter's styled-diagram path: pin the args for `doc prepare` — pinned in design D3: `pi-nano-banana "Diagram:\n…" --output <png>`

## 1. `pi-craft doc prepare` (design D3)

- [x] 1.1 `packages/craft-apps/package.json`: add `yaml` + `fflate` (workspace versions) to `dependencies`; confirm `scripts/build.mjs` bundles them (`external: []`)
- [x] 1.2 `src/doc-prepare.ts`: frontmatter (doc-engine keys), template resolution + name/`templates_dir` confinement, variable precedence + system vars (doc-engine month tables), `defaulted`
- [x] 1.3 `src/doc-prepare.ts`: in-memory docx fill on decoded `w:t` text (document incl. VML/wps textboxes, all header/footer parts), split-run merge within a paragraph, `<name>` per manifest syntax, `logo:` ignored, XML escape, byte-identical untouched parts
- [x] 1.4 `src/doc-prepare.ts`: body preparation (image/diagram processing on pre-substitution text; realpath confinement; data URIs; remote list; host `mmdc` via argv; nano-banana with `md5(style+source)` cache and mmdc fallback; PlantUML warning); outputs + `prepare.json`; `--json`; overwrite only the 3 outputs; exit codes 0/1/2
- [x] 1.5 `src/bin/craft.ts`: `doc` dispatch (`--help` 0, missing/unknown subcommand 1), usage lists `doc prepare`; README CLI table row

## 2. Workflow skills (each: write skill → run once end-to-end → fix)

- [x] 2.1 `craft-brand-kit` (W5): user logo default (svg as-is / raster → `imageTrace`), variants, PhotoCraft export set, DesignCraft one-pager, PdfCraft package; opt-in brandkit section (explicit request, its own gate, approved concept only, "concept" labels)
- [x] 2.2 `craft-doc-publish` (W6): step 0 siblings; prepare step + gate (`unresolved`, `mermaid.unrendered`, `images.skipped`, `images.remote`, `defaulted` confirmation); render step (`run --file`, body, TOC, properties, `convert`) + pdf gate; optional PdfCraft combine/audit/protect (password never persisted); document-converter routing for ingest/round-trip/PlantUML
- [x] 2.3 `craft-deck` (W7): DeckCraft path (+ `render-transition` previews) → PdfCraft handout; deck3d alternative branch; no conversion between them
- [x] 2.4 `craft-photo-pipeline` (W8): LightCraft develop/denoise → PhotoCraft retouch (`replace-region`, nano-banana backend; skipped without credentials) → export sets
- [x] 2.5 `craft-data-visual` (W9): GridCraft `cat --range` read-back `check:` fence → chart export + preview gate → VectorCraft/DesignCraft infographic → DeckCraft slide
- [x] 2.6 Every office skill: link to the router "Craft jobs" section; retry cap of 2 and exit-3 stop text; svg gated through a png preview only

## 3. Shared wiring

- [x] 3.1 `package.json` `pi.skills` 18 → 23; `helpers/skills.ts` `WORKFLOW_SKILL_NAMES` +5 with the per-workflow app map for drift
- [x] 3.2 `craft-studio` router: 5 workflow-table rows + the `craft-doc-publish` default / `document-converter` split sentence
- [x] 3.3 `packages/craft-apps/AGENTS.md` + `src/AGENTS.md` + `src/__tests__/AGENTS.md` rows (`doc-prepare.ts`, 5 skills, new test/helper files); README sections

## 4. Tests (folded from test-plan.md — automated rows)

- [x] 4.1 Variable precedence default < frontmatter < `--var` with sources (test-plan #E1); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts` (temp-dir fixtures) + new `helpers/docx.ts` (fflate builder); triple: template `variables.xml` default `version`=0.1, md frontmatter `version: "1.0"` · `doc prepare` ×3 (none / frontmatter / `--var version=1.1`) · filled text 0.1 / 1.0 / 1.1 and `vars.version` = default / frontmatter / cli
- [x] 4.2 Template name traversal refused (test-plan #E2); exemplar: see `packages/craft-apps/src/__tests__/craft-cli.test.ts`; triple: frontmatter `template: ../../evil` · `doc prepare` · exit 2, stderr names it, no outputs written
- [x] 4.3 Frontmatter `templates_dir` confinement (test-plan #E3); exemplar: see `packages/craft-apps/src/__tests__/craft-cli.test.ts`; triple: `templates_dir` inside / outside / outside + `--allow-path` · `doc prepare` · exit 0 / 1 naming the dir / 0
- [x] 4.4 Templates-dir resolution chain (test-plan #E4); exemplar: see `packages/craft-apps/src/__tests__/provision.test.ts` (HOME-sandboxed env layouts); triple: 5 layouts removing the higher-priority source · `doc prepare` · `templatePath` = highest-priority existing source
- [x] 4.5 Textbox + first-page header filled (test-plan #E5); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: fixture docx with `{{ client_name }}` in a wps `w:txbxContent` and `{{ document_id }}` in first-page `header2.xml` · `doc prepare` · no `{{` left in those parts, values present
- [x] 4.6 Split-run placeholder (test-plan #E6); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: `{{ version }}` in 3 runs · `doc prepare --var version=2.0` · paragraph text `2.0`, `unresolved: []`
- [x] 4.7 Value XML-escaped (test-plan #E7); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: `--var client_name='A & B <C>'` · `doc prepare` · raw XML `A &amp; B &lt;C&gt;`, every changed part well-formed
- [x] 4.8 `<name>` syntax rules (test-plan #E8); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: manifest `client_name` both / `$date` mustache; parts with `&lt;client_name&gt;`, `&lt;$date&gt;`, `&lt;draft&gt;` · `doc prepare` · only `client_name` replaced, none unresolved, no tag/attribute changed
- [x] 4.9 Unresolved placeholder and `--allow-missing` (test-plan #E9); exemplar: see `packages/craft-apps/src/__tests__/craft-cli.test.ts`; triple: `{{ document_id }}` undefined · `doc prepare` with/without `--allow-missing` · exit 1 / 0, `unresolved: ["document_id"]` both
- [x] 4.10 Placeholder spanning paragraphs reported (test-plan #E10); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: `{{ ver` | `sion }}` across 2 paragraphs · `doc prepare --var version=1` · text unchanged, listed unresolved
- [x] 4.11 `logo:` slots ignored (test-plan #E11); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: header `{{logo:company}}` · `doc prepare` · token unchanged, in `ignored`, exit 0
- [x] 4.12 Untouched parts byte-identical (test-plan #E12); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: docx with placeholder-free `footer1.xml`, `[Content_Types].xml`, rels · `doc prepare` · sha256 equal to input
- [x] 4.13 Defaulted variables reported (test-plan #E13); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: `client_name` only in `variables.xml` · `doc prepare` · `defaulted` contains it, source `default`
- [x] 4.14 `$date` parity with doc-engine (test-plan #E14); exemplar: see `packages/craft-apps/src/__tests__/verify.test.ts` (table-driven); triple: fixed clock 2026-03-05, language en/hu/de/fr · `doc prepare` on `{{ $date }}` · equals the pinned `system_variables.py` output per language
- [x] 4.15 Body preparation (test-plan #E15); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: md with frontmatter + `Hi {{ client_name }} <client_name>` · `doc prepare` · no frontmatter in `body.md`, `Hi ACME`, literal `<client_name>`
- [x] 4.16 Image path confinement (test-plan #E16); exemplar: see `packages/craft-apps/src/__tests__/security.test.ts`; triple: 6 refs (inside / `../` / absolute / symlink in→out / allow-path / http) · `doc prepare` · data URIs for inside + allow-path, `skipped` with reason for the 3 outside, `remote` for http
- [x] 4.17 Variable cannot smuggle image/diagram syntax (test-plan #E17); exemplar: see `packages/craft-apps/src/__tests__/security.test.ts`; triple: `--var note='![x](/etc/passwd)'` + a value with a mermaid fence · `doc prepare` · literal in `body.md`, no data URI, stub `mmdc` not invoked, `warnings` non-empty
- [x] 4.18 Mermaid via host mmdc without a shell (test-plan #E18); exemplar: see `packages/craft-apps/src/__tests__/helpers/stubs.ts` + `skills-recipes.test.ts` (PATH stubs); triple: stub `mmdc`, source containing `$(touch PWNED)` · `doc prepare` · data-URI image, `mermaid.rendered: 1`, no `PWNED` file, argv received
- [x] 4.19 mmdc missing (test-plan #E19); exemplar: see `packages/craft-apps/src/__tests__/helpers/stubs.ts`; triple: PATH without `mmdc`, 1 Mermaid block · `doc prepare` · exit 0, block fenced, `mermaid.unrendered: 1`
- [x] 4.20 nano-banana cache keyed by style + source (test-plan #E20); exemplar: see `packages/craft-apps/src/__tests__/helpers/stubs.ts`; triple: `nano_banana.enabled`, style `ros-3d`, counting stub · prepare ×2 then style `flat` · stub calls 1, 1, 2; cache files for both styles; `cached: 1` on run 2
- [x] 4.21 nano-banana failure falls back to mmdc (test-plan #E21); exemplar: see `packages/craft-apps/src/__tests__/helpers/stubs.ts`; triple: stub `pi-nano-banana` exit 1, stub `mmdc` ok · `doc prepare` · exit 0, `fallback: 1`, `rendered: 1`
- [x] 4.22 PlantUML left as code (test-plan #E22); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: one plantuml block · `doc prepare` · unchanged, one warning naming plantuml
- [x] 4.23 `--json` + rerun into an existing out dir (test-plan #E23); exemplar: see `packages/craft-apps/src/__tests__/craft-cli.test.ts`; triple: out dir with `keep.txt` + `.mermaid-cache/x.png` · run twice with `--json` · stdout JSON deep-equals `prepare.json`, 3 outputs rewritten, others untouched
- [x] 4.24 Doc-engine frontmatter keys (test-plan #E24); exemplar: see `packages/craft-apps/src/__tests__/region-replace.test.ts`; triple: `enable_toc`, `toc_heading: Tartalom`, `document_title: Q3`, `table_style` · `doc prepare` · `toc` {true, Tartalom, 3}, `title` Q3, `ignored` has `table_style`
- [x] 4.25 `doc` dispatch and exit codes (test-plan #E25); exemplar: see `packages/craft-apps/src/__tests__/craft-cli.test.ts`; triple: — · `pi-craft --help`, `doc --help`, `doc`, `doc bogus`, `doc prepare in.md` without `--out` · 0 + `doc prepare` listed; 0; 1; 1; 2
- [x] 4.26 Manifest + tarball hold 23 skills (test-plan #E26); exemplar: see `packages/craft-apps/src/__tests__/packaging.test.ts`; triple: `package.json` after the change · packaging test · `pi.skills` 23, tarball exactly 23 `SKILL.md` incl. the 5 office dirs
- [x] 4.27 Office skills frontmatter/description lint (test-plan #E27); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: 5 office `SKILL.md` · workflow lint · name == dir, description > 60 chars with a quoted phrasing ≥ 6 chars
- [x] 4.28 Router lists the office workflows (test-plan #E28); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: `craft-studio/SKILL.md` · router lint · names all 5, states the `craft-doc-publish` default and the `document-converter` split
- [x] 4.29 Office step-contract lint (test-plan #E29); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: 5 step tables · workflow lint · no verify on `*.svg`, svg steps followed by png `convert` + `--size`, no `--alpha` on tiff, retry-cap-2 + exit-3 stop text
- [x] 4.30 Craft-jobs link + secrets text (test-plan #E30); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: 5 office `SKILL.md` · workflow lint · router "Craft jobs" link present, slug rule not restated, W5/W6 state passwords/keys never go to `job.json`
- [x] 4.31 Office soft-reference lint (test-plan #E31); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: sibling map W5/W6/W7/W8 · step-0 lint · each sibling, its package and a degraded path named
- [x] 4.32 Office drift union (test-plan #E32); exemplar: see `packages/craft-apps/src/__tests__/skills-drift.test.ts`; triple: office `pi-craft <app> exec` lines + app map · offline drift · every id resolves in the union (e.g. `imageTrace.make`, `references.toc`, `doc_protect`)
- [x] 4.33 GridCraft read-back `check:` fence (test-plan #E33); exemplar: see `packages/craft-apps/src/__tests__/skills-recipes.test.ts` (fence extraction + `bash -e`); triple: 7 error-token fixtures + 1 clean · run the `craft-data-visual` `check:` fence · exit ≠ 0 for each error, 0 for clean
- [x] 4.34 `craft-doc-publish` content lint (test-plan #E34); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: `craft-doc-publish/SKILL.md` · workflow lint · `run --file` only (never `--template`), render gate has `--pages` + `--text-contains`, prepare gate checks the 5 report fields
- [x] 4.35 `craft-brand-kit` opt-in lint (test-plan #E35); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: `craft-brand-kit/SKILL.md` · workflow lint · default path uses `imageTrace`, brandkit only in an explicit-request + approval section, "concept" label
- [x] 4.36 `craft-deck` alternatives lint (test-plan #E36); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: `craft-deck/SKILL.md` · workflow lint · deck3d branch without DeckCraft/PdfCraft steps, no pptx↔HTML conversion
- [x] 4.37 `craft-photo-pipeline` scope lint (test-plan #E37); exemplar: see `packages/craft-apps/src/__tests__/skills.test.ts`; triple: `craft-photo-pipeline/SKILL.md` · workflow lint · no `dataset` / `LoRA` / `lora-dataset`
- [x] 4.38 W6 real-binary publish (test-plan #X1); exemplar: see `packages/craft-apps/src/__tests__/real-apps.test.ts` (`CRAFT_E2E` gate); triple: in-repo fixture template (textbox cover + first-page header) · `CRAFT_E2E=1` + workflow opt-in: prepare → WordCraft `run --file` → `convert` · verify `--text-contains` title and `ACME Kft.` exits 0; docx keeps header/footer parts
- [x] 4.39 Page-count gate on a real PDF (test-plan #X2); exemplar: see `packages/craft-apps/src/__tests__/real-apps.test.ts`; triple: published PDF with N pages · `pi-craft verify --pages N+1` · exit 1, expected N+1 vs actual N
- [x] 4.40 Office workflow recipes end-to-end + opt-in split (test-plan #X3); exemplar: see `packages/craft-apps/src/__tests__/skills-recipes.test.ts`; triple: provisioned apps + sample inputs · run office recipe fences under `CRAFT_E2E=1` + workflow opt-in (and with the opt-in unset) · every recipe exits 0 with verify passing / office describes reported skipped, not failed

## 5. Manual QA (test-plan: manual-only)

- [x] 5.1 No image credentials → agent offers a user-supplied logo in `craft-brand-kit` (test-plan #X4) (test-plan: manual-only)
- [x] 5.2 Brandkit requested without plan confirmation → nothing generated (test-plan #X5) (test-plan: manual-only)
- [x] 5.3 Verify exit 3 (PdfCraft unavailable) → agent stops and reports (test-plan #X6) (test-plan: manual-only)
- [x] 5.4 Interrupted W6 job resumes at the protect step (test-plan #X7) (test-plan: manual-only)
- [x] 5.5 Protect password absent from `job.json` and reports (test-plan #X8) (test-plan: manual-only)
- [x] 5.6 Defaulted variable / unrendered diagram → agent asks before rendering (test-plan #X9) (test-plan: manual-only)
- [x] 5.7 Round-trip request → `document-converter`; 3D web deck → `deck3d` (test-plan #X10) (test-plan: manual-only)
- [x] 5.8 Formula error in the source range → agent stops before chart export (test-plan #X11) (test-plan: manual-only)
- [x] 5.9 One end-to-end run per workflow W5–W9; W6 PDF visually matches the template (test-plan #X12) (test-plan: manual-only)

## 6. Review

- [x] 6.1 `security-hardening` pass on `doc-prepare.ts` (path confinement, XML escaping, argv spawn, in-memory unzip, secrets) — added: exclusive temp-file writes, 20 MB / type allowlist for inlined images, comment stripping to a fixed point (CodeQL), `Diagram:` prompt label, lone-surrogate stripping
- [x] 6.2 `review-code` — ship-it step 4.5 round 1 (`@review`): 0 blocking; non-blocking fixed (cache key on style content, exit-code header, lint exemption, surrogates)
