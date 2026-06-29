---
name: doc-summarizer
description: >-
  Summarize documents of any size by extracting them with the document-converter
  engine, chunking to fit context, and fanning chunks out to subagents that
  produce structured summaries, then synthesizing one unified summary. Handles
  PDF, DOCX, PPTX, XLSX, HTML, CSV, TXT, MD and more. Use when the user wants to:
  (1) summarize a single document, (2) summarize multiple documents in batch,
  (3) condense content from large files that exceed context limits, (4) get a
  quick overview of document contents. Triggers on: "summarize this document",
  "what's in this PDF", "give me a summary of these files", "extract key points
  from", "condense this document", "TL;DR of this file".
---

# Document Summarizer

Summarize documents of any size. Extraction goes through the **document-converter
engine facade** (`dc.convertToMarkdown`) — the same Docker-quarantined engine the
`document-converter` skill uses. There are NO host-side extractor scripts here;
the facade is the only extraction surface. Chunking and synthesis are agent work.

## Prerequisites

- The `document-converter` package built and runnable: Docker available, image
  built (`cd packages/document-converter && npm run build:image`). See the
  `document-converter` SKILL for the full facade contract.
- Nothing else. No `pdftotext`/`pandoc`/Python on the host — the engine owns all
  format handling inside Docker.

## Step 1 — Extract to Markdown via the engine

Call the facade; never invoke Python, docling, or pdftotext directly.

```ts
import { createDocumentConverter } from "@blackbelt-technology/pi-dashboard-document-converter";
const dc = createDocumentConverter({ image: "pi-doc-engine:0.1.0", stagingDir: "/abs/staging" });

const { output } = await dc.convertToMarkdown("<file_path>");              // digital PDF/DOCX/…
// scanned PDF: pass OCR explicitly
await dc.convertToMarkdown("<file_path>", { ocr: { mode: "force", lang: ["english"] } });
```

The result is a provenance-stamped `.md` in `stagingDir`. Read that file to get
the document text. On failure the call rejects with `DocConverterError`
(`.code`, `.stderr`) — surface `UNSUPPORTED_FORMAT`, `OCR_LANG_UNSUPPORTED`,
`INGEST_FAILED`, `DOCKER_UNAVAILABLE` rather than retrying blindly.

## Step 2 — Decide direct vs. chunked

Measure the extracted Markdown:

- **< ~8,000 words (~10k tokens):** summarize directly in the current context
  (Step 3a).
- **>= ~8,000 words:** chunk and fan out (Step 3b).

## Step 3a — Direct summarization (small documents)

Read the extracted `.md` and produce a summary using the [output format](#summary-output-format)
below: title/subject, key points, entities, document type, language.

## Step 3b — Chunked summarization (large documents)

1. **Chunk.** Split the extracted Markdown into context-friendly pieces
   (~3,000–4,000 tokens each). Prefer natural boundaries — headings, sections,
   page markers in the engine output — over blind character cuts. No script
   needed; split with judgment.
2. **Fan out.** For each chunk launch a subagent (`Agent` tool,
   `subagent_type: "general-purpose"`), up to ~3–4 concurrent:

   ```
   Summarize this text chunk (chunk {i}/{total} of document '{filename}').
   Extract: key points, entities (people/orgs/dates/amounts), topics, and any
   conclusions or action items. Output as structured markdown.

   Text:
   {chunk_text}
   ```
3. **Merge.** Collect chunk summaries, deduplicate entities and key points, and
   produce one unified summary in the [output format](#summary-output-format). If
   the merged result is still > ~8,000 words, run one more summarization pass on
   it.

## Batch summarization

For a directory or glob: extract each file via `dc.convertToMarkdown` (run a few
in parallel), then apply the single-document workflow per file. Emit a table:

```markdown
| # | File | Type | Language | Words | Key Topics | Summary |
|---|------|------|----------|-------|------------|---------|
| 1 | invoice.pdf | Invoice | EN | 450 | AcmeCorp, 2024Q4 | Quarterly invoice… |
```

## Summary output format

```markdown
## Summary: {document_name}

**Type**: {document_type}
**Language**: {language}
**Word Count**: {word_count}
**Date**: {detected_date or file_modified_date}

### Key Points
- Point 1
- Point 2

### Entities
- **People**: …
- **Organizations**: …
- **Dates**: …
- **Amounts**: …

### Brief Summary
{2-3 paragraph narrative summary}
```

## Special cases

- **Scanned PDF, no text:** the engine returns little/empty text on `mode: auto`.
  Re-run with `ocr: { mode: "force", lang: [...] }` (canonical language names).
- **Encrypted / unsupported / empty:** surface the `DocConverterError.code` and
  `.stderr`; report metadata only.
- **Mixed-language:** report the primary language, note others present.
