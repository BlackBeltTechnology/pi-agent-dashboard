---
name: document-converter
description: Convert documents bidirectionally via the pi-doc-engine facade. Ingest PDF/DOCX/PPTX/XLSX to provenance-stamped Markdown for kb (with selectable OCR). Produce templated DOCX/PDF from Markdown with diagrams (mmdc or styled nano-banana), TOC, cover page, and round-trip extract/edit/merge. Use on requests like "convert this PDF to markdown", "ingest these docs into kb", "make a DOCX from markdown with our template", "render this spec to PDF", "OCR this scanned Hungarian PDF", "edit this DOCX and merge back", "fill frontmatter", "auto-size tables".
---

# Document Converter

TypeScript facade (`@blackbelt-technology/pi-dashboard-document-converter`) over
the Dockerized `pi-doc-engine` Python engine. **Always call the facade — never
Python, docling, pandoc, or the nano-banana CLI directly.** The engine is
quarantined in Docker; the facade is the only call surface.

Internals reference: `packages/document-converter/README.md` (facade API),
`packages/document-converter/engine/README.md` (JSON `docker run` contract).
Do NOT read the vendored Python under `engine/document_converter/`.

## Prerequisites

- Docker available; image built: `cd packages/document-converter && npm run build:image`.
- Styled diagrams (nano-banana) need `GEMINI_API_KEY` at run time; absent or on
  failure, rendering falls back to mmdc (never hard-fails).

## Two directions

### Ingest — any format → Markdown for kb

```ts
import { createDocumentConverter } from "@blackbelt-technology/pi-dashboard-document-converter";
const dc = createDocumentConverter({ image: "pi-doc-engine:0.1.0", stagingDir: "/abs/kb-staging" });

await dc.convertToMarkdown("/docs/report.pdf");                       // digital PDF (auto: native-first)
await dc.convertToMarkdown("/docs/scan.pdf", {                        // scanned HU PDF
  ocr: { mode: "force", lang: ["hungarian", "english"], engine: "tesseract" },
});
await dc.convertToMarkdown("/docs/huge.pdf", { tables: "off" });      // escape hatch: skip TableFormer
```

Output `.md` lands in `stagingDir` with `provenance` frontmatter. Feed kb via its
existing filesystem source (kb is NOT modified):

```bash
kb index  --source /abs/kb-staging
kb search "<query>" --source /abs/kb-staging
```

OCR `lang` takes **canonical names** (`"hungarian"`); the facade maps to per-engine
codes. A wrong name raises `OCR_LANG_UNSUPPORTED` — no silent empty OCR. Default
`mode: auto` skips OCR on digital PDFs.

### Produce — Markdown → DOCX/PDF

```ts
await dc.renderDocx("/spec.md", { output: "/spec.docx", template: "default" });
await dc.renderDocx("/spec.md", { output: "/spec.docx", nanoBanana: { enabled: true, style: "ros-3d" } });
await dc.renderPdf("/spec.docx", { output: "/spec.pdf", pageSize: "a4" });

const { meta } = await dc.extractForEdit("/in.docx", "/edit.md");     // round-trip
await dc.mergeBack("/in.docx", "/edit.md", { output: "/out.docx", meta });
```

Template vars come from frontmatter. Diagrams render with mmdc by default; opt in
to styled images per-doc via `nanoBanana` (md5-cached `.mermaid-cache/<md5>.png`,
deterministic, mmdc fallback).

## Frontmatter tooling (the shared bus)

```ts
await dc.fillFrontmatter(["spec/**/*.md"], { language: "hu" });       // defaults + language packs + globs
await dc.profileTables(["spec/**/*.md"]);                             // inject table_profiles width ratios
```

All stages read/write one unified schema (`./schema`): template vars ·
`table_profiles` · `nano_banana` · `provenance`.

## Errors

Every method rejects with `DocConverterError` (`.code`, `.stderr`, `.exitCode`):
`UNSUPPORTED_FORMAT`, `OCR_LANG_UNSUPPORTED`, `INGEST_FAILED`, `PRODUCE_FAILED`,
`DOCKER_UNAVAILABLE`, … Surface `.code` + `.stderr`; do not retry blindly.
