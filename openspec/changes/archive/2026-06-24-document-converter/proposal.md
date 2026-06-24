## Why

The user's mature document-processing skills (`document-conversion`, `docling`)
live as Python packages outside this TypeScript monorepo, so they cannot feed
the `kb` knowledge base or produce branded deliverables from inside the
dashboard. Reimplementing them in TS would lose real fidelity (docling OCR/layout,
python-docx complex tables, the `document_converter` templating engine). We want
the capability here without the feature loss — and without polluting the repo
with a host Python toolchain.

## What Changes

- Add a new monorepo package **`packages/document-converter`**: a TypeScript
  facade that is the only surface the repo (and the `kb` pipeline) calls.
- Add a project skill **`.pi/skills/document-converter`**: the NL-triggered
  entry point ("convert this PDF", "make a DOCX from markdown with our template").
- Ship **one Docker image (`pi-doc-engine`)** that quarantines the Python engine:
  vendors the user's `document_converter` package + docling + python-docx /
  python-pptx / openpyxl + pandoc + Gotenberg + mermaid-cli / PlantUML +
  **nano-banana CLI** (`@the-focus-ai/nano-banana`) + a baked **chrome-headless-shell**
  + the **frontmatter-filler** and **markdown-table-profiler** tools.
  TS is the contract + orchestrator; Python is the engine; they meet at a CLI/JSON
  boundary.
- **Ingest direction** (feeds `kb`): PDF/DOCX/PPTX/XLSX → Markdown with provenance
  frontmatter, written into a **kb staging dir**. `kb` is **not modified** — its
  markdown-only `filesystem` source contract is the integration seam.
- **Produce direction** (templating — full parity with the Python skill in v1):
  Markdown → DOCX via reusable templates + variable placeholders, TOC + cover
  page, Mermaid/PlantUML diagram rendering, round-trip extract→edit→merge
  (`document_meta.xml`), and Markdown/DOCX → PDF (pandoc/Gotenberg).
- **Styled-diagram rendering (nano-banana)** — opt-in per document via frontmatter
  `nano_banana: {enabled: true, style: <name>}`. The engine replaces each
  ` ```mermaid ` block with a **cached** `.mermaid-cache/<md5>.png` (cache key =
  md5 of the diagram source text), generating misses via the nano-banana CLI
  (`GEMINI_API_KEY`) using a named style from `nano-banana-styles.yaml`. The
  md5 cache makes non-deterministic image-gen **reproducible** (same diagram never
  re-renders). **Falls back to mmdc on any failure** — never hard-fails a doc.
  Default (flag off) stays plain mmdc. The general nano-banana image-gen
  capability (text-to-image, edit, style transfer, multi-image composition) comes
  bundled for free.
- **Frontmatter tooling (the pipeline's shared bus):**
  - **frontmatter-filler** — programmatically fill/refresh YAML metadata across
    every markdown file: project-wide defaults, **per-language packs** (HU/EN/DE
    — e.g. `toc_heading`), per-file glob overrides, filename + `# H1`
    auto-detection, CLI `--set key=value`. Produces the variables the templating
    engine consumes.
  - **markdown-table-profiler** — compute per-column width ratios for every md
    table and inject a `table_profiles:` block into frontmatter so
    `document_converter` renders tables sized by content. Language-agnostic.
  - **Hungarian (and configurable) OCR** — docling OCR-language config (from
    `pdf-to-markdown-tax-docs`) so scanned HU/NAV PDFs extract correctly; OCR
    language is a convert option, not hardcoded.
- **No feature loss from the adapted skills:** every behavior above
  (`document_converter` templating, the md5-cached styled-diagram path + mmdc
  fallback, docling fidelity, frontmatter fill + table-profile + OCR-language) is
  preserved; the Docker boundary additionally *erases* the host-side mmdc pitfalls
  (no host Chrome deadlock; headless shell baked in).
- "Keep Python, wrap in TS" is the governing rule: any lane where a pure-TS lib
  loses features stays on the Python engine behind the Docker boundary.

## Capabilities

