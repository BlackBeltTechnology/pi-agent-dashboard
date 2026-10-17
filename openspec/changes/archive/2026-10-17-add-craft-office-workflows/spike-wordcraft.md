# Spike — WordCraft vs doc-engine templating (2026-10-15)

Binary: `wordcraft-cli` 0.7.0, provisioned with `pi-craft wordcraft ensure`.
Template: `~/Documents/templates/default/template.docx` (doc-engine `default`). It has:
- 4 `w:txbxContent` cover textboxes;
- `header1-3.xml` and `footer1-3.xml`;
- logo media.

`W` = the wordcraft-cli path. Work dir: `/tmp/wcspike`.

| # | Command | Observation |
|---|---|---|
| 1 | `W convert doc.md plain.docx` (md with YAML frontmatter) | Frontmatter rendered as body text (`title: … client: …`), not parsed. Relative `![](logo.png)` not embedded. |
| 2 | `W run --template tpl.docx --cmd 'insert.textFromFile={…}' … --save out.docx` | The result has **no header/footer parts**: `--template` drops them. |
| 3 | `W run --file tpl.docx …` | Header/footer kept. `insert.picture {"path":abs}` embeds `word/media/image1.png`. |
| 4 | `edit.replaceAll {"text":"{{title}}",…}` | Replaces body text only. The header stays `HDR {{title}}` until it is wrapped in `insert.editHeader` … `insert.closeHeader`. |
| 5 | Real template: `run --file bb.docx --cmd caret.docEnd --cmd text.pageBreak --cmd 'insert.textFromFile' …` + replaceAll inside header/footer editing | Styles/fonts kept (orange H1, Source Sans body, footer logo; rendered pages inspected). **Not reached:** the 4 textbox placeholders in `document.xml`, `header2.xml` first-page placeholders (`$date`, `company_info`, `contact_info`, `document_id`), and `footer2.xml` `author`. Header/footer editing with `caret.docStart` first did not reach them either. |
| 6 | `insert.textFromFile` long.md + `references.toc {"levels":2}` + `references.updateToc` | 13 pages. TOC entries carry correct page numbers (2, 4, 6, 9, 11). |
| 7 | md with `data:image/png;base64,…` image vs `file://` image | data URI embedded; `file://` and relative paths dropped. |
| 8 | `W convert out.docx out.pdf` | PDF written. `W info out.pdf` → `unsupported format .pdf`; use `pi-craft verify` (PdfCraft) for PDFs. |
| 9 | `insert.coverPage {title,subtitle,author}` | Generic cover. It repeats the default header and spills the author line onto page 2. Not used; the template's own cover is used instead. |

Command-name traps: `select.all`, not `edit.selectAll`; `text.insert`, not `text.type`.

Conclusion: `pi-craft doc prepare` fills the template and the body before WordCraft runs (design D3). WordCraft then only appends the body, builds the TOC and exports.

## Implementation re-run (task 0.2, 2026-10-17)

Same binary (`wordcraft-cli` 0.7.0), real `~/Documents/templates/default`, filled by `pi-craft doc prepare`. Work dir `/tmp/w6`.

| # | Command | Observation |
|---|---|---|
| 10 | `doc prepare` on the real template (frontmatter: client, document id, TOC on, `language: hu`) | Cover textbox, first-page header (`document_id`, `$date` as `2026. oktober 17.`) and footer filled; pdf text shows them. `logo:company` is an image slot, left in place. |
| 11 | `run --file … caret.docEnd, text.pageBreak, references.toc, text.pageBreak, insert.textFromFile` (the design D3 order) | **Drift.** `references.toc` leaves the caret *above* the TOC, so the body lands before it: page 2 blank, body page 3, TOC after the body. |
| 12 | Same with `caret.docEnd` after `references.toc` (before the second page break) | Cover, TOC (correct page numbers), body. Used by `craft-doc-publish`. |
| 13 | A Markdown body with a `data:` image (Mermaid PNG) through `insert.textFromFile` into the real template | **Drift.** The image is written as `rId1`, which the template already uses (cover image): the body image is lost and the cover's first image shows instead. Same through a converted `body.docx`. |
| 14 | `insert.picture {"path": …}` after `insert.textFromFile` | Correct (`rId2`, `image4.png`). |
| 15 | Body with a marker paragraph `IMGMARK1`: `edit.find {"text":"IMGMARK1"}`, `insert.picture`, `edit.replaceAll {"text":"IMGMARK1","with":""}` | The picture sits where the marker was; the marker text is gone. Used by `doc prepare` when the template owns images (`prepare.json.pictures`, `CRAFTIMG<n>`). |
| 16 | Host `mmdc` 11.12 | Needs a Chromium: without one it fails ("Could not find Chrome") → block stays code, `mermaid.unrendered`. `PUPPETEER_EXECUTABLE_PATH` (inherited by `doc prepare`) fixes it. |

Other probes of this change (2026-10-17):

- **0.1 VectorCraft 0.12.0**: `imageTrace.makeAndExpand` with `--params '{"preset":"Flat Logo","params":{"ignoreWhite":true}}'` round-trips png → svg; `vectorcraft-cli convert x.svg x.png --scale N` previews; the preview has an alpha channel.
- **0.3 LightCraft 0.8.0**: no real camera RAW available; synthetic DNG from `synth-merge` develops. AI denoise (`denoise.models.install` / `.download`) needs a user-supplied model and `acknowledged: true` after the user accepted the licence — no model is bundled (`denoise.models.list` → `models: []`). The skill uses the classic sliders (`detail.nrLuminance`, `detail.nrColor`) and offers AI denoise only on request.
- **0.4 GridCraft 0.7.0 / DeckCraft 0.7.0**: `insert.chart` works; there is **no chart image export command**. The chart comes from the sheet's pdf export (`run --in x.xlsx --out x.pdf`), `pdfcraft render`, and PhotoCraft `image.trim` (`basedOn: topLeft`) with the chart anchored at `A1`. DeckCraft `insert.picture` (png) + `convert … pdf` works; `transition.set` + `render-transition` previews work.
- **0.5 tiff alpha**: ffprobe reports `rgba` for an alpha tiff and `pi-craft verify --alpha` passes. The spec still asserts `--alpha` on png only; no skill asserts it on tiff.
- **0.6 `pi-nano-banana` for diagrams**: `pi-nano-banana "<prompt>" --output <png>` (prompt = `Diagram:` + source + the template style block + `AVOID:` negative); credentials by the CLI's own resolution. Any failure (no credentials, non-zero exit, no file) falls back to `mmdc`.
- **PdfCraft 0.8.0 protect**: `doc_protect` takes `open_password` / `permissions_password` (not `owner_password`); `pdfcraft-cli run --script` cannot read `/dev/fd/N`, so the script goes through a `0600` temp file. A protected pdf cannot be probed by `pi-craft verify` (exit `0`/probe failed message): verify before protecting.
