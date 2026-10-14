---
name: pdfcraft
description: Headless PDF work with PdfCraft, provisioned on demand by pi-craft - combine, split, extract, rotate, delete and reorder pages, set metadata, read text, render a page to png, audit for faux redactions, and script any of its 163 automation tools. Use for "merge these two PDFs", "extract pages 1 and 3 from this PDF", "rotate page 1 and drop page 2", "render page 2 of this PDF as a png", "what text is in this PDF", "stamp text onto a page".
---

# PdfCraft — headless PDF editing

PdfCraft is ArtCraft's PDF app. `pi-craft` provisions the headless `pdfcraft-cli` on first use (no desktop app).
Choosing between apps, the discover → execute → save → verify loop, hand-off formats and the MCP policy live in
`craft-studio`. Note: `pi-craft verify --pages/--text-contains` itself uses `pdfcraft-cli`, so any PDF you make is
checked by the same engine that wrote it.

## What it is for / formats

PDF in, PDF / png (`.png .jpg .tif .pam`) / text out. Page-level operations (combine, split, extract, rotate,
delete, move, blank pages), metadata, text extraction, page rendering, forms, bookmarks, stamps, redaction,
OCR/optimise batches. There is no project file: a PDF is the document. For laying out a new multi-page document
use DesignCraft or WordCraft (then `convert … pdf`); PdfCraft edits PDFs that already exist.

## CLI dialect

`pi-craft pdfcraft exec <args…>` passes the arguments to `pdfcraft-cli`.
PdfCraft has **no `commands` / `describe` / `--cmd`**: it has direct subcommands plus a JSON tool registry.

```bash
pdfcraft-cli tools                                    # JSON list of the 163 automation tools + input schemas
pdfcraft-cli info <f.pdf>                             # JSON summary (pages, page_labels, bookmarks, encrypted, …)
pdfcraft-cli text <f.pdf> [--page N]                  # extracted text, pages separated by form feeds
pdfcraft-cli render <f.pdf> --page N [--dpi 96] --out x.png
pdfcraft-cli edit <in.pdf> --out <out.pdf> [--rotate 1,3:90] [--delete 2,4] [--move 5:1] [--insert-blank 1] [--title T] [--author A]
pdfcraft-cli combine a.pdf b.pdf … --out c.pdf
pdfcraft-cli extract <in.pdf> --pages 1,3,5 --out o.pdf
pdfcraft-cli split <in.pdf> (--every N | --before 3,7) [--out-dir DIR]
pdfcraft-cli audit <f.pdf>                            # faux-redaction finder (JSON; fails when found)
pdfcraft-cli check <files|dirs…> [--json out.json]    # does each PDF open and render
pdfcraft-cli run <tool> [key=value …] [--root DIR] [--out image.png]   # one tool
pdfcraft-cli run --script steps.json [--root DIR]     # several tools in one process
```

- `edit` options **run in order** and later page numbers refer to the document *after* the earlier options
  (`--delete 2 --move 3:1` moves the page that is third after the deletion). Rotation is `PAGES:DEGREES`.
- `run <tool> key=value`: values are JSON-ish (`doc=1 page=1`); strings with spaces need shell quotes.
- `--script steps.json` is a JSON array: `[{"tool":"doc_open","args":{"path":"a.pdf"}}, …]`; each step prints its result.
- `--root DIR` (on `run`, `batch`, `mcp`; **not** on `info`/`edit`/…) confines file access to DIR and relative paths then resolve
  *against DIR*.

## State between invocations

