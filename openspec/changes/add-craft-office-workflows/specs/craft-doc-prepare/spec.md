## Purpose
Prepare Markdown and a DOCX template so that WordCraft can produce a templated document headless: resolve the template and variables, fill every placeholder the WordCraft CLI cannot reach, and inline images and diagrams.

## ADDED Requirements

### Requirement: doc prepare invocation and report
`pi-craft doc prepare <in.md> --out <dir>` SHALL accept these options: `--template <name>`, `--templates-dir <dir>`, repeatable `--var k=v`, repeatable `--allow-path <dir>`, `--allow-missing` and `--json`. It SHALL write `<dir>/template.filled.docx`, `<dir>/body.md` and `<dir>/prepare.json`, overwriting only those three files when they already exist and leaving other files in `<dir>` untouched. With `--json`, it SHALL also print the report to stdout as one JSON object. The report SHALL list: the template path; each variable with its source (`default`, `frontmatter`, `cli`, `system`); unresolved placeholders; warnings; TOC options; and Mermaid and image counts. Exit codes SHALL be `0` success (including `--help`), `1` failed operation or unresolved placeholders without `--allow-missing`, and `2` usage error.

#### Scenario: Unresolved placeholder fails
- **WHEN** the template contains `{{ document_id }}` and neither frontmatter, `--var` nor `variables.xml` defines it
- **THEN** `prepare.json` lists `document_id` under `unresolved` and the exit code is `1`

#### Scenario: Allow missing
- **WHEN** the same run passes `--allow-missing`
- **THEN** the exit code is `0` and the report still lists `document_id` as unresolved

### Requirement: Template and variable resolution
The template SHALL resolve to `<templates-dir>/<name>/template.docx`. The name SHALL come from `--template`, else frontmatter `template`, else `default`, and SHALL match `^[A-Za-z0-9_-]+$`. The templates dir SHALL come from `--templates-dir`, else frontmatter `templates_dir`, else `$PI_DOC_TEMPLATES_DIR`, else the first existing of `./templates` and `~/Documents/templates`. Frontmatter `templates_dir` SHALL resolve relative to the input file and, after symlink resolution, SHALL lie within the input's directory or an `--allow-path` directory. The resolved absolute path SHALL be reported.

Frontmatter keys SHALL use the doc-engine names `template`, `templates_dir`, `language`, `document_title`, `document_name`, `enable_toc`, `toc_heading` and `nano_banana`. Other scalar keys SHALL be variables. Other structured keys SHALL be reported as ignored.

Variable precedence, lowest first, SHALL be: template `variables.xml` defaults, system variables, frontmatter, `--var`. The system variables SHALL be `$date` (localized by `language`, using doc-engine's month tables), `$fileName`, `$year`, `$month` and `$day`. The report SHALL record each variable's source and SHALL list template-default-sourced variables under `defaulted`.

#### Scenario: Template name traversal refused
- **WHEN** frontmatter sets `template: ../../evil`
- **THEN** the command exits `2` naming the invalid template name

#### Scenario: Frontmatter templates_dir outside the tree refused
- **WHEN** frontmatter sets `templates_dir: /tmp/other` and no `--allow-path` covers it
- **THEN** the command exits `1` naming the refused directory

#### Scenario: Template default reported
- **WHEN** `client_name` is supplied only by the template's `variables.xml` default
- **THEN** the report lists `client_name` under `defaulted` with source `default`

#### Scenario: CLI overrides frontmatter
- **WHEN** frontmatter sets `version: "1.0"` and `--var version=1.1` is passed
- **THEN** the filled template shows `1.1` and the report records the source `cli`

### Requirement: Placeholder fill across all document parts
The command SHALL replace placeholders in `word/document.xml`, including text inside VML and `wps` textboxes, and in every `word/header*.xml` and `word/footer*.xml`. Two forms SHALL be replaced:
- `{{ name }}`, with optional inner whitespace, for any name matching `[A-Za-z_$][A-Za-z0-9_.:-]*`;
- `<name>`, only for names the template manifest marks `syntax="both"`, or names declared in `variables.xml` without a manifest syntax entry.

Matching SHALL operate on the decoded text of `w:t` nodes only, never on element tags or attributes. Names starting with `logo:` SHALL be left untouched and reported as ignored.

Placeholders split across runs within one paragraph SHALL be replaced. Placeholders spanning paragraphs SHALL be reported as unresolved. Values SHALL be XML-escaped. Unchanged parts, `[Content_Types].xml` and relationship parts SHALL be copied byte-for-byte. The docx SHALL be processed in memory, with no archive entry name used as a filesystem path.

#### Scenario: Textbox and first-page header filled
- **WHEN** the template has `{{ client_name }}` in a cover textbox and `{{ document_id }}` in the first-page header
- **THEN** both are replaced in `template.filled.docx`

#### Scenario: Split-run placeholder
- **WHEN** `{{ version }}` is stored as three runs `{{ `, `version`, ` }}`
- **THEN** it is replaced with the version value

#### Scenario: Escaped angle-bracket placeholder in a textbox
- **WHEN** a cover textbox stores `&lt;client_name&gt;` and `client_name` is declared `syntax="both"`
- **THEN** it is replaced with the escaped value

#### Scenario: Undeclared angle-bracket text untouched
- **WHEN** a header contains `<draft>` and no variable `draft` is declared
- **THEN** the text is left unchanged and not reported as unresolved

#### Scenario: Markup in a value is escaped
- **WHEN** a variable value is `A & B <C>`
- **THEN** the docx XML contains `A &amp; B &lt;C&gt;` and the document opens in WordCraft

### Requirement: Body preparation
`body.md` SHALL be the input with frontmatter removed and `{{ name }}` variables substituted; `<name>` SHALL NOT be substituted in the body. Image and diagram handling SHALL operate on the text before substitution, so image or diagram syntax that arrives through a variable value is never inlined or rendered.

Each local image SHALL be inlined as a `data:` URI. Image paths SHALL resolve relative to the input file, after symlink resolution, and SHALL lie within the input's directory or an `--allow-path` directory. Absolute and `file://` paths outside those directories SHALL be refused. Remote image URLs SHALL be left unchanged and listed under `images.remote`.

Each Mermaid block SHALL be rendered to PNG and inlined:
- with nano-banana when frontmatter `nano_banana.enabled` is true, using the style from the template's `nano-banana-styles.yaml` and the cache `.mermaid-cache/<md5 of style and source>.png`, falling back to `mmdc` on failure;
- otherwise with host `mmdc`, spawned without a shell.

When `mmdc` is unavailable, the block SHALL be left as code and counted as unrendered. PlantUML blocks SHALL be left as code and reported as warnings.

#### Scenario: Variable cannot smuggle an image path
- **WHEN** `--var note='![x](/etc/passwd)'` is substituted into the body
- **THEN** the text stays literal in `body.md`, no image is inlined, and the report carries a warning

#### Scenario: Image outside the tree refused
- **WHEN** the Markdown references `../../secret.png` and no `--allow-path` covers it
- **THEN** the image is not inlined and the report lists it under skipped with the reason

#### Scenario: Mermaid cache hit
- **WHEN** a nano-banana-styled diagram with an unchanged source is prepared a second time
- **THEN** the cached PNG is reused and the nano-banana CLI is not called

#### Scenario: mmdc missing
- **WHEN** the input has a Mermaid block, nano-banana is not enabled, and `mmdc` is not on PATH
- **THEN** the block stays a code block, the report shows `mermaid.unrendered: 1`, and the exit code is `0`