### New Capabilities
- `document-converter`: TypeScript facade + Docker-wrapped Python engine that
  converts documents bidirectionally — ingest (any format → provenance-stamped
  Markdown for `kb`, configurable OCR language) and produce (Markdown → templated
  DOCX/PDF with diagrams, TOC, round-trip editing). Includes frontmatter tooling
  (fill/refresh metadata + table-profile injection) over a single unified
  document-frontmatter schema shared by every stage.

### Modified Capabilities
<!-- None. kb is consumed via its existing markdown filesystem-source contract; no kb requirement changes. -->

## Impact

- **New code**: `packages/document-converter/` (TS facade, ext routing,
  provenance frontmatter writer, docker invocation, typed results),
  `.pi/skills/document-converter/`, and a Docker context for `pi-doc-engine`.
- **Dependencies**: adds a Docker dependency for document conversion (consistent
  with archived `docker-packaging` / `docker-test-harness` infra and the existing
  `document-conversion` skill's Docker hooks). No host Python required. Styled
  diagrams need a runtime-injected `GEMINI_API_KEY` (nano-banana CLI); absent or
  on failure, rendering falls back to mmdc.
- **`kb`**: untouched. Consumes converted Markdown via a `filesystem` source
  pointed at the staging dir; existing `kb index` / `kb search` flow unchanged.
- **Image weight**: docling ML models + LibreOffice/Gotenberg + pandoc make a
  heavy but self-contained image — the accepted cost of full-fidelity wrapping.

## Open Design Questions (resolve in design.md)

1. **Unified document-frontmatter schema (design pillar)** — ONE frontmatter
   contract that every stage reads/writes: frontmatter-filler **writes** template
   vars (`project_name`, `author`, `toc_heading`, `language`, `logos`,
   `document_id`); markdown-table-profiler **writes** `table_profiles:`;
   `document_converter` **reads** vars + `nano_banana:{}` + `table_profiles` + toc;
   ingest **writes** provenance (`source_path`, `sha256`, `page`/`slide`,
   `doc_type`, `converted_at`); `kb` **reads** provenance to trace chunks to
   origin. This is the contract that unifies fill → profile → template →
   kb-provenance. Expensive to change later — define it first.
2. **TS↔Python protocol** — `docker run` per-file (stdin/stdout JSON) vs a
   long-running engine container; cleanup/lifecycle.
3. **Staging-dir lifecycle** — location, gitignore, and whether `kb` auto-indexes
   it or it is a manual `kb index` step.
4. **Template dir location** — where DOCX templates + variables live in-repo and
   how the skill discovers them.
5. **Image strategy** — single fat `pi-doc-engine` vs split ingest/produce images
   if size becomes a problem.
6. **Diagram cache + styles location** — where `.mermaid-cache/<md5>.png` lives
   (per-doc dir vs shared, gitignore policy) and where `nano-banana-styles.yaml`
   + named styles are discovered in-repo.
7. **`GEMINI_API_KEY` handling** — inject at `docker run` time (never baked into
   the image); define the fallback-to-mmdc contract when the key is missing.
8. **OCR config (selectable — resolved direction)** — docling exposes per-convert
   OCR fully: `mode` (auto = native-first, OCR only on empty/garbled · force ·
   off), `lang[]` (e.g. `["hungarian","english"]`, multi-language supported),
   and `engine` (EasyOCR default · Tesseract · RapidOCR · OcrMac). The TS facade
   takes a **canonical lang set and maps to per-engine codes** (EasyOCR `hu` vs
   Tesseract `hun`) so a wrong code can't silently fail. Default `mode: auto`
   (don't OCR digital PDFs — slower and often worse). Pair with a `tables: off`
   escape hatch (OCR + 200+ page docs hang TableFormer). Open sub-question: the
   canonical language-name vocabulary + which engines ship in the image.
9. **frontmatter-filler config location** — where defaults / language packs /
   glob overrides live in-repo and how the skill resolves them.

## Out of Scope / Future (lineage recorded, not v1)

- **doc-summarizer** — chunked extraction + subagent summaries (PDF/DOCX/PPTX/
  XLSX/EML/CSV). Consumes the ingest engine; output is a summary, not md-for-kb.
  Could reuse the extraction layer in a later change.
- **docling-graph** — entity/relationship extraction into a **Neo4j** knowledge
  graph. Different storage target; **overlaps `kb`'s own Tier-1 graph extraction**
  — reconcile before adopting.
- **export-google-doc-as-markdown** — gdoc → md via the export endpoint; a cheap
  **ingest source-adapter** that could become a connector. Optional later.
- **document-organizer** — personal archive index/search (~1000 docs). The
  *source* of files to convert, not the converter itself.

## Source Skills — Implementation Reference (read at build time)

The proposal compresses detail. **Do not reimplement from this doc alone** — read
the original skill (richest copy linked) for exact API signatures, pitfalls, and
env quirks. "Keep Python, wrap in TS" means vendoring these, not paraphrasing them.

**These `~/Documents/...` paths are read-at-build-time SOURCES only.** Vendor a
committed copy into the repo (e.g. `packages/document-converter/engine/`) and build
the image from that. The runtime image MUST NOT reference any `~/Documents` /
home-dir path — CI and other machines don't have it. Record exact upstream
versions/commits when copying so the vendored copy is traceable + refreshable.

| Source skill | Richest copy (read this) | Harvest |
|---|---|---|
| `document-conversion` (engine + templating) | `~/Documents/.gemini/skills/document-conversion` (`src/document_converter/`) | `convert_md_to_docx`/`convert_md_to_pdf`/`convert_docx_to_pdf` signatures, `field_updater.py` (template vars), TOC/cover, round-trip `document_meta.xml`, hooks/ (Docker server start/stop) |
| `md-to-pdf-zenit` (styled-diagram recipe) | `~/Documents/.pi/skills/md-to-pdf-zenit/SKILL.md` | step 5c nano-banana flow, `.mermaid-cache/<md5>.png` key, `nano-banana-styles.yaml`, mmdc fallback, the **CLI-greedy-args** + **Chrome-deadlock** pitfalls |
| `docling` (parser + OCR) | `~/Documents/.agents/skills/docling` (`references/parsing.md`, `batch.md`) | `PdfPipelineOptions`, `EasyOcrOptions`/`TesseractOcrOptions` lang codes, `convert_all()` batch, TableFormer modes |
| `pdf-to-markdown-tax-docs` (OCR wisdom) | `~/Documents/.pi/skills/pdf-to-markdown-tax-docs/SKILL.md` + scripts in `~/Documents/openspec/changes/pdf-to-markdown-tax-docs/` | `--ocr-lang hun,eng`, native-first auto-detect, huge-PDF TableFormer hang fix, resumable batch pattern |
| `nano-banana-imagegen` | `~/Documents/.agents/skills/nano-banana-imagegen` (also project `.pi/skills/nano-banana-imagegen`) | `npx @the-focus-ai/nano-banana` invocation, `GEMINI_API_KEY`, prompt-craft, edit/style-transfer/compose modes |
| `frontmatter-filler` | `~/Documents/.agents/skills/frontmatter-filler` (incl. script) | 6-tier layering (CLI → file → glob → language → defaults), language packs, `fill` vs overwrite mode, filename + H1 detection |
| `markdown-table-profiler` | `~/Documents/.agents/skills/markdown-table-profiler` | per-column width-ratio algorithm, `table_profiles:` schema injected into frontmatter |
| `xlsx` | `~/Documents/.gemini/skills/xlsx` (55 files) | openpyxl read/write patterns, formatting rules (if xlsx lane kept) |
| `pptx-processing-anthropic` | `~/Documents/.agents/skills/pptx-processing-anthropic` (57 files) | python-pptx extraction, raw OOXML access, notes/layout handling |
| _future_ `doc-summarizer` | `~/Documents/.claude/skills/doc-summarizer` | chunked-extraction + subagent summary pattern |
| _future_ `docling-graph` | `~/Documents/.claude/skills/docling-graph` (18 files) | Neo4j entity/relationship extraction — reconcile vs `kb` Tier-1 graph |
| _future_ `export-google-doc-as-markdown` | `~/.pi/agent/pi-hermes-memory/skills/export-google-doc-as-markdown` | gdoc export-endpoint trick (ingest source-adapter) |

Note: `~/Documents/.claude/skills/document-conversion` (1394 files) is an
*installed* copy (bundled venv/deps) — useful to inspect resolved dependencies,
but the clean source-of-truth is the `.gemini` copy above.
