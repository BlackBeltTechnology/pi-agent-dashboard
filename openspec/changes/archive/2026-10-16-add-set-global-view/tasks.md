## 1. ChatViewMenu

- [x] 1.1 Failing tests first: `packages/client/src/components/__tests__/ChatViewMenu.footer.test.tsx` (pinned footer, Reset, Set as global success + failure, open-toward-room, no sideways scroll, phone sheet)
- [x] 1.2 `usePopoverFlip` `threshold: Infinity`, `estimatedWidth: 288`; popover `w-72` flex column with `chat-view-list` (`overflow-y-auto overflow-x-hidden`) + `chat-view-footer`
- [x] 1.3 Footer: `N changed` (`countLeaves`), `chat-view-reset` (override `null`), `chat-view-set-global` (PATCH effective prefs → clear override; failure → `chat-view-set-global-error`)
- [x] 1.4 Phone `max-sm` bottom sheet + `chat-view-scrim`; rows `max-sm:min-h-[44px]`; notify select `min-w-0`
- [x] 1.5 Trigger pill → amber dot; i18n `session.setAsGlobal`, `session.setAsGlobalFailed`, `session.viewChangedCount` (hu, zh-CN)
- [x] 1.6 Update `ChatViewMenu.flip.test.tsx` (scroll lives on the list) and `ChatViewMenu.notify-level.test.tsx` (Reset testid; desktop row rhythm)
- [x] 1.7 `ChatViewMenu.tsx.AGENTS.md` row updated
- [x] 1.8 Lazy-load `ChatViewMenu` in `App.tsx` (own chunk) so the entry stays under the `mdi-chunk-size` 580 KiB gzip cap

## 2. Verification

- [x] 2.1 ChatViewMenu suites green (33 tests)
- [x] 2.2 Live check against the running server via worktree Vite (desktop 1400×900, short 1400×560, phone 390×760): opens up, footer visible, no horizontal scroll, sheet on phone, Reset clears the dot
- [x] 2.3 Manual QA: press Set as global on a real session and confirm other sessions pick up the new global view (deferred post-merge)
