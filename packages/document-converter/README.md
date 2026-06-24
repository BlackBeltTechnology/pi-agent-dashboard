# @blackbelt-technology/pi-dashboard-document-converter

TypeScript facade over a Dockerized Python document engine (`pi-doc-engine`).
The **only** call surface for document conversion in the repo. Callers never
touch Python, docling, pandoc, or the nano-banana CLI.

- **Ingest** (feeds kb): PDF/DOCX/PPTX/XLSX → provenance-stamped Markdown.
- **Produce**: Markdown → templated DOCX/PDF, diagrams, round-trip edit/merge.
- Engine quarantined in Docker; TS is the contract + orchestrator.

## Facade API

```ts
import { createDocumentConverter } from "@blackbelt-technology/pi-dashboard-document-converter";

const dc = createDocumentConverter({
  image: "pi-doc-engine:0.1.0",
  stagingDir: "/abs/kb-staging",
});

// Ingest -> Markdown with provenance frontmatter (written into stagingDir).
const { output, provenance } = await dc.convertToMarkdown("/docs/report.pdf", {
  ocr: { mode: "auto", lang: ["hungarian", "english"], engine: "tesseract" },
});

// Produce -> templated DOCX (styled diagrams opt-in via nanoBanana).
await dc.renderDocx("/docs/spec.md", {
  output: "/out/spec.docx",
  template: "default",
  nanoBanana: { enabled: true, style: "ros-3d" },
});

await dc.renderPdf("/out/spec.docx", { output: "/out/spec.pdf", pageSize: "a4" });

// Round-trip.
const { meta } = await dc.extractForEdit("/in.docx", "/edit.md");
await dc.mergeBack("/in.docx", "/edit.md", { output: "/out.docx", meta });

// Frontmatter tooling over the unified schema.
await dc.fillFrontmatter(["spec/**/*.md"], { language: "hu" });
await dc.profileTables(["spec/**/*.md"]);
```

Every method returns a typed result or rejects with `DocConverterError`
(`.code`, `.stderr`, `.exitCode`). OCR canonical language names are mapped to
per-engine codes (`mapOcrCodes`); an unsupported name/engine raises
`OCR_LANG_UNSUPPORTED` before the engine runs.

## Unified frontmatter schema

`./schema` (also `src/schema.json`) is the single contract every stage reads/
writes: template vars (frontmatter-filler) · `table_profiles` (table profiler) ·
`nano_banana` (styled diagrams) · `provenance` (ingest, read by kb).

## kb consumption seam (kb is NOT modified)

Ingest writes provenance-stamped `.md` into `stagingDir`. kb consumes it via its
existing `filesystem` source — no kb code change:

```bash
# Point a kb filesystem source at the staging dir and index it.
kb index  --source /abs/kb-staging
kb search "deferred tax liabilities" --source /abs/kb-staging
```

The `provenance` frontmatter (`source_path`, `sha256`, `doc_type`,
`converted_at`, optional `page`/`slide`) lets kb chunks trace back to the
originating file. Re-ingesting an unchanged file yields the same `sha256`, so
staging output is byte-stable (idempotent by hash).

## Templates (runtime-mounted, not baked)

DOCX templates are NOT baked into the image — pass `templatesDir` (an absolute
host dir containing `<template>/template.docx`); the facade bind-mounts it. Keeps
branded/template assets out of the image and the repo.

## Engine image

Built from `engine/` (vendored Python; see `engine/VENDOR.md`):

```bash
npm run build:image   # -> pi-doc-engine:$(cat engine/IMAGE_VERSION)
```

Heavy (docling ML models + LibreOffice + pandoc + chrome-headless-shell). The
image runs as root, so an `mmdc` shim injects `--no-sandbox`; opencv needs
`libgl1`; `@puppeteer/browsers` needs `unzip` (all handled in the Dockerfile).
See `engine/README.md` for the JSON `docker run` contract.

## Integration test (opt-in)

Verified green against `pi-doc-engine:0.1.0`. Build the image, then:

```bash
DOC_ENGINE_IMAGE=pi-doc-engine:0.1.0 \
  DOC_ENGINE_PDF=/abs/sample.pdf \
  DOC_ENGINE_TEMPLATES=/abs/templates \
  npx vitest run integration
```

## Tests

```bash
npm test                                          # TS facade unit tests (vitest)
python -m pytest engine/tests -q                  # engine styled-diagram/cache tests
```
