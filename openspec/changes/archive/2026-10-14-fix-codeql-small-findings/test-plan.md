# Test Plan — fix-codeql-small-findings

Stage: design   Generated: 2026-10-13

Hard gate cleared: no unfillable Triple slots after doubt-review cycles 1–3
(adversarial inputs, budgets, edge-case expected outputs and the old-vs-new
orderings are pinned in specs/design and were reproduced by probe). Every
"identical output" claim is tested **differentially**: the test file embeds the
previous regex/implementation verbatim as an oracle and compares on a fixed edge
list plus a seeded random corpus (seeded PRNG, so failures reproduce). Timing
scenarios use `performance.now()` around one call on a 100 000-character input
with a 100 ms budget; the linear scans measured ≤ 2.3 ms and the pre-fix code
3.4 s or more, so the budget fails pre-fix and has ≥ 40× headroom post-fix.
`remark-gfm` is a declared client dependency only: GFM cell counting lives in
client tests; shared/doctor-core tests assert exact emitted bytes.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | bounded-input-parsing — DOX row parsing unchanged on real and edge rows | differential (oracle) + EP | L1 | automated | every `AGENTS.md` under the repo (git ls-files) plus the rows of fixture R | `parseRows`, `replaceRowPurpose(md, path, "NEW")`, `parseFileIndex`, `parseAuthoredBatch` on each | output deep-equals the embedded old-regex oracle for every input, including `[]` / no entry / unchanged file where the oracle gives none |
| E2 | bounded-input-parsing — DOX row parsing unchanged (random corpus) | property (differential fuzz) | L1 | automated | 50 000 seeded random lines over the fixture-R alphabet, 70 % prefixed with the fixture-R row head | `matchRow` vs old strict regex; `matchRowLoose` vs old `parseAuthoredBatch` line logic | 0 differences |
| E3 | bounded-input-parsing — link extraction unchanged on edge inputs | EP (edge list) | L1 | automated | text `[[target]] [[ spaced ]] [[ ]] [[a]b]] [[[a]] [x](docs/a.md) [y](b.mdx) [z](c.txt) [w](a(b).md) [v](a.md ) ](.md)` | `chunkMarkdown({root:"r",path:"a.md",text})` | `wikilinks` = `["target","spaced","","[a"]`; `mdLinks` = `["docs/a.md","b.mdx"]` |
| E4 | bounded-input-parsing — link extraction unchanged (random corpus) | property (differential fuzz) | L1 | automated | 50 000 seeded random strings over `[ ] ( ) . m d x a space` | `chunkMarkdown` vs old `matchAll` oracle | `wikilinks` and `mdLinks` equal the oracle for every string |
| E5 | bounded-input-parsing — branch slug unchanged | EP + property | L1 | automated | `-feat`, `--x--`, `/foo`, `a/b`, `""`, a 70-char name; plus 20 000 seeded strings over `- / \ : space A a 9 . _ é` | `slugifyBranch` vs old regex chain oracle | `feat`, `x`, `foo` for the first three; every result equals the oracle |
| E6 | bounded-input-parsing — local-path basename rules unchanged | EP | L1 | automated | `sourcesMatch("/p/foo.git/","git:github.com/o/foo")`, `("/p/pkg\\","git:github.com/o/pkg")`, `("/p/foo.GIT","git:github.com/o/foo")` | call | `true`, `false`, `false` |
| E7 | doctor-diagnostic — backslash before pipe; name cell (shared formatter) | EP | L1 | automated | report with the five checks of fixture D | shared doctor Markdown formatter | each check's row contains exactly the fixture-D emitted name and message cells; every table row is a single line |
| E8 | doctor-diagnostic — cells parse to four columns (GFM) | contract (remark-gfm) | L1 | automated | fixture-D table built with `escapeMdTableCell` on name and message, and the same table built with the pre-fix escape (oracle) | parse with `unified().use(remarkParse).use(remarkGfm)` | post-fix: one table, one row per check, each row 4 cells; pre-fix oracle: at least one row ≠ 4 cells (proves the scenario discriminates) |
| E9 | doctor-diagnostic — web Copy as Markdown escaped | EP | L1 | automated | `DiagnosticsSection` with a report containing the E7 checks | click Copy as Markdown (mocked `navigator.clipboard.writeText`) | copied text contains the E7 cells; parsed with remark-gfm each check row has 4 cells and the lone-CR message stays one row |
| E10 | doctor-diagnostic — escape order (helper) | decision-table | L1 | automated | the helper cases of fixture D | `escapeMdTableCell` | each output equals the fixture-D expected value (`\r\n` → exactly one space) |
| E11 | doctor-diagnostic — Electron doctor page escapes name and message | static source contract | L1 | automated | `packages/electron/src/renderer/doctor.html` text | read file | the name and message cell expressions each apply the three fixture-D steps in order (backslash, then pipe, then line endings with `/\r\n?\|\n/g`); the old `/\r?\n/` replace is gone from those cells |
| E12 | kb-file-index-migration — dollar-prefixed identifier grounded | EP | L1 | automated | purpose `` uses `$StoreKey` ``; source `const $StoreKey = 1` | grounding check | no ungrounded identifiers |
| E13 | kb-file-index-migration — identifier adjacent to `$` not grounded | EP | L1 | automated | purpose `` uses `FooBar` ``; source `const $FooBar = 1; FooBar$x();` | grounding check | `FooBar` reported ungrounded (pre-fix: grounded) |
| E14 | design D4 — branch list parse | contract (real git) | L1 | automated | temp repo: branches `main` (current) and `feature/x`; bare remote `origin` with `origin/HEAD` and `origin/only-remote` | `listBranches(repo)` | local names exactly `main`, `feature/x` (no trailing space); only `main` has `isCurrent`; remote list contains `origin/only-remote` and no name ending in `/HEAD` |
| E15 | design D4 — YouTube host set | EP + coupling invariant | L1 | automated | URLs on `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be` (watch / shorts / embed / short-link forms), and `music.youtube.com`, `evilyoutube.com`, `youtube.com.evil.example` | `extractYouTubeId`; `dispatchPreview` | the four canonical hosts return the id; the other three return `null`; `dispatchPreview` routes none of the other three to the YouTube renderer |
| E16 | design D4 — splash status embeds text as a JSON literal | static source contract | L1 | automated | `packages/electron/src/main.ts` text | read file | `updateSplashStatus` builds `el.textContent = ${JSON.stringify(text)};` with no backtick or `$` escaping of `text` and no template-literal delimiters around the value |

