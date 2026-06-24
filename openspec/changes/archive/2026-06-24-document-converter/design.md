## Context

The user owns mature Python document-processing skills (`document-conversion` with the
`document_converter` package, `docling`, `frontmatter-filler`, `markdown-table-profiler`,
`md-to-pdf-zenit`, `pdf-to-markdown-tax-docs`, `nano-banana-imagegen`) that live outside
this TypeScript monorepo. The goal is to make them usable from inside the dashboard —
primarily to feed the `kb` package (PDF/DOCX/PPTX/XLSX → Markdown → index) and to produce
templated DOCX/PDF deliverables — without losing Python fidelity and without requiring a
host Python toolchain.

Constraints established during exploration:
- `kb` ingests Markdown only (`indexer.ts` walks `.md|.mdx|.markdown`; `sources.ts`: "KB
  only reads markdown"; "zero runtime deps"). It is the integration seam and MUST stay
  untouched.
- Governing rule: **keep Python, wrap in TS** — any lane where a pure-TS library loses
  features stays on the Python engine behind a process boundary.
- The repo already has Docker infra precedent (archived `docker-packaging`,
  `docker-test-harness`; the `document-conversion` skill ships Docker server hooks).

See `proposal.md` for motivation and `specs/document-converter/spec.md` for requirements.

## Goals / Non-Goals

**Goals:**
- One TypeScript facade (`packages/document-converter`) as the sole call surface, plus a
  thin NL-triggered skill.
- Bidirectional conversion: ingest (any format → provenance Markdown for kb) and produce
  (Markdown → templated DOCX/PDF, diagrams, round-trip).
- Full feature parity with the adapted Python skills, including templating, styled
  nano-banana diagrams with md5 cache + mmdc fallback, frontmatter fill, table profiling,
  and selectable OCR.
- A single unified document-frontmatter schema shared by every stage.
- Reproducible, self-contained `pi-doc-engine` Docker image vendored from in-repo source.

**Non-Goals:**
- Modifying `kb` internals (consumed via its existing filesystem-source contract).
- Pure-TS reimplementation of any lane that would lose features.
- v1 inclusion of `doc-summarizer`, `docling-graph` (Neo4j), the gdoc-export adapter, or
  `document-organizer` (recorded as future).
- Runtime dependence on any `~/Documents` / home-dir path.

## Decisions

### Decision 1: TS facade + Dockerized Python engine, CLI/JSON boundary
TypeScript owns the contract and orchestration; Python owns conversion; they meet at a
`docker run` boundary exchanging JSON over stdout. Alternatives: (a) pure-TS rewrite —
rejected, loses docling OCR/layout, python-docx tables, the templating engine; (b)
host-venv subprocess — rejected, "works on my machine" env drift; (c) long-running
engine server — deferred, more lifecycle code than per-call `docker run` needs for v1.

### Decision 2: Single `pi-doc-engine` image, vendored from repo
One image carries both directions (docling/python-docx/pptx/openpyxl for ingest;
`document_converter`/pandoc/Gotenberg for produce) plus nano-banana CLI, chrome-headless-
shell, frontmatter-filler, and markdown-table-profiler. The engine source is **copied into
the repo** (`packages/document-converter/engine/`) with upstream versions recorded; the
image builds from that copy, never from `~/Documents`. Alternative: split ingest/produce
images — deferred to a later change if image weight becomes a problem (open question).

### Decision 3: kb seam is a staging directory of Markdown
Ingest writes provenance-stamped `.md` into a staging dir; kb points a `filesystem` source
at it and runs its normal `index`/`search`. No kb code changes. Alternative: a new kb
loader for binary formats — rejected, violates kb's markdown-only design and "zero runtime
deps" value.

### Decision 4: Unified document-frontmatter schema is the shared bus
A single YAML frontmatter schema is read/written by every stage: frontmatter-filler writes
template vars (`project_name`, `author`, `toc_heading`, `language`, `logos`,
`document_id`); markdown-table-profiler writes `table_profiles:`; `document_converter`
reads vars + `nano_banana:{}` + `table_profiles` + toc; ingest writes provenance
(`source_path`, `sha256`, `page`/`slide`, `doc_type`, `converted_at`); kb reads provenance.
Defined first because it is expensive to change later.

### Decision 5: Selectable OCR with safe defaults
OCR is a per-convert option: `mode` (auto | force | off), `lang[]` (canonical names,
multi-language), `engine` (EasyOCR | Tesseract | RapidOCR | OcrMac). The facade maps
canonical names to per-engine codes (EasyOCR `hu` vs Tesseract `hun`) so a wrong code
raises a typed error rather than silently producing empty output. Default `mode: auto`
(native-first) encodes the tax-docs lesson that OCR is slower and often worse on digital
PDFs. A `tables: off` escape hatch accompanies OCR for huge PDFs that hang TableFormer.

### Decision 6: Styled diagrams reuse the md5-cache + mmdc-fallback recipe verbatim
Opt-in via `nano_banana: {enabled, style}`. Cache key = md5 of diagram source →
`.mermaid-cache/<md5>.png`; misses generated via nano-banana CLI with a named style from
`nano-banana-styles.yaml`; any failure falls back to mmdc. The md5 cache converts
non-deterministic image-gen into reproducible builds. `GEMINI_API_KEY` is injected at
`docker run` time, never baked into the image.

## Risks / Trade-offs

- [Heavy image: docling models + LibreOffice/Gotenberg + pandoc] → Accept as the cost of
  full-fidelity wrapping; revisit split images if size blocks CI (open question).
- [Non-deterministic nano-banana output] → md5 source cache makes repeat renders
  deterministic; mmdc fallback guarantees a doc always produces.
- [Per-engine OCR language code mismatch] → Canonical-name → per-engine-code mapping in the
  facade; unknown combinations raise typed errors.
- [Docker required for all conversion] → Consistent with existing repo Docker infra; the
  facade fails with a clear typed error when Docker is unavailable.
- [Vendored engine drift from upstream skills] → Record upstream versions/commits at vendor
  time so the copy is traceable and refreshable.
- [Large XLSX → noisy Markdown] → xlsx lane treated as borderline; flatten strategy
  resolved during implementation (open question).

## Migration Plan

- Additive only: new package, new skill, new Docker image. No existing behavior changes.
- `kb` adoption is opt-in: add a `filesystem` source pointing at the staging dir.
- Rollback: remove the staging-dir source and the package/skill; `kb` and the rest of the
  repo are unaffected because nothing else depends on the converter.

## Open Questions

- Single fat `pi-doc-engine` vs split ingest/produce images if weight blocks CI.
- Staging-dir location + gitignore, and whether kb auto-indexes it or it is a manual step.
- Template dir location and discovery; frontmatter-filler config (defaults/language
  packs/glob overrides) location.
- Diagram cache + `nano-banana-styles.yaml` location and gitignore policy.
- Canonical OCR language vocabulary and which OCR engines ship in the image.
- Whether the xlsx lane ships in v1 and its sheet→Markdown flatten strategy.
- TS↔Python protocol detail: per-call `docker run` for v1, long-running container later.