Direct subcommands (`edit`, `combine`, …) read a file and write a **new** file (`--out`); the input is never modified.
The automation tools (`run`) are different: they work on *open documents* (`doc_open` → `doc` id, usually `1`), and
a **single `run` process exits and forgets its documents** (`run page_add_text doc=1 …` alone fails with "no open
document with id 1"). Put `doc_open`, the edits and `doc_save` in one `--script` (or one MCP session). Edits are
in memory until `doc_save` (`path` = save as; omit = in place).

## Discovery first

There is no `commands`: discovery is `pdfcraft-cli tools`.

```bash
pi-craft pdfcraft exec tools | jq -r '.[] | "\(.name)\t\(.read_only)\t\(.description[0:80])"'   # all names
pi-craft pdfcraft exec tools | jq '.[] | select(.name=="page_add_text") | .input_schema'       # parameters
pi-craft pdfcraft exec info doc.pdf                    # page count before choosing page numbers
```

Each entry has `name`, `description`, `input_schema` (JSON Schema, `required` list), `read_only`, and `command`
(the GUI command id, often `null`). Use `name`. Typical families: `doc_*` (open/save/combine/split/info/set_info),
`page_*` (rotate/delete/move/extract/render/add_text/add_image), `text_*` (extract/find), `form_*`, `bookmark_*`,
`redact_*`, `stamp_*`, `link_*`. Prefer a direct subcommand when one exists; use tools for everything else.

## Traps

- **`run` is stateless across processes** (above): `doc=1` only exists inside the same `--script`/MCP session.
- **`combine` adds one bookmark per input file** (`info` shows `bookmarks: 2` for two inputs); `pdf_version` becomes 1.7.
- **`--root` rewrites relative paths**: with `--root sub`, `path=a.pdf` means `sub/a.pdf` and `path=sub/a.pdf` fails with
  "No such file"; an absolute path outside the root fails with "is outside the allowed directory".
- `info`/`text`/`edit` reject `--root` ("unknown option"); confine through `run --root` or `mcp --root` only.
- `text` separates pages by a form feed and keeps the text layer only: a scanned PDF returns nothing (OCR is a `batch --steps ocr` step).
- Page numbers are 1-based; a page that does not exist is an error (`render --page 9` → "page 9 does not exist", exit 1).
- `render` at `--dpi 72` gives one pixel per point (a 200×200 pt page → 200×200 px); the default is 96 dpi.
- `edit --rotate` does not show in `info`; check it by rendering a non-square page (width and height swap).
- `split --every 2 --out-dir D` names parts `<name>-p1-2.pdf`, `<name>-p3-4.pdf`, `<name>-p5.pdf` and also lists them on stdout.

## MCP route (opt-in)

`pi-craft pdfcraft mcp --register` writes a `craft-pdfcraft` entry into `.pi/mcp.json`; it is confined to the project
directory (`--root`). 163 tools would flood the model context — register with `--compact` (a core set plus `tool_search`
and `tool_call`) or stay on the bash route. GUI bridging (`ui --control`) is out of scope.

## Recipes

The recipes generate their own PDFs with a tiny python3 writer (no network).

```bash recipe: combine-extract
# Two PDFs (2 + 3 pages) -> one 5-page PDF -> pages 1,3,5 only.
cat > mk.py <<'PY'
import sys
w, h, out, *texts = sys.argv[1:]
n = len(texts)
objs = ["<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % (3 + 2 * i) for i in range(n)), n)]
for i, t in enumerate(texts):
    objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (w, h, 4 + 2 * i, 3 + 2 * n))
    s = "BT /F1 24 Tf 20 100 Td (%s) Tj ET" % t
    objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(s), s))
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
b, offs = "%PDF-1.4\n", []
for i, o in enumerate(objs):
    offs.append(len(b)); b += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
x = len(b)
b += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
b += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(out, "w").write(b)
PY
python3 mk.py 200 200 a.pdf "Alpha one" "Alpha two"
python3 mk.py 200 200 b.pdf "Beta one" "Beta two" "Beta three"
pi-craft pdfcraft exec combine a.pdf b.pdf --out c.pdf
pi-craft pdfcraft exec extract c.pdf --pages 1,3,5 --out odd.pdf
pi-craft verify odd.pdf --pages 3 --text-contains "Beta one"
```

```bash recipe: rotate-delete
# Rotate page 1 by 90 degrees and drop page 2; rotation is proved by the rendered size (300x200 -> 200x300).
cat > mk.py <<'PY'
import sys
w, h, out, *texts = sys.argv[1:]
n = len(texts)
objs = ["<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % (3 + 2 * i) for i in range(n)), n)]
for i, t in enumerate(texts):
    objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (w, h, 4 + 2 * i, 3 + 2 * n))
    s = "BT /F1 24 Tf 20 100 Td (%s) Tj ET" % t
    objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(s), s))
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
b, offs = "%PDF-1.4\n", []
for i, o in enumerate(objs):
    offs.append(len(b)); b += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
x = len(b)
b += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
b += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(out, "w").write(b)
PY
python3 mk.py 300 200 in.pdf "Keep me" "Drop me" "Also keep"
pi-craft pdfcraft exec edit in.pdf --out out.pdf --rotate 1:90 --delete 2
pi-craft verify out.pdf --pages 2 --text-contains "Also keep"
pi-craft pdfcraft exec render out.pdf --page 1 --dpi 72 --out p1.png
pi-craft verify p1.png --size 200x300
```

```bash recipe: render-page
# Render page 2 of a PDF at 144 dpi: a 200x200 pt page becomes 400x400 px.
cat > mk.py <<'PY'
import sys
w, h, out, *texts = sys.argv[1:]
n = len(texts)
objs = ["<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % (3 + 2 * i) for i in range(n)), n)]
for i, t in enumerate(texts):
    objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (w, h, 4 + 2 * i, 3 + 2 * n))
    s = "BT /F1 24 Tf 20 100 Td (%s) Tj ET" % t
    objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(s), s))
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
b, offs = "%PDF-1.4\n", []
for i, o in enumerate(objs):
    offs.append(len(b)); b += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
x = len(b)
b += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
b += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(out, "w").write(b)
PY
python3 mk.py 200 200 two.pdf "First page" "Second page"
pi-craft pdfcraft exec text two.pdf --page 2
pi-craft pdfcraft exec render two.pdf --page 2 --dpi 144 --out page2.png
pi-craft verify page2.png --size 400x400
```

```bash recipe: script-stamp
# Tools need an open document: open, edit and save inside ONE --script (a lone `run` forgets doc 1).
cat > mk.py <<'PY'
import sys
w, h, out, *texts = sys.argv[1:]
n = len(texts)
objs = ["<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % (3 + 2 * i) for i in range(n)), n)]
for i, t in enumerate(texts):
    objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (w, h, 4 + 2 * i, 3 + 2 * n))
    s = "BT /F1 24 Tf 20 100 Td (%s) Tj ET" % t
    objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(s), s))
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
b, offs = "%PDF-1.4\n", []
for i, o in enumerate(objs):
    offs.append(len(b)); b += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
x = len(b)
b += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
b += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(out, "w").write(b)
PY
python3 mk.py 200 200 a.pdf "Alpha one" "Alpha two"
cat > steps.json <<'JSON'
[{"tool":"doc_open","args":{"path":"a.pdf"}},
 {"tool":"page_add_text","args":{"doc":1,"page":1,"text":"STAMPED","at":[20,20],"size":20}},
 {"tool":"doc_set_info","args":{"doc":1,"key":"Title","value":"Stamped"}},
 {"tool":"doc_save","args":{"doc":1,"path":"s.pdf"}}]
JSON
pi-craft pdfcraft exec run --script steps.json
pi-craft verify s.pdf --pages 2 --text-contains STAMPED
```
