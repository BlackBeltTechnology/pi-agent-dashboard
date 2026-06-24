# File index — Document converter

Covers `packages/document-converter/`. TS facade over Dockerized Python engine (`pi-doc-engine`). Bidirectional: ingest PDF/DOCX/PPTX/XLSX→provenance-stamped Markdown for kb; produce Markdown→templated DOCX/PDF with diagrams, TOC, cover, round-trip.

| `<path>` | <purpose> |
|---|---|
| `packages/document-converter/README.md` | Package overview. Facade = only call surface. Ingest + produce examples. API usage snippet. |
| `packages/document-converter/engine/.dockerignore` | Excludes `__pycache__`, `*.pyc`, `.venv`, `.mermaid-cache` from build context. |
| `packages/document-converter/engine/.gitignore` | Ignores `__pycache__`, `*.pyc`, `.pytest_cache`, `.mermaid-cache`. |
| `packages/document-converter/engine/Dockerfile` | Builds `pi-doc-engine` image. `python:3.12-slim`. Bundles docling+OCR engines, python-docx/pptx, openpyxl, pandoc, LibreOffice, mmdc+chrome-headless-shell, nano-banana, frontmatter_filler, markdown_table_profiler. Build context = `engine/`. No home-dir path. |
| `packages/document-converter/engine/IMAGE_VERSION` | Image version string. `0.1.0`. Read by `build-image.sh` for default tag. |
| `packages/document-converter/engine/README.md` | Engine image guide. Build via `build-image.sh`. stdin/stdout JSON invocation contract. Container paths only. `GEMINI_API_KEY` injected at run time. |
| `packages/document-converter/engine/VENDOR.md` | Vendored-engine provenance record. Upstream sources, versions, copy dates, anchor-file sha256. Runtime deps. Refresh procedure. |
| `packages/document-converter/engine/build-image.sh` | Builds image from vendored copy. Default tag `pi-doc-engine:$(cat IMAGE_VERSION)`; override `IMAGE_TAG`. Guard greps `*.py` for home-dir/source-skill paths; exit 1 on leak. |
| `packages/document-converter/engine/document_converter/` | Vendored document_converter Python engine (40 modules). Produce-side: md→docx/pdf, templates, TOC, cover, round-trip, diagrams. See engine/VENDOR.md for provenance. Do not edit; refresh from upstream. |
| `packages/document-converter/engine/engine_cli.py` | Engine command boundary. Only entry facade invokes. Reads one JSON request stdin, writes one JSON response stdout, exit code signals success. Dispatches 7 commands: convertToMarkdown, renderDocx, renderPdf, extractForEdit, mergeBack, fillFrontmatter, profileTables. Emits stable error codes. |
| `packages/document-converter/engine/frontmatter_filler/doc-meta.sample.yaml` | Sample frontmatter-filler config. `defaults` block: template, cover/toc flags, logos, branding. Placed as `.doc-meta.yaml` at project root; nearest-config walk-up. |
| `packages/document-converter/engine/frontmatter_filler/fill.py` | Vendored frontmatter-filler. PEP 723 inline `ruamel.yaml>=0.18`. Fills/refreshes YAML frontmatter across markdown tree. Layering: defaults→language pack→glob override→CLI. |
| `packages/document-converter/engine/markdown_table_profiler/profile.py` | Vendored table profiler. PEP 723, no deps. Auto-sizes markdown table columns, writes `table_profiles:` frontmatter. Heuristic, language-agnostic, re-runnable. |
| `packages/document-converter/engine/nano-banana-styles.yaml` | Named Mermaid render styles for nano-banana (Gemini) image diagrams. Each style: description, prompt, negative, model, background, width. `default: ros-3d`. |
| `packages/document-converter/engine/tests/test_styled_diagrams.py` | Engine-internal pytest. Styled-diagram md5 cache + mmdc fallback. Below TS↔engine boundary. Stdlib + monkeypatch; no docling, no Docker. |
| `packages/document-converter/package.json` | Package manifest. Name `@blackbelt-technology/pi-dashboard-document-converter`. private. Exports `.`+`./schema`. Scripts: `build:image`, `test` (vitest run). Node >=22.5.0. |
| `packages/document-converter/src/__tests__/engine.test.ts` | Tests `runEngine` envelope handling. ok-envelope strip, error mapping, non-JSON stdout, nonzero exit. Injects fake runner. |
| `packages/document-converter/src/__tests__/facade.test.ts` | Tests `createDocumentConverter`. convertToMarkdown writes staging `.md` with provenance. Real tmpdir; injected runner mocks engine. |
| `packages/document-converter/src/__tests__/integration.test.ts` | Opt-in integration. One real conversion per direction against built image. Skipped unless `DOC_ENGINE_IMAGE` set + docker on PATH. Never in default `npm test`. |
| `packages/document-converter/src/__tests__/ocr.test.ts` | Tests `mapOcrCodes`. Per-engine code mapping, case/whitespace-insensitive, rapidocr returns `[]`, unsupported throws. |
| `packages/document-converter/src/__tests__/provenance.test.ts` | Tests provenance builder + stamper. Deterministic record with fixed timestamp, frontmatter serialization, inject into existing frontmatter. |
| `packages/document-converter/src/__tests__/routing.test.ts` | Tests extension routing. `docTypeOf`, `ingestDocType`, `isIngestable`. Known/unknown extensions, ingestable set. |
| `packages/document-converter/src/engine.ts` | Docker invocation layer. `runEngine(cfg, req)` spawns `docker run --rm -i <image>`, pipes JSON request stdin, reads JSON response stdout. Path-identical mounts (`-v dir:dir`). Maps exit codes + envelope to `DocConverterError`. Injectable `EngineRunner`. |
| `packages/document-converter/src/errors.ts` | `DocConverterError` class + `DocConverterErrorCode` union. Single error type facade rejects with. Codes: DOCKER_UNAVAILABLE, ENGINE_NONZERO, BAD_RESPONSE, INPUT_NOT_FOUND, OCR_*, UNSUPPORTED_FORMAT, INGEST/PRODUCE/FILL/PROFILE_FAILED, INTERNAL. |
| `packages/document-converter/src/index.ts` | Facade entry. `createDocumentConverter(config)` returns object with convertToMarkdown, renderDocx, renderPdf, extractForEdit, mergeBack, fillFrontmatter, profileTables. Only call surface. Re-exports errors, types, schema, ocr, routing, provenance. |
| `packages/document-converter/src/ocr.ts` | Canonical language name→per-engine OCR code. `mapOcrCodes(langs, engine)`. EasyOCR `hu` vs Tesseract `hun`. rapidocr returns `[]`. Unsupported throws `OCR_LANG_UNSUPPORTED`. `SUPPORTED_LANGUAGES`. |
| `packages/document-converter/src/provenance.ts` | Provenance frontmatter writer. `sha256File`, `buildProvenance`, `provenanceFrontmatter`, `stampProvenance`. Stamps ingested `.md` with origin metadata. Byte-stable by hash. |
| `packages/document-converter/src/routing.ts` | Extension routing. `EXT_TO_DOCTYPE` map. `docTypeOf`, `isIngestable`, `ingestDocType`. Ingestable set = pdf/docx/pptx/xlsx. Throws `UNSUPPORTED_FORMAT`. |
| `packages/document-converter/src/schema.json` | JSON Schema mirror of `schema.ts`. draft-07. Unified document frontmatter. `additionalProperties: true`. Keep in sync with `schema.ts`. |
| `packages/document-converter/src/schema.ts` | Unified document-frontmatter schema. Shared bus contract across stages. Types: `DocumentFrontmatter`, `Provenance`, `NanoBananaConfig`, `TableProfiles`, `TemplateVars`, `DocType`, `DiagramFormat`. Key consts. Mirrors `schema.json`. |
| `packages/document-converter/src/types.ts` | Facade option + result types. `OcrEngine`, `OcrMode`, `OcrOptions`, `ConvertToMarkdown*`, `RenderDocx/PdfOptions`, `Produce/Extract/MergeBack`, `FillFrontmatter/ProfileTablesOptions`. |
| `packages/document-converter/tsconfig.json` | TS config. Extends `../../tsconfig.base.json`. rootDir `src`, outDir `dist`. |
| `packages/document-converter/vitest.config.ts` | Vitest config. include `src/**/__tests__/**/*.test.ts`. node env, forks pool, maxWorkers 50%. |

See change: document-converter.
