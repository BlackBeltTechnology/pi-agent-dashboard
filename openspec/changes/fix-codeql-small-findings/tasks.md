# Tasks

## 1. Linear-time parsing

- [ ] 1.1 Create `packages/kb/src/dox-row.ts` (no imports) exporting `matchRow` and `matchRowLoose` (design D1); use `matchRow` in `dox-triage.ts` (`parseRows`, `replaceRowPurpose`), `dox.ts` (replacing `ROW_PURPOSE`) and `migrate-file-index.ts`, and `matchRowLoose` in `migrate-runner.ts` `parseAuthoredBatch`; remove `ROW_RE` / `ROW_PURPOSE`.
- [ ] 1.2 In `packages/kb/src/chunker.ts`, replace the wikilink and md-link `matchAll` regexes with the forward-pointer scanners of design D1.
- [ ] 1.3 In `packages/shared/src/git-worktree-helpers.ts` (`slugifyBranch`, two-ended `-` trim) and `packages/shared/src/source-matching.ts` (`localPathBasename`, trailing `/` only, then one case-sensitive `.git`), replace the run regexes with index loops (design D1).

## 2. Markdown table escaping

- [ ] 2.1 Create `packages/shared/src/md-table-cell.ts` exporting `escapeMdTableCell` (design D2) and use it for the name and message cells in `packages/shared/src/doctor-core.ts` and `packages/client/src/components/settings/DiagnosticsSection.tsx`.
- [ ] 2.2 Apply the same three-step escape inline to the name and message cells in `packages/electron/src/renderer/doctor.html`.

## 3. Grounding check

- [ ] 3.1 Export `escapeRegExp` from `packages/kb/src/indexer.ts` and build the grounding regex in `packages/kb/src/migrate-runner.ts` with it and identifier-alphabet lookarounds (design D3).

## 4. Clean-ups

- [ ] 4.1 Delete the identity `.replace(/\n/g, "\n")` in `packages/bus-client/src/codegen/generate-verbs.ts`; run the generator before and after the edit and confirm the two outputs are byte-identical (do not commit a regenerated `verbs.ts`).
- [ ] 4.2 Create `packages/client/src/lib/css-escape.ts` exporting `cssEscape` (design D4) and use it in `SessionList.tsx` (replacing `cssEscapeId`) and `OpenSpecBoardView.tsx`.
- [ ] 4.3 In `packages/server/src/git-worktree/git-operations.ts`, parse local and remote branch lines as in design D4 (trim, optional trailing `*`, trim; `/HEAD` skip on the result).
- [ ] 4.4 In `packages/electron/src/main.ts` `updateSplashStatus`, use the exact script shape of design D4 (`el.textContent = ${JSON.stringify(text)};`, no template-literal delimiters around the value).
- [ ] 4.5 Export `YOUTUBE_HOSTS` from `packages/client/src/lib/preview/preview-dispatch.ts` and use it (plus `youtu.be`) in `extractYouTubeId`.

## 5. Docs

- [ ] 5.1 Update the DOX rows (`See change: fix-codeql-small-findings`): `packages/kb/src/AGENTS.md` (`dox-row.ts` new; `dox-triage.ts`, `dox.ts`, `migrate-file-index.ts`, `migrate-runner.ts`, `chunker.ts`, `indexer.ts`); `packages/shared/src/AGENTS.md` (`md-table-cell.ts` new) and the `source-matching.ts`, `git-worktree-helpers.ts`, `doctor-core.ts` sidecars; `packages/server/src/git-worktree/` `git-operations.ts` row/sidecar; `packages/client/src/lib/AGENTS.md` (`css-escape.ts` new); `packages/client/src/lib/preview/AGENTS.md` (`preview-dispatch.ts`); `packages/client/src/components/preview/AGENTS.md` (`YouTubePreview.tsx`); the `SessionList.tsx`, `OpenSpecBoardView.tsx`, `DiagnosticsSection.tsx`, `main.ts`, `doctor.html` and `generate-verbs.ts` rows.

## 6. Validate

- [ ] 6.1 Rebuild `packages/kb` after all kb edits and commit the refreshed `packages/kb/engine-fingerprint.json`; `node scripts/check-kb-dist-fresh.mjs` passes.
- [ ] 6.2 `openspec validate fix-codeql-small-findings --strict` passes.
- [ ] 6.3 `npm test` green.
