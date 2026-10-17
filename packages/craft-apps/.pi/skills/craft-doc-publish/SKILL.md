---
name: craft-doc-publish
description: Publish Markdown with frontmatter as a templated DOCX and PDF with ArtCraft apps - fill the company template (variables, cover textboxes, first-page header), inline images and Mermaid diagrams, WordCraft body and table of contents, PDF export, optional PdfCraft combine/audit/protect; verified and resumable. Use for "make a DOCX from this markdown with our template", "publish this report as a PDF with the company template", "render the offer with a table of contents", "markdown to Word with the default template".
---

# craft-doc-publish — Markdown + template → DOCX + PDF (→ packaged PDF)

The **default** Markdown → templated DOCX/PDF path. `pi-craft doc prepare` fills the template's placeholders (frontmatter,
`--var`, template defaults, system variables) and prepares the body; WordCraft then only appends the body, builds the TOC and
exports; PdfCraft packages the result. No Docker, no pandoc. Read `wordcraft` (and `pdfcraft` for step 3) first. Resumable-job
rules are in the `craft-studio` router, section **Craft jobs**. Ingest/OCR of existing documents, round-trip editing
(extract → edit → merge back), PlantUML and table-width profiles stay with `document-converter`.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Prepare | `pi-craft doc prepare` | `report.md` + template → `01-prepare/` (`template.filled.docx`, `body.md`, `prepare.json`) | `check: prepare` (+ user confirms defaults) |
| 2 | Render | WordCraft | filled template + body → `02-render/out.docx`, `out.pdf` | `pi-craft verify --pages --text-contains` |
| 3 | Package (optional) | PdfCraft | pdf (+ extra pdfs) → `03-package/final.pdf` | `pi-craft verify` (before protecting) |

Hand-off formats: filled `docx` + Markdown body between 1 and 2, `pdf` out (the docx is verified through its pdf). The
template is a doc-engine template directory `<templates-dir>/<name>/template.docx` (+ `variables.xml`, `manifest.xml`).
Passwords and API keys are never written to `job.json`, gate reports or step files.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `document-converter` | `@blackbelt-technology/pi-dashboard-document-converter` | skill in the loaded skill list | not needed here: only for ingest/OCR, round-trip editing and PlantUML — route those requests to it, continue otherwise |
| `mmdc` | `@mermaid-js/mermaid-cli` | `command -v mmdc` (it needs a Chromium; if it cannot find one set `PUPPETEER_EXECUTABLE_PATH`) | diagrams stay code blocks; step 1's gate asks you to install it or accept code-block diagrams |
| `pi-nano-banana` | already a dependency of craft-apps | usable credentials, only when the frontmatter sets `nano_banana.enabled: true` | no credentials: diagrams render with `mmdc` (the fallback runs anyway) |

"Loaded skill list" is the available-skills list in your own system prompt. `nano_banana.enabled` is a **paid** API call per
new diagram: state that to the user before step 1; results are cached in `.mermaid-cache/` next to the Markdown.
Resolve the template first and **echo its path to the user** (it is in `prepare.json` after step 1): `./templates` is searched
before `~/Documents/templates`, so a repo-local template can win without being asked for.

