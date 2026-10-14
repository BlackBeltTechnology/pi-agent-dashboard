# Tasks

## 1. Linear-time parsing

- [x] 1.1 Create `packages/kb/src/dox-row.ts` (no imports) exporting `matchRow` and `matchRowLoose` (design D1); use `matchRow` in `dox-triage.ts` (`parseRows`, `replaceRowPurpose`), `dox.ts` (replacing `ROW_PURPOSE`) and `migrate-file-index.ts`, and `matchRowLoose` in `migrate-runner.ts` `parseAuthoredBatch`; remove `ROW_RE` / `ROW_PURPOSE`.
- [x] 1.2 In `packages/kb/src/chunker.ts`, replace the wikilink and md-link `matchAll` regexes with the forward-pointer scanners of design D1.
- [x] 1.3 In `packages/shared/src/git-worktree-helpers.ts` (`slugifyBranch`, two-ended `-` trim) and `packages/shared/src/source-matching.ts` (`localPathBasename`, trailing `/` only, then one case-sensitive `.git`), replace the run regexes with index loops (design D1).

## 2. Markdown table escaping

- [x] 2.1 Create `packages/shared/src/md-table-cell.ts` exporting `escapeMdTableCell` (design D2) and use it for the name and message cells in `packages/shared/src/doctor-core.ts` and `packages/client/src/components/settings/DiagnosticsSection.tsx`.
- [x] 2.2 Apply the same three-step escape inline to the name and message cells in `packages/electron/src/renderer/doctor.html`.

## 3. Grounding check

- [x] 3.1 In `packages/kb/src/migrate-runner.ts`, build the grounding regex with a local full metacharacter escape and ASCII identifier-alphabet lookarounds instead of `\b` (design D3).

## 4. Clean-ups

- [x] 4.1 Delete the identity `.replace(/\n/g, "\n")` in `packages/bus-client/src/codegen/generate-verbs.ts`; run the generator before and after the edit and confirm the two outputs are byte-identical (do not commit a regenerated `verbs.ts`).
- [x] 4.2 Create `packages/client/src/lib/css-escape.ts` exporting `cssEscape` (design D4) and use it in `SessionList.tsx` (replacing `cssEscapeId`) and `OpenSpecBoardView.tsx`.
- [x] 4.3 In `packages/server/src/git-worktree/git-operations.ts`, parse local and remote branch lines as in design D4 (trim, optional trailing `*`, trim; keep `if (!name) continue`; `/HEAD` skip on the result).
- [x] 4.4 In `packages/electron/src/main.ts` `updateSplashStatus`, use the exact script shape of design D4 (`el.textContent = ${JSON.stringify(text)};`, no template-literal delimiters around the value).
- [x] 4.5 Export `YOUTUBE_HOSTS` from `packages/client/src/lib/preview/preview-dispatch.ts` and use it as the exact host set in `extractYouTubeId`.

## 5. Docs

- [x] 5.1 Update the DOX rows (`See change: fix-codeql-small-findings`): `packages/kb/src/AGENTS.md` (`dox-row.ts` new; `dox-triage.ts`, `dox.ts`, `migrate-file-index.ts`, `migrate-runner.ts`, `chunker.ts`); `packages/shared/src/AGENTS.md` (`md-table-cell.ts` new) and the `source-matching.ts`, `git-worktree-helpers.ts`, `doctor-core.ts` sidecars; `packages/server/src/git-worktree/` `git-operations.ts` row/sidecar; `packages/client/src/lib/AGENTS.md` (`css-escape.ts` new); `packages/client/src/lib/preview/AGENTS.md` (`preview-dispatch.ts`); `packages/client/src/components/preview/AGENTS.md` (`YouTubePreview.tsx`); the `SessionList.tsx`, `OpenSpecBoardView.tsx`, `DiagnosticsSection.tsx`, `main.ts`, `doctor.html` and `generate-verbs.ts` rows.

## 6. Tests

