# Test Plan — add-craft-office-workflows

Stage: design   Generated: 2026-10-15

Levels used:
- L1 = vitest in `packages/craft-apps/src/__tests__/`.
  - Offline by default. Fixture docx files are built in-test with `fflate`. `mmdc` and `pi-nano-banana` are stub scripts on `PATH`.
  - Real-binary rows run under the existing `CRAFT_E2E` opt-in plus the workflow-recipe opt-in introduced by `add-craft-media-workflows`.
- No L2/L3: there is no new install surface (the `pi-craft` bin is already covered by `packaging.test.ts`) and no rendered UI.
- Agent-judgement behaviour (an LLM following a skill) has no deterministic harness, so it is `manual-only`.

Gate answers (2026-10-15):
- Retry cap: 2 retries, then stop.
- `--json`: the report goes to stdout.
- An existing `--out`: only the 3 output files are overwritten.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | craft-doc-prepare: Template and variable resolution (precedence) | decision-table (default × frontmatter × --var) | L1 | automated | fixture template whose `variables.xml` sets `version` default `0.1`; md frontmatter `version: "1.0"` | `doc prepare` run 3×: no override / frontmatter only / frontmatter + `--var version=1.1` | filled `document.xml` text = `0.1` / `1.0` / `1.1`; `prepare.json.vars.version` = `default` / `frontmatter` / `cli` |
| E2 | craft-doc-prepare: Template name traversal refused | EP (invalid name) | L1 | automated | frontmatter `template: ../../evil` | `doc prepare` | exit `2`; stderr names `../../evil`; no output files written |
| E3 | craft-doc-prepare: Frontmatter templates_dir confinement | decision-table (inside / outside / outside + `--allow-path`) | L1 | automated | `templates_dir: ./tpl` (inside), `/tmp/<rand>/tpl` (outside), same + `--allow-path /tmp/<rand>` | `doc prepare` | inside → exit 0; outside → exit 1, stderr names the dir; outside + allow-path → exit 0 |
| E4 | craft-doc-prepare: templates-dir chain | decision-table (flag / frontmatter / env / `./templates` / home) | L1 | automated | 5 temp layouts, each removing the higher-priority source (HOME sandboxed by `setup-home`) | `doc prepare` | `prepare.json.templatePath` = the highest-priority existing source in each layout |
| E5 | craft-doc-prepare: textbox + first-page header filled | EP | L1 | automated | fixture docx: `{{ client_name }}` inside `w:txbxContent` (wps) and `{{ document_id }}` in the first-page `header2.xml`; frontmatter supplies both | `doc prepare` | neither `{{` token remains in `document.xml`/`header2.xml`; both values present |
| E6 | craft-doc-prepare: split-run placeholder | EP | L1 | automated | `{{ version }}` stored as three `w:r` runs `{{ ` / `version` / ` }}` in one paragraph | `doc prepare --var version=2.0` | paragraph text = `2.0`; `unresolved: []` |
| E7 | craft-doc-prepare: value XML-escaped | EP (markup chars) | L1 | automated | `--var client_name='A & B <C>'` | `doc prepare` | raw XML contains `A &amp; B &lt;C&gt;`; every changed part parses as well-formed XML |
| E8 | craft-doc-prepare: `<name>` syntax rules | decision-table (declared both / mustache / undeclared × raw / escaped) | L1 | automated | manifest: `client_name` `syntax="both"`, `$date` `syntax="mustache"`; parts contain `&lt;client_name&gt;`, `&lt;$date&gt;`, `&lt;draft&gt;` | `doc prepare` | `client_name` replaced; `<$date>` and `<draft>` unchanged; neither listed in `unresolved`; no element tag or attribute modified |
| E9 | craft-doc-prepare: unresolved placeholder + `--allow-missing` | decision-table | L1 | automated | template has `{{ document_id }}`; no source defines it | `doc prepare` with and without `--allow-missing` | without: exit `1`, `unresolved: ["document_id"]`; with: exit `0`, same list |
| E10 | craft-doc-prepare: placeholder spanning paragraphs | BVA (paragraph boundary) | L1 | automated | `{{ ver` at the end of paragraph 1, `sion }}` at the start of paragraph 2 | `doc prepare --var version=1` | text unchanged; report lists the token under `unresolved` |
| E11 | craft-doc-prepare: `logo:` slots ignored | EP | L1 | automated | header contains `{{logo:company}}` | `doc prepare` | token unchanged; `prepare.json.ignored` contains `logo:company`; exit 0 |
| E12 | craft-doc-prepare: untouched parts byte-identical | invariant | L1 | automated | fixture docx with `footer1.xml` (no placeholder), `[Content_Types].xml`, `word/_rels/document.xml.rels` | `doc prepare` | those entries' bytes equal the input's (sha256) |
| E13 | craft-doc-prepare: defaulted variables reported | EP | L1 | automated | `client_name` only in `variables.xml` defaults | `doc prepare` | `prepare.json.defaulted` contains `client_name`; `vars.client_name` = `default` |
| E14 | craft-doc-prepare: `$date` parity with doc-engine | EP (per language) | L1 | automated | fixed clock `2026-03-05`; `language` ∈ {en, hu, de, fr} | `doc prepare` on `{{ $date }}` | filled text equals the string `system_variables.py` produces for that language and date (expected values pinned in the test) |
| E15 | craft-doc-prepare: body preparation | EP | L1 | automated | md with frontmatter, body `Hi {{ client_name }} <client_name>` | `doc prepare` | `body.md` has no `---` frontmatter block; contains `Hi ACME` and the literal `<client_name>` |
| E16 | craft-doc-prepare: image path confinement | decision-table (relative-inside / `../` outside / absolute outside / symlink-in→out / `--allow-path` / `http(s)`) | L1 | automated | 6 image refs, one per class | `doc prepare` | inside and allow-path → `data:image/png;base64,` in `body.md`; outside, absolute and symlink → `images.skipped` with a reason and the original ref left; http → `images.remote` |
| E17 | craft-doc-prepare: variable cannot smuggle image/diagram syntax | fault-injection (malicious value) | L1 | automated | `--var note='![x](/etc/passwd)'` and a value containing a ```` ```mermaid ```` fence; `{{ note }}` in the body | `doc prepare` | value literal in `body.md`; no data URI added; stub `mmdc` not invoked; `warnings` non-empty |
| E18 | craft-doc-prepare: Mermaid via host mmdc, no shell | EP + injection | L1 | automated | stub `mmdc` on PATH writing a 1×1 png; Mermaid source contains `$(touch PWNED)` | `doc prepare` | block replaced by a data-URI image; `mermaid.rendered: 1`; no `PWNED` file created; stub received argv (no shell) |
| E19 | craft-doc-prepare: mmdc missing | fault-injection (absent tool) | L1 | automated | PATH without `mmdc`; md with 1 Mermaid block | `doc prepare` | exit `0`; block still fenced in `body.md`; `mermaid.unrendered: 1` |
| E20 | craft-doc-prepare: nano-banana cache keyed by style + source | state-transition (miss → hit → style change) | L1 | automated | `nano_banana: {enabled: true, style: ros-3d}`; stub `pi-nano-banana` counting calls | run prepare 3×: first run, second run, then style `flat` | stub calls = 1, 1, 2; `.mermaid-cache/<md5(style+source)>.png` exists for both styles; `mermaid.cached: 1` on run 2 |
| E21 | craft-doc-prepare: nano-banana failure falls back to mmdc | fault-injection (abort) | L1 | automated | stub `pi-nano-banana` exits 1; stub `mmdc` ok | `doc prepare` | exit 0; `mermaid.fallback: 1`, `rendered: 1` |
| E22 | craft-doc-prepare: PlantUML left as code | EP | L1 | automated | md with one ```` ```plantuml ```` block | `doc prepare` | block unchanged; one `warnings` entry naming plantuml |
| E23 | craft-doc-prepare: `--json` + rerun into existing out dir | state-transition (fresh → rerun) | L1 | automated | `--out` dir pre-seeded with `keep.txt` and `.mermaid-cache/x.png` | run twice with `--json` | stdout parses as one JSON object deep-equal to `prepare.json`; 3 outputs rewritten (mtime advanced); `keep.txt` and cache file unchanged |
| E24 | craft-doc-prepare: doc-engine frontmatter keys | EP | L1 | automated | frontmatter `enable_toc: true`, `toc_heading: Tartalom`, `document_title: Q3`, `table_style: {...}` | `doc prepare` | `toc` = `{enabled:true, heading:"Tartalom", levels:3}`; `title` = `Q3`; `ignored` contains `table_style` |
| E25 | craft-cli-entrypoint: `doc` dispatch + exit codes | decision-table | L1 | automated | — | `pi-craft --help`, `pi-craft doc --help`, `pi-craft doc`, `pi-craft doc bogus`, `pi-craft doc prepare in.md` (no `--out`) | exit 0 + usage lists `doc prepare`; 0; 1; 1; 2 |
| E26 | craft-app-skills: Skills declared (23) | BVA (count) | L1 | automated | `package.json` after the change | `packaging.test.ts` | `pi.skills` length 23; tarball holds exactly 23 `.pi/skills/*/SKILL.md` including the 5 office dirs |
| E27 | craft-office-workflow-skills: Office workflow skills shipped | EP (per skill) | L1 | automated | 5 office `SKILL.md`, names in `WORKFLOW_SKILL_NAMES` | workflow lint | frontmatter name == dir; description > 60 chars with ≥ 1 double-quoted phrasing of ≥ 6 chars |
| E28 | craft-app-skills: Router lists the office workflows | EP | L1 | automated | `craft-studio/SKILL.md` | router lint | workflow table names all 5 office workflows; text states `craft-doc-publish` is the default md→DOCX/PDF path and names `document-converter` for ingest/round-trip/PlantUML |
| E29 | Step contract and verification gate (office) | decision-table (output type × gate) | L1 | automated | 5 office step tables | workflow lint | no `pi-craft verify` line targets `*.svg`; every svg-producing step is followed by a `convert … .png` + `pi-craft verify … --size`; no `--alpha` on `*.tif`/`*.tiff`; failed-gate text states re-discovery, max 2 retries and stop; exit `3` text states stop + report |
| E30 | Resumable jobs (office skill content) | EP | L1 | automated | 5 office `SKILL.md` | workflow lint | each links the router "Craft jobs" section and does not restate the slug rule; `craft-doc-publish` and `craft-brand-kit` state that passwords/keys are not written to `job.json` |
| E31 | Soft references (office) | decision-table (sibling × workflow) | L1 | automated | sibling map: W5 {anti-slop-brandkit, pi-nano-banana}, W6 {document-converter, mmdc, pi-nano-banana}, W7 {deck3d}, W8 {pi-nano-banana} | workflow lint on step 0 | step 0 names each mapped sibling, its package (`@blackbelt-technology/anti-slop-frontend`, `…-document-converter`, `…-deck3d`, `@mermaid-js/mermaid-cli`) and a degraded path |
| E32 | Skill drift (office union) | EP (known id) | L1 | automated | office skills' `pi-craft <app> exec` lines + per-workflow app map | offline drift lint | every quoted id resolves in the union of the mapped apps' fixtures (e.g. `imageTrace.make` → vectorcraft, `references.toc` → wordcraft, `doc_protect` → pdfcraft) |
| E33 | Data visual read-back gate | EP (each error token) + BVA (clean) | L1 | automated | 8 `cat`-style fixture outputs: one per error token `#NAME?` `#DIV/0!` `#REF!` `#VALUE!` `#N/A` `#NUM!` `#NULL!`, plus a clean one | run the `check:` fence extracted from `craft-data-visual` under `bash -e` | exit ≠ 0 for each of the 7 error fixtures; exit 0 for the clean one |
| E34 | Document publishing default (skill content) | EP | L1 | automated | `craft-doc-publish/SKILL.md` | workflow lint | uses `run --file` and never `run --template`; render gate line has `--pages` and `--text-contains`; prepare gate checks `unresolved`, `mermaid.unrendered`, `images.skipped`, `images.remote`, `defaulted` |
| E35 | Brand kit respects brandkit opt-in (skill content) | EP | L1 | automated | `craft-brand-kit/SKILL.md` | workflow lint | default path uses `imageTrace`; `anti-slop-brandkit` appears only in a section that mentions explicit request and approval; derived assets labelled "concept" |
| E36 | Deck renderers are alternatives (skill content) | EP | L1 | automated | `craft-deck/SKILL.md` | workflow lint | a deck3d branch with no DeckCraft/PdfCraft step; no pptx↔HTML conversion step |
| E37 | W8 scope (skill content) | EP (negative) | L1 | automated | `craft-photo-pipeline/SKILL.md` | workflow lint | no `dataset`, `LoRA` or `lora-dataset` reference |

