# DOX — packages/document-converter/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `engine.ts` | Docker invocation layer. `runEngine(cfg, req)` spawns `docker run --rm -i <image>`, pipes JSON request stdin, reads JSON response stdout. Path-identical mounts (`-v dir:dir`). Maps exit codes + envelope to `DocConverterError`. Injectable `EngineRunner`. |
| `errors.ts` | `DocConverterError` class + `DocConverterErrorCode` union. Single error type facade rejects with. Codes: DOCKER_UNAVAILABLE, ENGINE_NONZERO, BAD_RESPONSE, INPUT_NOT_FOUND, OCR_*, UNSUPPORTED_FORMAT, INGEST/PRODUCE/FILL/PROFILE_FAILED, INTERNAL. |
| `index.ts` | Facade entry. `createDocumentConverter(config)` returns object with convertToMarkdown, renderDocx, renderPdf, extractForEdit, mergeBack, fillFrontmatter, profileTables. Only call surface. Re-exports errors, types, schema, ocr, routing, provenance. |
| `ocr.ts` | Canonical language name→per-engine OCR code. `mapOcrCodes(langs, engine)`. EasyOCR `hu` vs Tesseract `hun`. rapidocr returns `[]`. Unsupported throws `OCR_LANG_UNSUPPORTED`. `SUPPORTED_LANGUAGES`. |
| `provenance.ts` | Provenance frontmatter writer. `sha256File`, `buildProvenance`, `provenanceFrontmatter`, `stampProvenance`. Stamps ingested `.md` with origin metadata. Byte-stable by hash. |
| `routing.ts` | Extension routing. `EXT_TO_DOCTYPE` map. `docTypeOf`, `isIngestable`, `ingestDocType`. Ingestable set = pdf/docx/pptx/xlsx. Throws `UNSUPPORTED_FORMAT`. |
| `schema.ts` | Unified document-frontmatter schema. Shared bus contract across stages. Types: `DocumentFrontmatter`, `Provenance`, `NanoBananaConfig`, `TableProfiles`, `TemplateVars`, `DocType`, `DiagramFormat`. Key consts. Mirrors `schema.json`. |
| `types.ts` | Facade option + result types. `OcrEngine`, `OcrMode`, `OcrOptions`, `ConvertToMarkdown*`, `RenderDocx/PdfOptions`, `Produce/Extract/MergeBack`, `FillFrontmatter/ProfileTablesOptions`. |
