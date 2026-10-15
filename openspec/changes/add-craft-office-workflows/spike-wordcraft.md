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
