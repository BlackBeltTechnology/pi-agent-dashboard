# Tasks

Interactive mockup of the target behavior: `mockups/index.html`
(open in a browser, click **⌖ Seek to card**).

## 1. Reveal-request plumbing (App ↔ SessionList)

- [x] 1.1 In `App.tsx`, add `revealRequest: { sessionId: string; nonce: number }
      | null` state and a `seekToCard(sessionId)` callback that sets it with a
      monotonically-bumped `nonce`. → verify: bumping nonce for the same id
      produces a new object identity.
- [x] 1.2 Thread `seekToCard` into `SessionHeader` (App renders it above the
      ChatView body; see `App.tsx` SessionHeader call site) and `revealRequest`
      into `SessionList`. → verify: `tsc --noEmit` clean; no unused-prop lint.

## 2. Seek control in the session header (SessionHeader, NOT ChatView)

- [x] 2.1 Add a "Seek to card" button to `SessionHeader` next to the session
      title (data-testid `session-header-seek-card`), calling
      `seekToCard(session.id)`. Note: ChatView has no header; the title bar is
      `SessionHeader`, rendered by App. Match the mockup affordance (accent-blue
      outline). Gate on `!useMobile()` (desktop-only for v1). → verify: button
      renders for an open session on desktop; not rendered when `useMobile()` is
      true; click invokes the callback with the session id.

## 3. Ancestor resolution + reveal in SessionList

- [x] 3.1 Add `resolveFoldAncestors(session)` returning `{ workspaceId?, cwd,
      isEnded }` from `folderWorkspaceMap.get(session.cwd)`, `session.cwd`, and
      `session.status === "ended"`. → verify: unit test covers non-ended (no
      ended ancestor) and workspace-less folder (no workspaceId).
- [x] 3.2 Add `revealCard(session)` that GUARD-expands ancestors — only when the
      container is currently collapsed, since the folder mutator is a toggle and
      the ended mutator must be add-only: `onSetWorkspaceCollapsed(wsId, false)`
      only if that ws is collapsed; `handleToggleCollapse(cwd)` only if
      `collapsedGroups.has(cwd)`; add `cwd` to the ended-expanded set via the
      add-only setter (never `toggleEndedExpanded`) — then `onSelect(session.id)`,
      then the reveal wait (3.3). → verify: after reveal all three report
      expanded; a second reveal on an already-open card leaves them expanded (no
      re-collapse).
- [x] 3.3 Implement the reveal wait (copy scroll glue from the first-mount effect
      at `SessionList.tsx` ~264 and `FolderNeedsYouPill` onActivate ~733):
      presence = `listRef.current?.querySelector('[data-session-id=...]')` (scoped,
      NOT `document`) with `getBoundingClientRect().height > 0` (NOT
      `offsetParent`, which stays non-null on a `grid-rows:0fr` collapsed row);
      scroll `behavior:"smooth", block:"center"` + flash (reuse `card-ring-fx` /
      selected ring). Completion is driven by the `workspaces` prop update (echo)
      — re-run the presence check on that change; a FIXED 5s backstop timer only
      catches a never-arriving echo (it must not gate the happy path). Cancel any
      pending rAF/timer on unmount or a superseding nonce; on backstop elapse show
      the Retry toast (Task 5). → verify: scroll deferred while the card is
      0-height/absent, fires once laid out on the echo; no callback fires after
      unmount; the 5s timer only fires when the echo never lands.
- [x] 3.4 Wire a `useEffect` keyed on `revealRequest?.nonce` that looks up the
      session by `revealRequest.sessionId` and calls the degrade check (Task 4)
      then `revealCard`. → verify: two seeks of the same id fire two reveals.

## 4. Hidden / filtered degrade path

- [x] 4.1 Before reveal, classify the target up front from the `sessions` prop +
      filter predicates: hidden (`session.hidden && !showHidden`) or filtered-out
      (excluded by any active filter — tag/phase via `passesTagAxes`, text
      search, OR the folder-path `workspaceFilter`). If either, skip reveal and
      show an **informational** toast (hidden → tell user to enable Show hidden;
      filtered → a filter is hiding the card); the shared `Toast` is display-only,
      so no action button. Do NOT flip `showHidden` or clear filters. → verify:
      `showHidden` and filter state unchanged after seeking a hidden/filtered
      session.

