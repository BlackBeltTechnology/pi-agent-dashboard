# Test Plan — add-preview-apply-fix-to-file

Stage: design   Generated: 2026-10-08

HARD gate passed — clarification answered: 404 → "file changed — reload"; network / 403 / 500 → "Could not apply fix: <error>" (no reload offer, no retry). Folded into `specs/preview-fix-write-back/spec.md` (Conflict-safe write).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Block-exact write-back · md fence in place | EP (ordinal) | L1 | automated | md file: mermaid fence #0, a `js` fence, mermaid fence #1, mermaid fence #2 | `spliceMermaidBlock(file, "md", 1, fixed)` | only lines strictly between fence #1 opener and closer differ; opener + closer lines byte-identical; every byte outside equals input |
| E2 | Block-exact · indented fence in list | EP (container) | L1 | automated | `1. item\n\n   ```mermaid\n   graph TD\n\n   A-->B\n   ```` | splice ordinal 0 with a 3-line fixed source containing a blank line | every non-blank inner line starts with exactly 3 spaces; blank line written empty; opener/closer unchanged |
| E3 | Block-exact · fence variants | EP | L1 | automated | `~~~mermaid` fence; 4-backtick ```` ````mermaid ```` fence whose content contains a ```` ``` ```` line | locate ordinals 0 and 1 | located value of #1 includes the inner ```` ``` ```` line; closer is the 4-backtick line; tilde closer preserved on splice |
| E4 | Block-exact · CRLF | EP (line ending) | L1 | automated | md file with all `\r\n` endings | splice ordinal 0 with LF-joined fixed source | written inner lines end `\r\n`; output contains no `\n` not preceded by `\r` |
| E5 | Block-exact · round-trip invariant | invariant | L1 | automated | md, adoc and mmd fixtures (incl. CRLF, BOM, no final newline) | `splice(file, n, locate(file, n).value)` | result `===` input file for every fixture and ordinal |
| E6 | Block-exact · duplicate diagrams | EP | L1 | automated | md with two byte-identical failing mermaid fences | splice ordinal 1 | first block bytes unchanged; second block replaced |
| E7 | Block-exact · fence inside blockquote | EP (invalid partition) | L1 | automated | `> ```mermaid\n> graph TD\n> ```` | locate ordinal 0 | locator returns `not-applicable` result; splice not invoked |
| E8 | Block-exact · fence on list-marker line | EP (invalid partition) | L1 | automated | `- ```mermaid\n  graph TD\n  ```` | locate ordinal 0 | `not-applicable` |
| E9 | Block-exact · unclosed fence | BVA (EOF) | L1 | automated | md ending inside an open ```` ```mermaid ```` fence | locate ordinal 0 | `not-applicable` |
| E10 | Block-exact · frontmatter parity | decision-table | L1 | automated | file with YAML frontmatter whose string value contains ```` ```mermaid ```` text, then one body mermaid fence | locate ordinal 0 | located block is the body fence; locator count = 1 |
| E11 | Apply-fix availability · ordinal stamp parity | invariant | L1 | automated | md fixture with 3 mermaid fences + a raw-HTML `<pre><code class="language-mermaid">` block, rendered by `MarkdownContent` | render | `MermaidBlock`s for fences receive ordinals `"0"`,`"1"`,`"2"` matching locator order; the raw-HTML block receives no ordinal (no Apply action) |
| E12 | Block-exact · md exact verify with entities | EP | L1 | automated | fence content `A -->\|a &gt; b &amp; c\| B` and `A --> B<br>C` | render via `MarkdownContent` and locate same file | rendered `code` prop `===` located `code.value` (verify passes) |
| E13 | Block-exact · AsciiDoc source block | EP (delimiters) | L1 | automated | adoc with `[source,mermaid]` + `----` block and `[source,mermaid,opts=x]` + `......` (6-dot) block | splice ordinals 0 and 1 | only lines between each identical delimiter pair change; attribute + delimiter lines byte-identical |
| E14 | Block-exact · AsciiDoc count parity | decision-table | L1 | automated | raw adoc with 2 mermaid source blocks, `expectedCount` = 3 | locate ordinal 0 | `not-applicable`; no splice |
| E15 | Block-exact · AsciiDoc substitution mismatch | EP | L1 | automated | adoc mermaid block containing callout `<1>`; splitter `source` lacks it | verify | verify fails → no write |
| E16 | Block-exact · mmd whole file | EP (final newline/BOM) | L1 | automated | `.mmd` files: with final `\n`; without; with UTF-8 BOM; CRLF | splice ordinal 0 | final-newline presence, BOM and line-ending style match the input file |
| E17 | Write target authorization · Mermaid in scope | decision-table | L1 | automated | `<cwd>/flow.mmd`, `<cwd>/flow.mermaid`, `<cwd>/FLOW.MMD` | `isWritableMdTarget(p, {cwd})` | `true` for each |
| E18 | Write target authorization · global rejects Mermaid | decision-table | L1 | automated | `<home>/.pi/agent/flow.mmd` existing | `isWritableMdTarget(p, {home})` (no cwd) | `false`; `POST /api/file/write` global-scope → 403 |
| E19 | Write target authorization · symlinked Mermaid escape | EP (invalid) | L1 | automated | `<cwd>/flow.mmd` → symlink to `<outside>/x.mmd` | `isWritableMdTarget(p, {cwd})` | `false` |
| E20 | Write target authorization · picker ⊆ guard | invariant | L1 | automated | cwd with `a.md`, `b.mmd`, `c.mermaid` | `listMdCandidates({cwd})` | result contains `a.md` only (picker unchanged) |
| E21 | Block-exact · md-read + write accept `.mmd` | state | L1 | automated | live session cwd with `flow.mmd` | `GET /api/file/md-read` then `POST /api/file/write` with returned mtime | md-read 200 `{content, mtime}`; write 200; disk content = posted content |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Apply-fix availability · chat diagram | decision-table | L1 | automated | repaired outcome, no `MermaidSourceContext` | render `MermaidBlock` | no "Apply fix to file" button; copy-fixed button present |
| F2 | Apply-fix availability · not repaired | decision-table | L1 | automated | context present, outcome `ok` | render | no Apply button |
| F3 | Apply-fix availability · unsaved editor | decision-table | L1 | automated | context `isDirty: true`, repaired outcome | render | Apply button `disabled`; hint "save or discard edits first" visible |
| F4 | Diff confirmation · shown after re-read | state-transition | L1 | automated | context + repaired; mocked md-read returns matching file | click Apply | md-read called once; dialog lists removed on-disk lines and added fixed lines; POST count 0 |
| F5 | Diff confirmation · cancel | state-transition | L1 | automated | open diff dialog | click Cancel; separately press Escape | dialog closed; POST count 0; focus returns to Apply button |
| F6 | Diff confirmation · confirm | state-transition | L1 | automated | open diff dialog, md-read mtime `1700000000123.456` | click Confirm | one POST `/api/file/write` with `{cwd, path, content: spliced, mtime: 1700000000123.456}`; `reload` called once |
| F7 | Diff confirmation · accessible modal | state | L1 | automated | open diff dialog | Tab repeatedly | `role="dialog"` + `aria-modal="true"`; focus never leaves dialog |
| F8 | Apply-fix availability · stable context | invariant | L1 | automated | `FilePreviewOverlay`, `MarkdownViewer`, `MarkdownPreview`, `AsciiDocPreview` host, `MermaidViewer` | parent re-render with unchanged props | context value identity unchanged (`Object.is`); `MarkdownContent` memo not re-run |
| F9 | Apply-fix availability · non-session cwd | decision-table | L1 | automated | surface opened for a cwd not in the live session list | render repaired diagram | no Apply button |
| F10 | i18n keys | completeness | L1 | automated | new apply-fix keys | run i18n completeness test | every key present in EN and HU |
| F11 | Preview refreshes · md end-to-end | state-convergence | L3 | automated | docker harness session cwd with `docs/flow.md` containing a rule-repairable broken mermaid fence inside a list item | open in FilePreviewOverlay → Apply → Confirm | file read back via API differs only inside the block; preview converges to the diagram with no auto-fixed badge |
| F12 | Preview refreshes · `.mmd` end-to-end | state-convergence | L3 | automated | session cwd with broken `flow.mmd` | open in editor-pane Mermaid tab → Apply → Confirm | file content = fixed source (final newline preserved); tab re-renders with no badge |
| F13 | Block-exact · AsciiDoc end-to-end (real asciidoctor) | state-convergence | L3 | automated | session cwd with `guide.adoc` holding a broken `[source,mermaid]` block plus a plantuml block | AsciiDoc preview → Apply → Confirm | only lines between the mermaid delimiters change; preview shows no badge |
| F14 | Diff confirmation · visual legibility | visual/subjective | — | manual-only | diff dialog in all 4 themes (studio, earth, athlete, gradient), desktop + mobile width | human looks | [judgment: removed/added lines distinguishable and readable — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Conflict-safe write · edited externally | fault-injection (content drift) | L1 | automated | md-read returns file whose block #1 differs from rendered `code` | click Apply | no dialog; POST count 0; "file changed — reload" with reload action shown |
| X2 | Conflict-safe write · 409 | fault-injection (abort) | L1 | automated | POST returns 409 | Confirm | POST count stays 1 (no retry); "file changed — reload" shown |
| X3 | Conflict-safe write · 404 | fault-injection (abort) | L1 | automated | md-read returns 404 | click Apply | POST count 0; "file changed — reload" shown |
| X4 | Conflict-safe write · network failure | fault-injection (abort) | L1 | automated | md-read fetch rejects (network error) | click Apply | POST count 0; "Could not apply fix: <error>" shown; no reload action |
| X5 | Conflict-safe write · 403 / 500 on write | fault-injection (abort) | L1 | automated | POST returns 403, and separately 500 | Confirm | POST count stays 1; "Could not apply fix: <error>"; no reload action |
| X6 | Block-exact · not applicable surfaced | fault-injection (locator) | L1 | automated | md-read returns file where target fence sits in a blockquote | click Apply | POST count 0; "cannot be applied to this block" message |
| X7 | Conflict-safe write · real mtime race | fault-injection (concurrent write) | L3 | automated | harness: file modified on disk (API write) after the diff dialog opens | Confirm | server 409; "file changed — reload" shown; on-disk content equals the external edit |

---

## Coverage summary

- Requirements covered: 6/6 (Apply-fix availability, Diff confirmation, Block-exact write-back, Conflict-safe write, Preview refreshes, Write target authorization)
- Scenarios by class: edge 21 · perf 0 · frontend 14 · error 7
- Scenarios by level: L1 37 · L2 0 · L3 4 · — 1
- Scenarios by disposition: automated 41 · manual-only 1
- Performance: no latency/size requirement in spec → no perf rows.

## New infra needed

- none (L1: vitest suites exist; L3: docker harness + `tests/e2e/diagram-preview.spec.ts`, `editor-pane.spec.ts`, `asciidoc-preview.spec.ts` exemplars)
