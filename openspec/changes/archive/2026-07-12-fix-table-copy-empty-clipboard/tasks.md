# Tasks

## 1. Reproduce (failing test first)
- [x] 1.1 Add a click-level test in `MarkdownContent.test.tsx`: render a table
  via `MarkdownContent` (memoized, single render), click "Copy as Markdown",
  assert `navigator.clipboard.writeText` received the real markdown table
  string (not `""`). Repeat for "Copy as TSV". → verify: test FAILS on current
  code (copies `""`).

## 2. Change the CopyButton contract
- [x] 2.1 `packages/client/src/components/CopyButton.tsx`: replace prop
  `text: string` with `getText: () => string`; call `getText()` inside
  `handleClick`; update `useCallback` deps to `[getText]`. → verify: `tsc`
  errors point at every stale call site.

## 3. Migrate call sites (`text=` → `getText=`)
- [x] 3.1 `MarkdownContent.tsx` TableWrapper: `getText={copyMarkdown}` /
  `getText={copyTsv}` (pass the memoized callbacks directly).
- [x] 3.2 `MarkdownContent.tsx` CodeBlockWrapper: `getText={() => codeString}`.
- [x] 3.3 `ChatView.tsx` MessageBubble: `getText={() => content}` and
  `getText={getPlainText}` (fixes the plain-text→markdown degradation too).
- [x] 3.4 `SkillInvocationCard.tsx` (4 sites) and `SessionBanner.tsx`: wrap each
  `text={X}` as `getText={() => X}`.
- [x] 3.5 Grep to confirm zero remaining `<CopyButton ... text=` usages.
  → verify: `grep -rn "CopyButton" packages/**/src | grep "text="` empty;
  `tsc --noEmit` clean.

## 4. Verify
- [x] 4.1 New click-level tests pass (table md + TSV copy real content).
- [x] 4.2 `npm test 2>&1 | tee /tmp/pi-test.log` green (existing
  content-copy / MarkdownContent / ChatView suites).
- [x] 4.3 `npm run quality:changed` clean.

## 5. QA (automated via Playwright e2e)
- [x] 5.1 Automated as `tests/e2e/table-copy.spec.ts` (faux scenario
  `copy-surfaces`): renders an assistant message with a markdown table + fenced
  code block on a single memoized render, grants clipboard permission, and reads
  the REAL clipboard after clicking each button — table "Copy as Markdown" /
  "Copy as TSV", code-block "Copy code", and message "Copy as plain text" —
  asserting each lands non-empty real content. Passes against system Chrome
  (`PW_CHANNEL=chrome`). Waits for the code-block copy button (streams last) to
  avoid a partial-table mid-stream read. → verify: `PW_CHANNEL=chrome
  PW_E2E_USE_RUNNING=1 PW_E2E_PORT=18000 PW_GATEWAY_PORT=19000 npm run test:e2e
  -- table-copy.spec.ts` green.