## 5. Toast retry action (shared component extension)

- [x] 5.1 Extend the shared `Toast` (`packages/client/src/components/Toast.tsx`
      — `ToastMessage`/`ToastVariant`) with an OPTIONAL action `{ label, onClick }`
      (renders a button when present) AND an optional no-auto-dismiss flag
      (default keeps the current ~3s auto-dismiss). Existing call sites
      unaffected. → verify: existing Toast tests green; informational toasts
      render no button and still auto-dismiss.
- [x] 5.2 Thread a retry dispatcher into `SessionList` (the reveal effect +
      `useToast` live there; `seekToCard` lives in App) and wire the
      reveal-timeout toast to pass a `Retry` action (with no-auto-dismiss) that
      re-fires `seekToCard(session.id)`. Hidden/filtered toasts pass no action.
      → verify: Retry re-dispatches a reveal for the same session; the toast
      persists until acted on.

## Tests

All L1 vitest. Harness exemplar: copy render/mock glue from a sibling
`SessionList.*.test.tsx` / `SessionCard.test.tsx` / `Toast` test under
`packages/client/src/components/__tests__/`. Each row is `(test-plan: automated)`.

- [x] T.1 Buried-reveal test (test-plan #F1): session under collapsed workspace +
      folder + ended group · dispatch reveal · assert all three expand, card gains
      selected class, `scrollIntoView` called once. → verify: red before wiring,
      green after.
- [x] T.2 Nonce re-fire test (test-plan #F2, #F4): dispatch two reveals same id
      bumped nonce → effect runs twice; and the timeout-toast Retry action →
      dispatches a fresh reveal for the same session. → verify: nonce, not id,
      drives re-fire.
- [x] T.3 Laid-out-wait + predicate test (test-plan #F3, #X1): card 0-height on
      first check, laid out after a `workspaces` prop update · assert
      `scrollIntoView` fires ONLY once `getBoundingClientRect().height > 0`; and a
      card in a `grid-rows:0fr` collapsed row (offsetParent non-null, height 0)
      does NOT trigger scroll. → verify: single-rAF/`offsetParent` would
      false-positive; height + echo-driven wait passes.
- [x] T.4 Degrade test (test-plan #X3, #X4, #X5): seek a hidden session
      (showHidden off), a tag-filtered session, and a folder-path-filtered
      session · assert no expansion, no `showHidden` flip, no filter clear, and an
      informational toast with NO action button. → verify: matches the degrade
      scenarios.
- [x] T.5 Ancestor-resolution + idempotence test (test-plan #E2, #E3, #E4):
      non-ended session → ended set untouched; cwd in no workspace → undefined
      workspaceId, no `onSetWorkspaceCollapsed`; all-ancestors-already-expanded →
      no container re-collapses. → verify: guards prevent toggle re-collapse
      (FolderNeedsYouPill-parity bug).
- [x] T.6 Backstop + Retry-toast + no-leak test (test-plan #E5, #X2): echo never
      lands · assert no toast before the 5s backstop and a Retry toast (that does
      NOT auto-dismiss) after it; echo lands before 5s → reveal completes, NO
      toast, backstop cancelled; on unmount no frame/timer callback fires.
      → verify: the timer only fires on a never-arriving echo; Retry re-dispatches.
- [x] T.7 Desktop-only gate test (test-plan #E1): render `SessionHeader` with
      `useMobile()` → true · assert no `session-header-seek-card` element.
      → verify: matches the mobile-layout scenario.
- [x] T.8 Manual (test-plan: manual-only, #F5): open a buried session in ChatView,
      click Seek, judge that the scroll is smooth and the flash is perceptible.
      Subjective — no automatable observable; deferred to post-merge.

Harness exemplars: L1 vitest — copy from a sibling `SessionList.*.test.tsx` /
`SessionCard.test.tsx` under `packages/client/src/components/__tests__/`.
Each test is `(test-plan: automated)`.

## Validate

- [x] V.1 `npm run quality:changed` green (biome + tsc + tests).
- [x] V.2 Manual: open a buried session in ChatView, click Seek, confirm the
      three containers expand and the card scrolls to center + flashes; repeat to
      confirm re-fire; seek a hidden session and confirm the toast (no global
      un-hide).
