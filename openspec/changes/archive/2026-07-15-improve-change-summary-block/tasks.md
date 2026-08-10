# Tasks

## 1. Mime icons on file rows (option A)
- [x] 1.1 Add `.css` / `.scss` / `.less` → `mdiLanguageCss3` entries to `ICON_BY_EXT` in `packages/client/src/lib/file-icon.ts` → verify: `file-icon.test.ts` asserts each maps to the CSS glyph
- [x] 1.2 In `ChangeSummaryBlock.tsx`, replace the `+ / ●` status-glyph `<span>` with an `<Icon path={fileIcon(file.path).iconPath} size={0.55} className={fileIcon(file.path).colorClass}>` leading each row → verify: component test asserts a mime icon (not `+`/`●`) renders per row and reflects extension
- [x] 1.3 Drop the now-unused `file.status`-based glyph branch and any orphaned imports → verify: `tsc --noEmit` clean, no unused-var lint

## 2. Auto-fold on file-count threshold
- [x] 2.1 Add `const THRESHOLD = 8;` and derive expanded state: `userChoice ?? fileCount < THRESHOLD`, with `userChoice: boolean | null` state and a sticky `toggle` → verify: unit test — 7 files expanded, 8 files collapsed on mount
- [x] 2.2 Header click sets `userChoice = !expanded` (sticky) → verify: test — expand a ≥ 8 block, grow file count, assert still expanded
- [x] 2.3 Auto-fold only collapses (never auto-expands a user-collapsed block) → verify: test — collapse a < 8 block manually, assert stays collapsed

## 3. Tests
- [x] 3.1 `ChangeSummaryBlock.test.tsx`: mime icon per row; < 8 expanded; ≥ 8 collapsed; 7→8 streaming auto-collapse; sticky expand at ≥ 8; sticky collapse at < 8 → verify: `npm test` green for the file
- [x] 3.2 `file-icon.test.ts`: `.css`/`.scss`/`.less` glyph mapping → verify: `npm test` green

## 4. Validate & land
- [x] 4.1 `npx openspec validate improve-change-summary-block --strict` passes
- [x] 4.2 `npm run quality:changed` green (Biome + tsc + tests on the diff)
- [x] 4.3 Client change → `npm run build` + restart per the implement rebuild matrix; visual check in both themes that rows show mime icons and a ≥ 8-file turn mounts collapsed (manual visual QA — deferred to post-merge; `npm run build` verified green)