#### Fixtures (exact strings; fenced to avoid table escaping)

```text
Fixture R — DOX row edge rows (each line one input; <CR> = \r, <LS> = U+2028, <TAB> = tab)
| `a` |  |
| `a` | x | y |
| `a` | x \| y |
| `a` | x || y |
| `a` | `code` text |
| `a` | x<TAB><TAB>|<TAB>
| `a` | x |<CR>
| `a` | x<CR>|
| `a` | x<LS>|
| `a` | x
| `a` | x<CR>y |
| `a` | x<LS>y |
Row head for E2: | `a` |
E2 alphabet: |  space  tab  <CR>  <LS>  U+2029  `  a  b  \

Fixture D — doctor cells (input → emitted cell)
message  a\|b                → a\\\|b
message  C:\path\            → C:\\path\\
name     ABI mismatch: a|b\   → ABI mismatch: a\|b\\
message  line1<LF>line2       → line1 line2
message  line1<CR>line2       → line1 line2
helper   \        → \\
helper   |        → \|
helper   \|       → \\\|
helper   a<CR><LF>b → a b
helper   a<CR>b   → a b
helper   a<LF>b   → a b
helper   plain    → plain
Steps: replace \ with \\ ; then | with \| ; then /\r\n?|\n/g with one space.
```

### Performance

| id | requirement | technique | level | disposition | load | trigger | expected observable |
|----|-------------|-----------|-------|-------------|------|---------|---------------------|
| P1 | bounded-input-parsing — DOX file with a long whitespace run | boundary (CodeQL witness) | L1 | automated | `` \| `a` \| `` + 100 000 spaces + `x` | `parseRows`, `replaceRowPurpose`, `parseFileIndex` (each timed) | each returns within 100 ms; no row / file unchanged |
| P2 | bounded-input-parsing — authored batch with a long whitespace run | boundary | L1 | automated | `` \| `a` \| x `` + 100 000 spaces + `y` | `parseAuthoredBatch` | within 100 ms; one entry `a` → `x` + 100 000 spaces + `y` |
| P3 | bounded-input-parsing — unclosed link openers | boundary | L1 | automated | `"[[a".repeat(33000)`, `"](a".repeat(33000)`, `"](a".repeat(33000) + ")"` | `chunkMarkdown` (each timed) | each within 100 ms; `wikilinks` and `mdLinks` empty |
| P4 | bounded-input-parsing — branch name with long dash runs | boundary | L1 | automated | `"a" + "-".repeat(100000) + "a"` | `slugifyBranch` | within 100 ms; equals the oracle (`a-a`) |
| P5 | bounded-input-parsing — source string with a long slash run | boundary | L1 | automated | `"/".repeat(100000) + "x"` vs `git:github.com/o/x` | `sourcesMatch` | within 100 ms; `true` |

### Frontend-quirk

| id | requirement | technique | level | disposition | environment | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------------|---------|---------------------|
| F1 | design D4 — `cssEscape` fallback in quoted attribute selectors | EP (character classes) | L1 | automated | jsdom with `CSS.escape` removed; elements with `data-session-id` = `a"b`, `a\b`, `a]b`, `a\nb`, `a b`, `😀x`, `1abc` | `document.querySelector(`[data-session-id="${cssEscape(id)}"]`)` | each query returns its own element and no other |
| F2 | design D4 — native path delegates | contract | L1 | automated | `CSS.escape` stubbed with a spy returning `"S"` | `cssEscape("x")` | returns `"S"`; spy called once with `"x"` |

### Error-handling

none — every touched function is pure and has no fault seam; malformed inputs
(missing closing pipe, unterminated openers, empty or terminator-bearing
purposes, unbalanced CSS characters) are covered as edge cases E1–E5 and F1.

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | design D4 — generated verbs unchanged | one-time differential | — | manual-only | `packages/bus-client/src/codegen/generate-verbs.ts` before and after deleting the identity `.replace` | run the generator to two temp files and `cmp` them | byte-identical (the committed `generated/verbs.ts` is not the reference — it already drifts) |

---

## Coverage summary

- Requirements covered: 4/4 (bounded-input-parsing, doctor-diagnostic, kb-file-index-migration MODIFIED grounding, plus design D4 clean-ups)
- Scenarios by class: edge 16 · perf 5 · frontend 2 · error 0 · manual 1
- Scenarios by level: L1 23 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

none — all L1 in existing vitest projects. New test files: `packages/kb/src/__tests__/dox-row.test.ts`,
`packages/kb/src/__tests__/chunker-links.test.ts`, `packages/shared/src/__tests__/git-worktree-helpers.test.ts`,
`packages/client/src/lib/__tests__/css-escape.test.ts`, `packages/client/src/lib/__tests__/md-table-cell-gfm.test.ts`,
`packages/electron/src/__tests__/doctor-html-escape.test.ts`,
`packages/electron/src/__tests__/splash-status-script.test.ts`; the rest extend existing files.