### Performance

None. The spec sets no latency or throughput budget.

### Frontend-quirk

None. There is no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Document publishing default (real binaries) | happy path | L1 | automated | — (provisioned WordCraft + PdfCraft; in-repo fixture template with a textbox cover + first-page header) | `CRAFT_E2E=1` + workflow opt-in: `doc prepare` → WordCraft `run --file` (body + TOC) → `convert` pdf | `pi-craft verify out.pdf --text-contains "<document_title>" --text-contains "ACME Kft."` exits 0; the out.docx keeps `header*.xml` and `footer*.xml` parts |
| X2 | Step contract: page-count gate (real binaries) | fault-injection (wrong count) | L1 | automated | published PDF has N pages | `pi-craft verify out.pdf --pages N+1` | exit `1`; report shows expected N+1, actual N |
| X3 | Office workflow recipes end-to-end (real binaries) | happy path per workflow | L1 | automated | provisioned apps + sample inputs | run each office workflow's recipe fences under `CRAFT_E2E=1` + workflow opt-in | every recipe exits 0 with all `pi-craft verify` assertions passing; with the opt-in unset, the office describes are reported skipped, not failed |
| X4 | Soft references: no image credentials (agent) | fault-injection (absent creds) | — | manual-only | `pi-nano-banana` without credentials | pi session runs `craft-brand-kit` | [judgment: agent says so and offers to start from a user logo] |
| X5 | Brandkit requested without confirmation (agent) | state-transition | — | manual-only | user asks for generated logo concepts | pi session runs `craft-brand-kit` | [judgment: no image generated until the paid plan is confirmed] |
| X6 | Probe tool unavailable, exit 3 (agent) | fault-injection | — | manual-only | PdfCraft not provisionable | a PDF gate runs | [judgment: agent reports pdfcraft unavailable and stops] |
| X7 | Resume after interruption (agent) | state-transition | — | manual-only | W6 job verified through render, stopped before protect | re-run the job | [judgment: agent starts at protect and reuses the verified pdf] |
| X8 | Protect password not persisted (agent) | EP | — | manual-only | W6 protect step with a password | inspect `job.json` afterwards | [judgment: password absent from `job.json` and reports — agent-written file] |
| X9 | Template default confirmation + unrendered diagram (agent) | decision-table | — | manual-only | prepare reports `defaulted: [client_name]` / `mermaid.unrendered: 1` | pi session runs `craft-doc-publish` | [judgment: agent asks to confirm/supply, or to install mmdc/accept, before rendering] |
| X10 | Routing: round-trip → document-converter; HTML deck → deck3d (agent) | EP | — | manual-only | user asks for a DOCX round-trip edit / a 3D web deck | pi session | [judgment: routes to `document-converter` / `deck3d`] |
| X11 | Data-visual formula error (agent) | fault-injection | — | manual-only | source range with `#DIV/0!` | pi session runs `craft-data-visual` | [judgment: agent stops before the chart export] |
| X12 | One end-to-end run per workflow (task: manual QA) | end-to-end | — | manual-only | real inputs per workflow | pi session runs W5–W9 | [judgment: every verify report passes and the outputs look right; W6 PDF visually matches the template (fonts, cover, headers)] |

---

## Coverage summary

- Requirements covered: 18/18. The 7 ADDED in `craft-office-workflow-skills` and the 4 in `craft-doc-prepare` cover the ADDED scenario blocks. Also covered: 2 MODIFIED in `craft-app-skills`, 1 MODIFIED in `craft-cli-entrypoint`, the step-contract retry/exit-3 rules, and the W8/W7/W5 scope rules.
- Scenarios by class: edge 37 · perf 0 · frontend 0 · error 12
- Scenarios by level: L1 40 · L2 0 · L3 0 · — 9
- Scenarios by disposition: automated 40 · manual-only 9

## New infra needed

- None. The plan extends `skills.test.ts`, `packaging.test.ts`, `skills-drift.test.ts`, `skills-recipes.test.ts`, `craft-cli.test.ts` and `helpers/skills.ts` (media baseline), and adds:
  - `doc-prepare.test.ts`;
  - a small docx fixture builder (fflate) under `src/__tests__/helpers/`;
  - stub `mmdc` / `pi-nano-banana` scripts under `src/__tests__/fixtures/`.
