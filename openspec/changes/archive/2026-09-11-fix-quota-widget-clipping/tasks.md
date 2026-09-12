## 1. Reproduce the defect before fixing it

- [x] 1.1 Capture the failing baseline in a real browser against the running
  dashboard: constrain the chat pane (`[data-testid=split-chat-pane]`) via
  `style.flex = "0 0 190px"` and record, for the bottom row, its height, its
  intrinsic height, and how many pixels of it fall inside the pane.
  **Result:** `quota-widget h=13 visible=6 CLIPPED=7` — defect reproduced.
  Note: the pane has `flex-basis: 0`, so overriding `height` is ignored — the
  `flex` shorthand must be used.
- [x] 1.2 Record the second symptom at the same constraint.
  **Result:** `chatViewH=0` — transcript fully collapsed.

## 2. Bound the composer to a share of the pane

- [x] 2.1 `composer-root` in `CommandInput.tsx` bounded with `max-h-[40%]` +
  `min-h-0`. The textarea's `maxHeight: "120px"` is left in place as an inner
  bound; the pane-relative cap is what now governs.
- [x] 2.2 Added `overflow-y-auto`. Verified with a 40-line draft: composer stops
  growing and scrolls (`composerScrollH=261 > composerH`, `scrollable=true` at
  panes 457/300/190) with the rows below it fully visible.

## 3. Floor the rows that cannot shrink

- [x] 3.1 `shrink-0` added to `composer-context-strip` and `status-bar`.
  **Deviation:** these do not live in `CommandInput.tsx` as this task assumed —
  the strip is in `packages/client/src/App.tsx:2028` and the bar is in
  `packages/client/src/components/shell/StatusBar.tsx:45`.
- [x] 3.2 `ContentInlineFooterSlot` wrapped in a host-owned `shrink-0` div in
  `App.tsx`. `git status --porcelain packages/quota-plugin` reports clean — the
  plugin was not touched.

## 4. Verify the fix against the baseline

- [x] 4.1 Re-measured at `flex: 0 0 190px`: footer row `vis=13/13 CLIPPED=0`
  (baseline `6/13`, `CLIPPED=7`).
  **Deviation:** `/api/quota` began returning `peer-rejected` for anthropic, so the
  real widget self-hides. Verification used a synthetic 13px probe appended to the
  slot wrapper — identical geometry, and it exercises the host wrapper contract
  rather than the plugin, which is where the fix lives.
- [x] 4.2 `ChatView` height is now `44px` at `pane=190` (baseline `0`).
- [x] 4.3 Sweep 220 → 120: `CLIPPED=0` at every step; `chat` stays non-zero
  throughout (`62, 50, 44, 38, 26, 14, 2`), composer tracks 40% (`88 … 48`).
  No height in the swept range resumes clipping.
- [x] 4.4 Mobile stacked `split` — verified at a real mobile viewport
  (`390x844`, `isMobile`, `hasTouch`). `agent-browser viewport` blanks the page
  here, so this used Playwright driving the system Chrome (`channel: "chrome"`;
  the bundled chromium is not downloaded in this environment).
  Sweep 400 → 160 with an empty composer AND a 40-line draft: **`CLIPPED=0` at
  every step**, `chat` never reaches 0 (floors at `16px`), composer tracks the
  40% bound (`127 … 39`).
  Like-for-like A/B at the same viewport, stripping only this change's classes at
  runtime to simulate pre-fix: **unfixed clips the full `13px` at every height
  from 170 down; fixed is clean to `150px`.**
  **Residual limit (accepted, documented):** below `~145px` of chat pane the
  footer starts clipping again (`145:1 140:6 135:11 130:13`) — the floors
  (`chat 16` + strip + bar + bounded composer) simply exceed the pane. A stacked
  mobile split at `844px` tall gives the chat pane `~400px`, so this is far
  outside the reachable range; it is a floor-vs-pane limit, not a regression.

## 5. Regression-proof it

- [x] 5.1 Tests added at the existing host-client seams —
  `components/__tests__/StatusBar.test.tsx` (non-shrinking floor) and
  `components/__tests__/CommandInput-view.test.tsx` (pane-relative bound +
  `min-h-0` + `overflow-y-auto`). **Verified RED first** by stashing only the
  source fix: `2 failed | 32 passed`, both failing on the exact missing classes.
  Green with the fix: `34 passed`.
  Note: jsdom computes no layout, so these assert the declared contract; the
  geometric proof is the task-4 browser measurements.
- [x] 5.2 Full suite: `17 failed | 1582 passed` files, `42 failed | 18352 passed`
  tests. **All 42 failures confirmed pre-existing** — reproduced on a clean tree
  with every change stashed (localStorage under isolated `HOME`, plus unrelated
  server socket/rendezvous/platform-branch suites). Every file this change touches
  is green.
  Post-review re-run of the whole client package, like-for-like against a stashed
  baseline: **baseline `191 failed / 31 files` → with this change `190 failed / 30
  files`** — one fewer failure, zero regressions from the DOM restructure.

## 6. Land it

- [x] 6.1 `npm run build` + `POST /api/restart`; `/api/health` reports
  `mode: production`.
- [x] 6.2 `review-code` pass on the diff. **Found one `issue(blocking)` in my own
  fix and fixed it:** `overflow-y-auto` on `composer-root` turned the element that
  is `relative` — and therefore the containing block for the `/command` and `@file`
  autocomplete dropdowns — into a scrollport. The dropdowns render ABOVE the
  composer, so they were clipped away entirely (measured `dropdownH=269`,
  `visibleInsideComposer=0`, `clippedAbove=272`).
  Fix: `composer-root` keeps the `max-h-[40%]` bound and becomes `flex flex-col`
  with overflow VISIBLE; the scrolling moved to the inner `composer-card`
  (`min-h-0 overflow-y-auto`). Re-verified: dropdown `260/260` visible, root
  overflow `visible`, card `auto`.
  Re-ran the full sweep after the restructure — `CLIPPED=0` at panes 220/190/160/140
  with BOTH an empty and a 40-line draft; card does not scroll at rest
  (`scrollsAtRest=false` at pane 458).
  Non-blocking findings left for the author: the class-string assertions in the new
  tests are brittle to a Tailwind refactor (`suggestion`), and at a comfortable pane
  the composer now tops out at `183px` instead of `262px` — the accepted tradeoff of
  a pane-relative bound (`suggestion`, raised with the user before implementing).
