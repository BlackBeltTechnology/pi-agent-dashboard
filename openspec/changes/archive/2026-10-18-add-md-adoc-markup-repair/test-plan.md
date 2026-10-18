# Test Plan — add-md-adoc-markup-repair

Stage: design   Generated: 2026-10-08

Gate decisions (answered via ask_user): AsciiDoc view-original = lazy `/api/file/render?…&repair=0` on first toggle; no markdown repair perf budget (memoized) → no performance scenario.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Markdown block repair rules (M2 other char) | EP | L1 | automated | "```js\na\n~~~\ntext\n" | `repairMarkdown(src)` | line 3 becomes "```"; `repairs` = `[{rule:"M2",line:1}]`; all other bytes equal |
| E2 | Markdown block repair rules (M2 shorter) | BVA | L1 | automated | "````\na\n```\ntext\n" (never closed) | `repairMarkdown(src)` | line 3 becomes "````"; `repairs` = `[{M2,1}]` |
| E3 | Markdown block repair rules (M2 min length) | BVA | L1 | automated | "```\na\n~~\n\n# H\n" | `repairMarkdown(src)` | `~~` untouched; closer "```" inserted before line 4 (blank kept); `repairs` = `[{M3,1}]` |
| E4 | Markdown block repair rules (M3) | EP | L1 | automated | "```sh\necho\n\n# Heading\nbody\n" | `repairMarkdown(src)` | output "```sh\necho\n```\n\n# Heading\nbody\n"; `repairs` = `[{M3,1}]` |
| E5 | Markdown block repair rules (no candidate) | EP | L1 | automated | "```sh\n# comment\necho\n" (no blank-line heading, no closer-like line) | `repairMarkdown(src)` | `repairs` = `[]`, source byte-equal |
| E6 | Markdown block repair rules (properly closed) | decision-table | L1 | automated | "````md\n```\n````\n" | `repairMarkdown(src)` | `repairs` = `[]`, source byte-equal |
| E7 | Markup repair limited to file previews (frontmatter) | EP | L1 | automated | "---\nx: |\n  ```\n---\n# T\n" | `repairMarkdown(src)` | `repairs` = `[]` |
| E8 | Markup repair limited to file previews (containers) | decision-table | L1 | automated | (a) "> ```js\n> a\n\n# H\n" (b) "- item\n  ```js\n  a\n\n# H\n" | `repairMarkdown(src)` each | both `repairs` = `[]`, source byte-equal |
| E9 | Repair is pure and idempotent (multi-repair lines) | state | L1 | automated | two unterminated top-level fences, openers at original lines 1 and 7, each followed by blank + heading | `repairMarkdown(src)` | `repairs` = `[{M3,1},{M3,7}]` (original numbering); second run `repairs` = `[]` |
| E10 | Repair is pure and idempotent (line endings) | EP | L1 | automated | (a) all-CRLF E4 doc (b) mixed doc: opener line CRLF, other lines LF | `repairMarkdown(src)` | (a) inserted closer ends "\r\n" (b) inserted line ends like the opener; every pre-existing line byte-identical |
| E11 | Repair is pure and idempotent (property) | property | L1 | automated | every md + adoc fixture of E1–E18 | `r = repair(src); repair(r.source)` | second call `repairs` = `[]` and source === `r.source` |
| E12 | Markdown block repair rules (opener last line) | BVA | L1 | automated | "text\n```mermaid" (no trailing newline) | `repairMarkdown(src)` | `repairs` = `[]` |
| E13 | AsciiDoc repair rules (A1) | EP | L1 | automated | (a) "[mermaid]\n----\ngraph TD\n----\n" (b) "[mermaid,format=svg]" (c) `....` delimiters (d) ".Title" line between style and `----` | `repairAsciiDoc(src)` | attribute line becomes `[source,mermaid]` / `[source,mermaid,format=svg]`; `repairs` = `[{A1,1}]`; no other line changes |
| E14 | AsciiDoc repair rules (A1 negatives) | decision-table | L1 | automated | (a) "[mermaid]\nparagraph text\n" (b) "[source,mermaid]\n----\n…\n----\n" | `repairAsciiDoc(src)` | both `repairs` = `[]`, source byte-equal |
| E15 | AsciiDoc repair rules (A2 length mismatch) | BVA | L1 | automated | "----\ncode\n-----\nafter\n" | `repairAsciiDoc(src)` | line 3 becomes "----"; `repairs` = `[{A2,1}]` |
| E16 | AsciiDoc repair rules (A2 before section) | EP | L1 | automated | "----\ncode\n\n== Next\n" | `repairAsciiDoc(src)` | "----" inserted before line 3 (blank kept); `repairs` = `[{A2,1}]` |
| E17 | AsciiDoc repair rules (A2 no-repair cases) | decision-table | L1 | automated | (a) "----\ncode\n" EOF (b) unterminated `----` inside `====` (c) inside `--` open block (d) list-item block (e) siblings `----` and `------` both closed | `repairAsciiDoc(src)` | all `repairs` = `[]`, source byte-equal |
| E18 | AsciiDoc repair rules (no unsafe syntax) | decision-table | L1 | automated | E13–E16 fixtures + one containing `include::/etc/passwd[]` | `repairAsciiDoc(src)` | output contains no line matching `^\+{3,}$`, `pass:`, `include::` or `^:[\w-]+:` that was not already in the input |
| E19 | AsciiDoc rendering endpoint (clean) | EP | L1 | automated | `notes.adoc` valid | `GET /api/file/render?cwd&path=notes.adoc` | 200, `repairs: []`, `warnings: []`, `mtime` is a number |
| E20 | AsciiDoc rendering endpoint (A2) | EP | L1 | automated | `guide.adoc` with unterminated `----` on line 3 before blank + `== Next` | `GET /api/file/render` | `repairs` = `[{A2,3}]`; `html` contains an `h2` "Next"; no "unterminated listing block" warning |
| E21 | AsciiDoc rendering endpoint (repair=0) | decision-table | L1 | automated | same `guide.adoc` | `GET /api/file/render?…&repair=0` | `repairs: []`; `warnings` has text "unterminated listing block" line 3; `html` has no `h2` "Next" |
| E22 | Diagram source blocks hydrate (bare style) | EP | L1 | automated | `.adoc` with "[mermaid]\n----\ngraph TD\n----" | `GET /api/file/render` | `repairs` = `[{A1,1}]`; `html` contains `class="language-mermaid"` |
| E23 | AsciiDoc rendering endpoint (secure) | fault-injection | L1 | automated | `.adoc` with a bare `[mermaid]` block AND `include::/etc/passwd[]` | `GET /api/file/render` | `repairs` non-empty; `html` does not contain `root:` |
| E24 | AsciiDoc rendering endpoint (logger restore) | state | L1 | automated | broken doc then clean doc | two sequential `GET /api/file/render` | second response `warnings: []`; asciidoctor `LoggerManager.getLogger()` after each request === the logger before |
| E25 | Markup fix can be applied (diff scope) | property | L1 | automated | each md/adoc fixture with repairs | line diff of `src` vs `repair(src).source` | changed lines == exactly the replaced/inserted lines (count = number of repairs) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Mermaid fence at end of a file renders | decision-table | L1 | automated | "# T\n```mermaid\ngraph TD\nA-->B" (EOF-unclosed) | render `MarkdownContent` with `staticSource` vs without | with: `MermaidBlock` gets `complete=true`, no repair notice; without: `complete=false` (streaming gate unchanged) |
| F2 | Mermaid fence at end of a file renders (tilde) | EP | L1 | automated | "~~~mermaid\ngraph TD\n~~~\n" | render with `staticSource` | `MermaidBlock` gets `complete=true` |
| F3 | Markup repair limited (chat untouched) | decision-table | L1 | automated | E4 content | render `MarkdownContent` without `staticSource` | no `MarkupRepairBanner` in DOM; "# Heading" text inside the code block |
| F4 | Repairs are visible (md notice) | EP | L1 | automated | E4 content | render with `staticSource` | banner lists the M3 repair with "line 1"; `h1` "Heading" rendered outside `pre` |
| F5 | Repairs are visible (md view original) | state-transition | L1 | automated | E4 content, rendered with `staticSource` | click "View original rendering" twice | 1st: `aria-pressed="true"`, "# Heading" inside the code block; 2nd: `aria-pressed="false"`, `h1` back; M1 `complete=true` in both states |
| F6 | Repairs are visible (adoc view original) | state-transition | L1 | automated | `AsciiDocPreview` with mocked render response `repairs:[{A2,3}]` | toggle view original on, off, on | exactly one fetch with `repair=0`; 2nd "on" uses the cached HTML; banner lists "line 3" |
| F7 | Repairs are visible (every surface) | decision-table | L1 | automated | E4 file in `MarkdownPreviewView` (no `MermaidSourceContext`) and in `FilePreviewOverlay` (with context) | render each | both show the banner; apply button absent in `MarkdownPreviewView`, present in overlay |
| F8 | Markup repair limited (call-site inventory) | decision-table | L1 | automated | all `MarkdownContent` call sites | static inventory test | chat/thinking/tool call sites do not pass `staticSource`; `FilePreviewOverlay`, `MarkdownViewer`, `MarkdownPreview`, `MarkdownPreviewView` pass `staticSource` |
| F9 | Markup fix can be applied (dirty) | state | L1 | automated | context `isDirty: true`, banner active | render banner | apply button `disabled`, explanation text shown |
| F10 | Per-diagram apply waits for markup apply | state-transition | L1 | automated | md file with M3 repair + an auto-fixed mermaid block, context present | render; then reload with repaired content | 1st: diagram apply `disabled` with "apply the markup fix first"; after reload (no repairs): diagram apply enabled |
| F11 | Banner i18n | EP | L1 | automated | new `markupRepair.*` keys | i18n completeness test | every key present in EN and HU |
| F12 | AsciiDoc repair rules + visible notice (rendered) | state-convergence | L3 | automated | harness fixture `markup-broken.adoc`: bare `[mermaid]` `----` block + unterminated listing before `== Next` | `/view @markup-broken.adoc` | `.asciidoc-body` converges to one mermaid `svg` and an `h2` "Next"; banner lists A1 and A2; view-original → no `svg`, no `h2` "Next" |
| F13 | Mermaid fence at end of a file renders (rendered) | state-convergence | L3 | automated | harness fixture `mermaid-eof.md` ending inside a "```mermaid" fence | `/view @mermaid-eof.md` | preview converges to a mermaid `svg`; no "Loading diagram" text remains |
| F14 | Repairs are visible (visual) | visual/subjective | — | manual-only | banner on a repaired `.md` and `.adoc` in all 4 themes | human looks | [judgment: banner legible, not obstructing content, matches theme] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Markup fix can be applied (success) | state-transition | L1 | automated | none; `md-read` returns displayed content + mtime T | click apply → confirm diff | `POST /api/file/write` with `repair(content).source` and `mtime: T`; then `reload` called once |
| X2 | Markup fix can be applied (md changed) | fault-injection (abort) | L1 | automated | `md-read` content differs from displayed content by one byte | click apply | no `POST`; "file changed — reload" shown; no diff dialog |
| X3 | Markup fix can be applied (adoc changed) | fault-injection (abort) | L1 | automated | `md-read` mtime ≠ render response `mtime` | click apply in `AsciiDocPreview` | no `POST`; "file changed — reload" shown |
| X4 | Markup fix can be applied (409) | fault-injection (abort) | L1 | automated | `POST /api/file/write` returns 409 | confirm diff | exactly one `POST` (no retry); "file changed — reload" shown; banner still present |
| X5 | Markup fix can be applied (cancel) | state-transition | L1 | automated | none | open diff dialog → Cancel / Escape | no `POST`; banner unchanged |
| X6 | Markup fix can be applied (real file) | end-to-end | — | manual-only | scratch git repo: `.md` with `~~~` closing a "```" fence, `.adoc` with bare `[mermaid]` + unterminated listing | apply in the running dashboard | `git diff` touches only the repaired lines; preview reloads with no banner [judgment: whole flow on a real install] |

---

## Coverage summary

- Requirements covered: 9/9 (markup-repair: 7, file-and-url-preview MODIFIED: 2)
- Scenarios by class: edge 25 · perf 0 · frontend 14 · error 6
- Scenarios by level: L1 40 · L2 0 · L3 2 · manual 2
- Scenarios by disposition: automated 43 · manual-only 2

## New infra needed

- none (L3 needs two fixture files in `docker/fixtures/sample-git/`, same mechanism as `styling.adoc`)
