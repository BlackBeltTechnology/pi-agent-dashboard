---
name: wordcraft
description: Headless word processing with WordCraft (DOCX/ODT/RTF documents, 600+ editing commands, format conversion, PDF export, page rendering), provisioned on demand by pi-craft. Use for "write a report as a docx", "convert this markdown to a Word document", "turn this docx into a pdf", "append a paragraph to this docx", "export this document to pdf and check the page count", "extract the text of this docx".
---

# WordCraft — headless word processor

WordCraft is ArtCraft's word processor (617 commands in 0.7.0). `pi-craft` provisions the headless `wordcraft-cli`
on first use (no desktop app). Choosing between apps, the loop, hand-off formats and the MCP policy live in
`craft-studio`; documents go to WordCraft, never through DeckCraft/DesignCraft. For fixed-layout PDF editing use PdfCraft.

## What it is for / formats

Create and edit text documents, convert between formats, export PDF/PNG. `convert` reads/writes
`docx odt rtf html md tex txt json pdf png xml` (`doc` is read-only). The native project file is the document
itself (`.docx`; `.odt` also works). Output format of `run --save`, `convert`, `render` follows the file extension.

## CLI dialect

`pi-craft wordcraft exec <args…>` passes the arguments to `wordcraft-cli`.

```bash
wordcraft-cli commands [--json]                       # list every command id (table) / JSON with params; NO --filter
wordcraft-cli run [--file F | --template T] --cmd 'id={json}' [--cmd …] [--save OUT] [--print] [--author NAME]
wordcraft-cli convert <in> <out> [--markup]           # format from the extension
wordcraft-cli text <file>                             # plain text
wordcraft-cli info <file>                             # JSON: pages, words, paragraphs, properties
wordcraft-cli inspect <file>                          # JSON document structure (blocks, styles, comments)
wordcraft-cli render <file> <out.png> [--page N] [--scale S]
wordcraft-cli parity [--markdown]                     # feature catalog
```

- There is **no `describe`**: parameters are in `commands --json` (`"params"` is a schema-ish string).
- `run` takes **repeated `--cmd`**, each `id` or `id={json}` (single-quote the JSON). Commands run in order against
  one in-memory document; `--file F` opens an existing one, no `--file` starts a blank one.
- The caret model is word-processor-like: `text.insert` types at the caret and the caret ends after the text; use
  `text.newParagraph`, `caret.docEnd`, `caret.docStart` to move. Style a paragraph *before* typing into it
  (`para.heading1` then `text.insert`), as in a GUI.
- Inside `run`, export commands work too: `--cmd 'file.exportPdf={"path":"e.pdf"}'`, `file.saveAs` (`{"path":…}`).

## State between invocations

None. Every `run` builds its document in memory and discards it at exit unless `--save OUT` writes it (`--file F` opens
F but does **not** write back unless you `--save`; use `--save F` to overwrite in place). Chain steps through files:
`run … --save a.docx`, then `run --file a.docx … --save b.docx`, then `convert`.

## Discovery first

```bash
pi-craft wordcraft exec commands | grep -i heading            # id, label, shortcut, menu location
pi-craft wordcraft exec commands --json | jq '.[] | select(.id=="para.indents")'   # params + mutates
pi-craft wordcraft exec inspect doc.docx                      # block indices, styles of an existing document
```

Id families: `text.*` (typing, breaks), `para.*` (alignment, spacing, styles, lists), `format.*` (character), `styles.*`,
`list.*`, `insert.*`/`table.*`, `edit.*` (find/replace), `caret.*`, `document.*` (`document.setText` replaces everything),
`file.*`, `fields.*`, `design.*`.

## Traps

- **One failing `--cmd` aborts the whole run and writes nothing**: with a bad id (`nosuch.cmd: unknown command`) or bad
  JSON (`text.insert=notjson` → "bad JSON params") the exit code is 1 and the `--save` file is not created.
- `commands --filter` does not exist (unlike EffectCraft/PhotoCraft): "unknown option --filter". Pipe to `grep`.
- Without `--save` (and without `--print`) `run` prints each command's result (`text.insert: {"anchor":…}`) and the document is lost.
- A new document is one empty paragraph; `text.pageBreak` puts a form feed **inside** the paragraph (`inspect` shows `Page one\fPage two`) and `info` then reports `pages: 2`.
- `render` default scale is 2: a Letter page (612×792 pt) is **1224×1584 px**; `--scale 1` gives 612×792.
- `--page N` beyond the document is an error; pages are 1-based.
- `run --save out.pdf` works (export by extension) but `convert` is the clearer way to go docx → pdf.
- md → docx keeps headings and lists as styles (`inspect` shows `Heading1` for `# Title`, `ListParagraph` for `- a`); converting that docx to txt gives `•<TAB>a`.
- `--author NAME` names tracked changes/comments; set it when the document is shared.

## MCP route (opt-in)

`pi-craft wordcraft mcp --register` writes a `craft-wordcraft` entry into `.pi/mcp.json` (16 tools). It is confined to
the project directory through `--automation-read-root` / `--automation-write-root` (a root you leave out grants no
access). Use it for a long session on one open document; bash for everything here. GUI bridging (`--connect`) is out of scope.

## Recipes

```bash recipe: report-pdf
# Build a report from commands (style first, then type), save docx, export to pdf, check page text.
pi-craft wordcraft exec run \
  --cmd para.heading1 --cmd 'text.insert={"text":"Quarterly Report"}' \
  --cmd text.newParagraph --cmd para.normal \
  --cmd 'text.insert={"text":"Revenue grew by twelve percent."}' \
  --save report.docx
pi-craft wordcraft exec text report.docx
pi-craft wordcraft exec convert report.docx report.pdf
pi-craft verify report.pdf --pages 1 --text-contains "Revenue grew"
```

```bash recipe: two-pages
# A page break makes a 2-page document; run saves nothing unless --save is given.
pi-craft wordcraft exec run \
  --cmd 'text.insert={"text":"Page one"}' --cmd text.pageBreak --cmd 'text.insert={"text":"Page two"}' \
  --save pb.docx
pi-craft wordcraft exec info pb.docx
pi-craft wordcraft exec convert pb.docx pb.pdf
pi-craft verify pb.pdf --pages 2 --text-contains "Page two"
```

```bash recipe: markdown-to-docx
# md -> docx (editable hand-off) -> pdf (delivery); html works the same way.
printf '# Title\n\nHello **world**.\n\n- alpha\n- beta\n' > note.md
pi-craft wordcraft exec convert note.md note.docx
printf '<html><body><h1>HTML head</h1><p>para</p></body></html>' > page.html
pi-craft wordcraft exec convert page.html html.docx
pi-craft wordcraft exec convert note.docx note.pdf
pi-craft verify note.pdf --pages 1 --text-contains "Hello world"
```

```bash recipe: append-and-render
# Re-open an existing docx (--file), jump to the end, add a paragraph, save under a new name, render page 1.
pi-craft wordcraft exec run --cmd 'text.insert={"text":"First paragraph."}' --save base.docx
pi-craft wordcraft exec run --file base.docx \
  --cmd caret.docEnd --cmd text.newParagraph --cmd 'text.insert={"text":"Appended paragraph."}' \
  --save more.docx
pi-craft wordcraft exec text more.docx
pi-craft wordcraft exec render more.docx first.png --page 1
pi-craft verify first.png --size 1224x1584
```