- [x] 6.1 L1 test in `packages/kb/src/__tests__/dox-row.test.ts` (new; exemplar `dox-triage.test.ts`): input every git-tracked `AGENTS.md` plus test-plan fixture R · trigger `parseRows`, `replaceRowPurpose(md, path, "NEW")`, `parseFileIndex`, `parseAuthoredBatch` · observable deep-equal to the embedded old-regex oracle, including no row where the oracle has none (test-plan #E1)
- [x] 6.2 L1 test in `packages/kb/src/__tests__/dox-row.test.ts` (new; exemplar `dox-triage.test.ts`): input 50 000 seeded random lines over the fixture-R alphabet (70 % with the row head) · trigger `matchRow` vs old strict regex, `matchRowLoose` vs old loose line logic · observable 0 differences (test-plan #E2)
- [x] 6.3 L1 test in `packages/kb/src/__tests__/chunker-links.test.ts` (new; exemplar `kb.test.ts` `chunkMarkdown` cases): input the test-plan E3 text · trigger `chunkMarkdown` · observable `wikilinks` `["target","spaced","","[a"]`, `mdLinks` `["docs/a.md","b.mdx"]` (test-plan #E3)
- [x] 6.4 L1 test in `packages/kb/src/__tests__/chunker-links.test.ts` (new; exemplar `kb.test.ts` `chunkMarkdown` cases): input 50 000 seeded random strings over `[ ] ( ) . m d x a space` · trigger `chunkMarkdown` vs old `matchAll` oracle · observable equal `wikilinks` and `mdLinks` for every string (test-plan #E4)
- [x] 6.5 L1 test in `packages/shared/src/__tests__/git-worktree-helpers.test.ts` (new; exemplar `source-matching.test.ts`): input `-feat`, `--x--`, `/foo`, `a/b`, empty, a 70-char name, plus 20 000 seeded strings over `- / \ : space A a 9 . _ é` · trigger `slugifyBranch` vs old regex-chain oracle · observable `feat`, `x`, `foo` for the first three; all equal the oracle (test-plan #E5)
- [x] 6.6 L1 test in `packages/shared/src/__tests__/source-matching.test.ts` (extend): input `("/p/foo.git/","git:github.com/o/foo")`, `("/p/pkg\\","git:github.com/o/pkg")`, `("/p/foo.GIT","git:github.com/o/foo")` · trigger `sourcesMatch` · observable `true`, `false`, `false` (test-plan #E6)
- [x] 6.7 L1 test in `packages/shared/src/__tests__/doctor-format.test.ts` (extend): input report with the five fixture-D checks · trigger the shared doctor Markdown formatter · observable each row contains exactly the fixture-D emitted name/message cells; every table row is one line (test-plan #E7)
- [x] 6.8 L1 test in `packages/client/src/lib/__tests__/md-table-cell-gfm.test.ts` (new; exemplar `preview-dispatch.test.ts`): input fixture-D table built with `escapeMdTableCell`, and with the pre-fix escape as oracle · trigger parse with `unified`+`remark-parse`+`remark-gfm` · observable post-fix one row per check, 4 cells each; pre-fix at least one row ≠ 4 cells (test-plan #E8)
- [x] 6.9 L1 test in `packages/client/src/__tests__/DiagnosticsSection.test.tsx` (extend; reuse its clipboard mock): input report with the fixture-D checks · trigger click Copy as Markdown · observable copied text holds the fixture-D cells; remark-gfm parse gives 4 cells per check row and one row for the lone-CR message (test-plan #E9)
- [x] 6.10 L1 test in `packages/client/src/lib/__tests__/md-table-cell-gfm.test.ts` (new; exemplar `preview-dispatch.test.ts`): input the fixture-D helper cases · trigger `escapeMdTableCell` · observable each equals the fixture-D expected value (`\r\n` → one space) (test-plan #E10)
- [x] 6.11 L1 test in `packages/electron/src/__tests__/doctor-html-escape.test.ts` (new; exemplar `no-data-text-html-mainwindow.test.ts`, which reads source): input `packages/electron/src/renderer/doctor.html` source · trigger read file · observable name and message cell expressions apply backslash, then pipe, then `/\r\n?|\n/g` in order; the old `/\r?\n/` replace is gone from those cells (test-plan #E11)
- [x] 6.12 L1 test in `packages/kb/src/__tests__/migrate-runner.test.ts` (extend): input purpose `` uses `$StoreKey` ``, source `const $StoreKey = 1` · trigger grounding check · observable no ungrounded identifiers (test-plan #E12)
- [x] 6.13 L1 test in `packages/kb/src/__tests__/migrate-runner.test.ts` (extend): input purpose `` uses `FooBar` ``, source `const $FooBar = 1; FooBar$x();` · trigger grounding check · observable `FooBar` reported ungrounded (test-plan #E13)
- [x] 6.14 L1 test in `packages/server/src/__tests__/git-operations.test.ts` (extend its `listBranches` block): input temp repo with `main` (current), `feature/x`, bare remote `origin` with `origin/HEAD` and `origin/only-remote` · trigger `listBranches` · observable local names exactly `main`, `feature/x`; only `main` current; remote has `origin/only-remote` and nothing ending `/HEAD` (test-plan #E14)
- [x] 6.15 L1 test in `packages/client/src/lib/__tests__/preview-dispatch.test.ts` (extend): input URLs on the four `YOUTUBE_HOSTS` (watch/shorts/embed/short-link) and `music.youtube.com`, `evilyoutube.com`, `youtube.com.evil.example` · trigger `extractYouTubeId` and `dispatchPreview` · observable canonical hosts yield the id; the other three yield `null` and are not routed to the YouTube renderer (test-plan #E15)
- [x] 6.16 L1 test in `packages/electron/src/__tests__/splash-status-script.test.ts` (new; exemplar `no-data-text-html-mainwindow.test.ts`): input `packages/electron/src/main.ts` source · trigger read file · observable `updateSplashStatus` builds `el.textContent = ${JSON.stringify(text)};` with no backtick/`$` escaping and no template-literal delimiters around the value (test-plan #E16)
- [x] 6.17 L1 test in `packages/kb/src/__tests__/dox-row.test.ts` (new; exemplar `dox-triage.test.ts`): input `` | `a` | `` + 100 000 spaces + `x` · trigger `parseRows`, `replaceRowPurpose`, `parseFileIndex`, each timed · observable each < 100 ms; no row / file unchanged (test-plan #P1)
- [x] 6.18 L1 test in `packages/kb/src/__tests__/dox-row.test.ts` (new; exemplar `dox-triage.test.ts`): input `` | `a` | x `` + 100 000 spaces + `y` · trigger `parseAuthoredBatch` timed · observable < 100 ms; one entry `a` → `x` + 100 000 spaces + `y` (test-plan #P2)
- [x] 6.19 L1 test in `packages/kb/src/__tests__/chunker-links.test.ts` (new; exemplar `kb.test.ts` `chunkMarkdown` cases): input `"[[a".repeat(33000)`, `"](a".repeat(33000)`, same + `")"` · trigger `chunkMarkdown`, each timed · observable each < 100 ms; no links (test-plan #P3)
- [x] 6.20 L1 test in `packages/shared/src/__tests__/git-worktree-helpers.test.ts` (new; exemplar `source-matching.test.ts`): input `"a" + "-".repeat(100000) + "a"` · trigger `slugifyBranch` timed · observable < 100 ms; `a-a` (test-plan #P4)
- [x] 6.21 L1 test in `packages/shared/src/__tests__/source-matching.test.ts` (extend): input `"/".repeat(100000) + "x"` vs `git:github.com/o/x` · trigger `sourcesMatch` timed · observable < 100 ms; `true` (test-plan #P5)
- [x] 6.22 L1 test in `packages/client/src/lib/__tests__/css-escape.test.ts` (new; exemplar `preview-dispatch.test.ts`): input jsdom without `CSS.escape`; elements with `data-session-id` `a"b`, `a\b`, `a]b`, `a\nb`, `a b`, `😀x`, `1abc` · trigger `querySelector(`[data-session-id="${cssEscape(id)}"]`)` · observable each finds exactly its own element (test-plan #F1)
- [x] 6.23 L1 test in `packages/client/src/lib/__tests__/css-escape.test.ts` (new; exemplar `preview-dispatch.test.ts`): input `CSS.escape` stubbed with a spy returning `"S"` · trigger `cssEscape("x")` · observable returns `"S"`; spy called once with `"x"` (test-plan #F2)
- [x] 6.24 Manual check (test-plan: manual-only, #M1): run the verbs generator before and after task 4.1 to two temp files and `cmp` them; byte-identical.

## 7. Validate

- [x] 7.1 Rebuild `packages/kb` after all kb edits and commit the refreshed `packages/kb/engine-fingerprint.json`; `node scripts/check-kb-dist-fresh.mjs` passes.
- [x] 7.2 `openspec validate fix-codeql-small-findings --strict` passes.
- [x] 7.3 `npm test` green.
