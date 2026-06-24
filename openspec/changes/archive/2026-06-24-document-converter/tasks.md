## 1. Vendor engine + define schema

- [x] 1.1 Copy `document_converter` (from `~/Documents/.gemini/skills/document-conversion/src`), `frontmatter-filler`, and `markdown-table-profiler` into `packages/document-converter/engine/`; record upstream versions/commits in `engine/VENDOR.md`
- [x] 1.2 Define the unified document-frontmatter schema (template vars, `table_profiles`, `nano_banana`, provenance) as a typed TS module + a JSON Schema doc; this is the contract every stage uses
- [x] 1.3 Scaffold `packages/document-converter` (package.json, tsconfig, exports) per monorepo conventions; zero-collision name confirmed

## 2. Build the pi-doc-engine Docker image

- [x] 2.1 Write `engine/Dockerfile` bundling docling, python-docx/pptx, openpyxl, pandoc, Gotenberg, mermaid-cli, chrome-headless-shell, nano-banana CLI, frontmatter-filler, markdown-table-profiler — building only from the in-repo `engine/` copy
- [x] 2.2 Verify image references no `~/Documents`/home-dir path and runs with no host Python
- [x] 2.3 Add a build script + image tag/version; document `docker run` invocation contract (stdin/stdout JSON)

## 3. TS facade core

- [x] 3.1 Implement the docker invocation layer (spawn `docker run`, stream stdin/stdout JSON, map exit codes → typed errors)
- [x] 3.2 Implement extension routing (pdf/docx/pptx/xlsx/md → engine command)
- [x] 3.3 Implement provenance frontmatter writer (`source_path`, `sha256`, `doc_type`, `converted_at`, `page`/`slide`)
- [x] 3.4 Define and export the typed facade API: `convertToMarkdown`, `renderDocx`, `renderPdf`, `extractForEdit`/`mergeBack`

## 4. Ingest direction (feeds kb)

- [x] 4.1 Implement PDF/DOCX/PPTX/XLSX → Markdown into a staging dir with provenance frontmatter
- [x] 4.2 Implement selectable OCR options (`mode` auto/force/off, `lang[]`, `engine`) with canonical-name → per-engine-code mapping; default `mode: auto`
- [x] 4.3 Implement typed error on unsupported lang/engine combo (no silent empty OCR); add `tables: off` escape hatch
- [x] 4.4 Wire kb consumption: document the `filesystem` source pointed at the staging dir; verify `kb index` + `kb search` over converted output with kb untouched

## 5. Produce direction (templating)

- [x] 5.1 Implement `renderDocx` with named template + variable placeholders (from frontmatter), TOC, cover page
- [x] 5.2 Implement `renderPdf` (Markdown/DOCX → PDF via pandoc/Gotenberg)
- [x] 5.3 Implement round-trip `extractForEdit` → edit → `mergeBack` preserving formatting (`document_meta.xml`)

## 6. Diagram rendering

- [x] 6.1 Implement default mmdc rendering for Mermaid/PlantUML using the baked chrome-headless-shell (no host Chrome)
- [x] 6.2 Implement opt-in styled nano-banana path: md5(diagram source) → `.mermaid-cache/<md5>.png`, generate misses via CLI with named style from `nano-banana-styles.yaml`
- [x] 6.3 Implement mmdc fallback on any nano-banana failure / missing `GEMINI_API_KEY`; inject key at `docker run` time only

## 7. Frontmatter tooling

- [x] 7.1 Expose frontmatter-fill via the facade (defaults, language packs, glob overrides, filename/H1 auto-detect, CLI overrides)
- [x] 7.2 Expose table-profile injection (`table_profiles:` width ratios) and confirm the converter sizes tables by content

## 8. Skill + tests + docs

- [x] 8.1 Author `.pi/skills/document-converter/SKILL.md` (NL triggers, links to the package facade, not the Python internals)
- [x] 8.2 Unit-test the facade: routing, provenance, OCR code mapping, cache hit/miss, mmdc fallback (mock the engine boundary)
- [x] 8.3 Integration-test one real conversion per direction against the built image (ingest PDF→md→kb; produce md→DOCX with template + diagram) — **VERIFIED** against `pi-doc-engine:0.1.0`: ingest (cupsfilter PDF→md, provenance stamped, kb index+search returns chunk) + produce (md→DOCX via mounted `default` template, mmdc diagram). Test at `src/__tests__/integration.test.ts`, gated on `DOC_ENGINE_IMAGE`/`DOC_ENGINE_PDF`/`DOC_ENGINE_TEMPLATES`; skips in default `npm test`.
- [x] 8.4 Add `packages/document-converter` rows to `docs/file-index-*.md` per the Documentation Update Protocol (delegate docs writes to a subagent, caveman style)