Set up the job (**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Prepare

**Output:** `01-prepare/template.filled.docx`, `01-prepare/body.md`, `01-prepare/prepare.json`.
**Gate:** `check: prepare` — the report has no unresolved placeholder, unrendered diagram, skipped or remote image, and
every template-defaulted variable was confirmed by the user.

```bash
pi-craft doc prepare report.md --out "$JOB/01-prepare" [--template default] [--templates-dir <dir>] [--var client_name="ACME Kft."]… [--allow-path <dir>]…
```

Frontmatter uses the doc-engine keys: `template`, `templates_dir`, `language`, `document_title`, `document_name`,
`enable_toc`, `toc_heading`, `nano_banana`; every other scalar key is a template variable (`--var` wins over frontmatter,
which wins over the template's own `variables.xml` default). Read `prepare.json`:

- `defaulted` — variables that still carry the **template's default** (a real template ships another customer's name, offer
  number…). **Show each default value and ask the user to confirm or supply a value** (`--var name=value`, rerun). Only then run the
  gate with `DEFAULTS_CONFIRMED=1`.
- `unresolved` — placeholders with no value (also a token split across paragraphs): supply the variable or, with the user's
  consent, `--allow-missing`.
- `mermaid.unrendered` — diagrams left as code (no `mmdc`, no browser, render error): **ask the user to install `mmdc` or accept
  code-block diagrams** before rendering.
- `images.skipped` / `images.remote` — images outside the Markdown's directory (pass `--allow-path`), missing, or remote
  (WordCraft does not fetch them): fix the path or accept the omission with the user.
- `warnings` — PlantUML blocks stay code (use `document-converter`); a variable value that contained image/diagram syntax stays literal.
- `pictures` — present when the template owns images (WordCraft 0.7.0 would paste every Markdown-imported image onto the
  template's first one): `body.md` then carries `CRAFTIMG0001`-style markers and step 2 puts the pictures in.

```bash check: prepare
# run inside the step directory: cd "$JOB/01-prepare" (DEFAULTS_CONFIRMED=1 once the user confirmed every defaulted variable)
jq -e --arg ok "${DEFAULTS_CONFIRMED:-0}" '
  (.unresolved | length == 0) and (.mermaid.unrendered == 0) and (.images.skipped | length == 0) and (.images.remote | length == 0)
  and ((.defaulted | length == 0) or $ok == "1")' prepare.json
```

### Step 2 — Render

**Output:** `02-render/out.docx` and `02-render/out.pdf` (the docx is verified through its pdf).
**Gate:** `pi-craft verify out.pdf --pages N --text-contains "<title>"` — `N` is WordCraft's own page count of the docx.

One WordCraft run opens the **filled** template with `run --file` (never `run --template`: it drops the template's header/footer
parts), appends the body after a page break, builds the TOC if enabled, puts in any pictures, sets the properties, then `convert`
exports the pdf. The TOC is inserted **before** the body: `references.toc` leaves the caret above the TOC, so move to the end
(`caret.docEnd`) again before the second page break and the body.

```bash
D="$PWD/$JOB/01-prepare"; TOC=$(jq -r .toc.enabled "$D/prepare.json")
ARGS=(--cmd 'caret.docEnd={}' --cmd 'text.pageBreak={}')
if [ "$TOC" = true ]; then
  ARGS+=(--cmd "references.toc=$(jq -c '{levels:.toc.levels,title:.toc.heading}' "$D/prepare.json")" --cmd 'caret.docEnd={}' --cmd 'text.pageBreak={}')
fi
ARGS+=(--cmd "insert.textFromFile=$(jq -nc --arg p "$D/body.md" '{path:$p}')")
# pictures (only when prepare.json has them): find the marker, insert the picture, delete the marker
while IFS= read -r pic; do
  m=$(jq -r .marker <<<"$pic"); f=$(jq -r .file <<<"$pic")
  ARGS+=(--cmd "edit.find=$(jq -nc --arg t "$m" '{text:$t}')" --cmd "insert.picture=$(jq -nc --arg p "$D/$f" '{path:$p}')" --cmd "edit.replaceAll=$(jq -nc --arg t "$m" '{text:$t,with:""}')")
done < <(jq -c '.pictures[]?' "$D/prepare.json")
ARGS+=(--cmd "file.properties=$(jq -c '{title:.title}' "$D/prepare.json")")
[ "$TOC" = true ] && ARGS+=(--cmd 'references.updateToc={}')
pi-craft wordcraft exec run --file "$D/template.filled.docx" "${ARGS[@]}" --save "$JOB/02-render/out.docx"
pi-craft wordcraft exec convert "$JOB/02-render/out.docx" "$JOB/02-render/out.pdf"
N=$(pi-craft wordcraft exec info "$JOB/02-render/out.docx" | jq -r .pages)
pi-craft verify "$JOB/02-render/out.pdf" --pages "$N" --text-contains "$(jq -r .title "$D/prepare.json")" --text-contains "$CLIENT"
```

A page-count mismatch or a missing title stops the workflow here: the package step does not start. Look at the rendered pages
(`pi-craft pdfcraft exec render out.pdf --page 1 --out <abs>.png`, then read the image) before step 3 — the gate cannot see a
wrong picture or a broken cover.

### Step 3 — Package (optional)

**Output:** `03-package/final.pdf` (combined, audited, optionally password-protected).
**Gate:** `pi-craft verify` on the **unprotected** pdf (`--pages` = sum of the parts); a protected pdf cannot be probed, so the protect
step is checked by `check: protected` (opening without the password must fail).

```bash
pi-craft pdfcraft exec combine "$JOB/02-render/out.pdf" appendix.pdf --out "$JOB/03-package/final.pdf"     # skip when there is nothing to add
pi-craft pdfcraft exec audit "$JOB/03-package/final.pdf"                                                   # faux-redaction finder, fails when found
pi-craft verify "$JOB/03-package/final.pdf" --pages 5 --text-contains "$TITLE"
```

Protect only when asked. The password comes from the user at run time; it goes to a `0600` temp file outside the job directory
(argv would show it in the process list for the call; the temp file is deleted at once) and **never** into `job.json`, reports or
the job directory:

```bash
S=$(mktemp); chmod 600 "$S"
jq -nc --arg pw "$PASSWORD" --arg in "$JOB/03-package/final.pdf" --arg out "$JOB/03-package/final-protected.pdf" \
  '[{tool:"doc_open",args:{path:$in}},{tool:"doc_protect",args:{doc:1,open_password:$pw}},{tool:"doc_save",args:{doc:1,path:$out}}]' > "$S"
pi-craft pdfcraft exec run --script "$S"; rm -f "$S"
```

```bash check: protected
# run from the directory that contains craft-jobs/: opening without the password must fail
! pi-craft pdfcraft exec info "craft-jobs/$SLUG/03-package/final-protected.pdf" >/dev/null 2>&1
```

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job name, and start
at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed — an edited `report.md`, a new
template, an image. Re-run every step downstream of it (a changed `report.md` re-prepares, re-renders and re-packages) and reuse the
verified outputs before it. Record each step with the `job-helper` snippet after its gate passed; the prepare step's report is
the `prepare.json` summary (`defaulted`, `unresolved`, counts). A job stopped after step 2 verified resumes at step 3 with the
verified pdf. Never record a protect password.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft wordcraft exec commands --json | jq
…` — WordCraft has no `describe`; `pi-craft pdfcraft exec tools` for PdfCraft), repeat the step and re-run the gate. At most 2
retries per step; after the second failure stop and report the verify output and what was tried. `pi-craft verify` exit `3` means
a probe tool is missing (PdfCraft cannot be provisioned): stop and report the missing tool — never treat it as a pass. If
WordCraft itself cannot be provisioned, offer `document-converter` as the fallback renderer.

## Recipes

```bash recipe: doc-publish-core
# A WordCraft-made template -> doc prepare -> WordCraft render with TOC -> pdf gate. (The real company template is
# ~/Documents/templates/default; this one is built on the spot so the recipe needs nothing installed.)
mkdir -p templates/default 01-prepare 02-render
pi-craft wordcraft exec run --cmd para.heading1 --cmd 'text.insert={"text":"{{ client_name }}"}' \
  --cmd text.newParagraph --cmd para.normal --cmd 'text.insert={"text":"Version {{ version }}"}' \
  --save templates/default/template.docx
printf -- '---\ndocument_title: Quarterly Report\nclient_name: ACME Kft.\nversion: "2.0"\nenable_toc: true\ntoc_heading: Contents\n---\n# Quarterly Report\n\nHello {{ client_name }}.\n\n## Results\n\nRevenue grew by twelve percent.\n' > report.md
pi-craft doc prepare report.md --out 01-prepare --templates-dir templates
jq -e '(.unresolved|length==0) and (.mermaid.unrendered==0) and (.images.skipped|length==0) and (.images.remote|length==0) and (.defaulted|length==0)' 01-prepare/prepare.json

D="$PWD/01-prepare"; TOC=$(jq -r .toc.enabled "$D/prepare.json")
ARGS=(--cmd 'caret.docEnd={}' --cmd 'text.pageBreak={}')
if [ "$TOC" = true ]; then
  ARGS+=(--cmd "references.toc=$(jq -c '{levels:.toc.levels,title:.toc.heading}' "$D/prepare.json")" --cmd 'caret.docEnd={}' --cmd 'text.pageBreak={}')
fi
ARGS+=(--cmd "insert.textFromFile=$(jq -nc --arg p "$D/body.md" '{path:$p}')")
ARGS+=(--cmd "file.properties=$(jq -c '{title:.title}' "$D/prepare.json")")
[ "$TOC" = true ] && ARGS+=(--cmd 'references.updateToc={}')
pi-craft wordcraft exec run --file "$D/template.filled.docx" "${ARGS[@]}" --save 02-render/out.docx
pi-craft wordcraft exec convert 02-render/out.docx 02-render/out.pdf
N=$(pi-craft wordcraft exec info 02-render/out.docx | jq -r .pages)
pi-craft verify 02-render/out.pdf --pages "$N" --text-contains "Quarterly Report" --text-contains "ACME Kft." --text-contains "Version 2.0"
```

```bash recipe: doc-publish-protect
# Package step: protect with a password from a 0600 temp file (never in the job directory), then prove the protection.
pi-craft wordcraft exec run --cmd 'text.insert={"text":"Confidential offer"}' --save src.docx
pi-craft wordcraft exec convert src.docx final.pdf
pi-craft verify final.pdf --pages 1 --text-contains "Confidential offer"
PASSWORD=${PASSWORD:-recipe-only-secret}
S=$(mktemp); chmod 600 "$S"
jq -nc --arg pw "$PASSWORD" --arg in "$PWD/final.pdf" --arg out "$PWD/final-protected.pdf" \
  '[{tool:"doc_open",args:{path:$in}},{tool:"doc_protect",args:{doc:1,open_password:$pw}},{tool:"doc_save",args:{doc:1,path:$out}}]' > "$S"
pi-craft pdfcraft exec run --script "$S"; rm -f "$S"
! pi-craft pdfcraft exec info final-protected.pdf >/dev/null 2>&1
test -f final-protected.pdf
pi-craft verify final.pdf --pages 1
```
