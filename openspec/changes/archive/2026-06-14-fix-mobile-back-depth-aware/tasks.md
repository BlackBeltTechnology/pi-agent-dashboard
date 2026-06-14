## 1. Pure parent-route resolver (`computeBackTarget`)

- [x] 1.1 Write `packages/client/src/lib/__tests__/back-target.test.ts` first: depth1 routes (`/session/:id`, `/folder/:cwd/terminals`, `/folder/:cwd/editor`, `/settings`, `/tunnel-setup`) → `/`; `/session/:id/diff` → `/session/:id`; ambiguous overlays (`/folder/:cwd/openspec/:c/:a`, `/folder/:cwd/openspec/archive`, `/folder/:cwd/openspec/specs`, `/folder/:cwd/readme`, `/folder/:cwd/pi-resources`, `/pi-resource?path=`) → `/`; `/` → `null`. Verify tests fail.
- [x] 1.2 Add `packages/client/src/lib/back-target.ts` exporting pure `computeBackTarget(route: string): string | null`. Reuse `getMobileDepth`/route parsing; strip `/diff` for the one URL-computable overlay parent. Make 1.1 pass.

## 2. In-app depth-tagged nav tracker (D2)

- [x] 2.1 Write tests for the tracker: append tags each entry `{url, depth}` via `getMobileDepth`; consecutive identical-url appends dedupe (StrictMode guard); `replace`-style nav overwrites stack top instead of appending; `popstate` pops/realigns; expose `predecessor()` returning `stack[len-2]` or undefined. Verify they fail.
- [x] 2.2 Implement the tracker (module or `useNavTracker` hook) in `packages/client/src/lib/` (or `hooks/`). Wire a single `window.addEventListener("popstate", …)` for realignment; provide `recordNavigation(url, {replace})` + `predecessor()`. Make 2.1 pass.
- [x] 2.3 Feed the tracker from the app's single navigation path: wrap/observe wouter `navigate` in `App.tsx` so every `navigate(url)` and `navigate(url,{replace:true})` (incl. the `App.tsx:652` redirect) records into the tracker. No new call sites added — instrument the existing `navigate`.

## 3. Depth-aware `goBack` (D1 + D4)

- [x] 3.1 Write tests for the hybrid decision in `packages/client/src/lib/__tests__/history-back.test.ts`: when `predecessor().depth < currentDepth` → calls `window.history.back()` + pops tracker; else → `navigate(computeBackTarget(route))`; cold load (no predecessor) → `navigate(computeBackTarget(route))`; depth 0 → no-op. Verify they fail.
- [x] 3.2 Replace `goBackOrHome` in `packages/client/src/lib/history-back.ts` with depth-aware `goBack(navigate, currentRoute, tracker)` implementing 3.1. Keep the cold-load fallback semantics inside the depth-navigate branch. Make 3.1 pass.
- [x] 3.3 Update `App.tsx` `goBack` definition (`:991`) to call the new helper with current route + tracker; leave all `onBack={goBack}` call sites (`:1173`, `:1651`, overlay headers) untouched. Remove the now-unused `goBackOrHome` import if fully replaced.

## 4. Regression coverage for the reported bug

- [x] 4.1 Add a test asserting the specs scenario "Back from chat returns to cards regardless of prior chats": history `/` → `/session/A` → `/session/B`, mobile depth 1, back → `/` (not `/session/A`).
- [x] 4.2 Add a test for "Back from a depth-2 overlay returns one depth up, not to a sibling overlay": chained `…/openspec/:c/proposal` → `…/openspec/archive`, back → one depth up (session via tracker, else `/`), never the sibling overlay.
- [x] 4.3 Add a test for the `history.back()` fast-path: `/settings` → openspec overlay, back uses `window.history.back()` returning to `/settings`.

## 5. Verify

- [x] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — all green.
- [x] 5.2 `npm run reload:check` (type-check) passes.
- [x] 5.3 Manual mobile QA: shrink desktop window to mobile width with a session open → back/swipe reaches the session-card list; verify back never lands on a sibling chat and never leaves the app. Verify desktop overlay back-arrows still close to the prior view.
- [x] 5.4 Update `docs/file-index-client.md` rows for `history-back.ts` (+ new `back-target.ts` and the nav tracker) per the Documentation Update Protocol (delegate the `docs/` write to a subagent, caveman style).
