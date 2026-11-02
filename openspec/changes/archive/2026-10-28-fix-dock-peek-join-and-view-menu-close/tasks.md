# Tasks

## 1. View popover stays open

- [x] 1.1 Add tests in `packages/client/src/components/__tests__/ChatViewMenu.footer.test.tsx` (exemplar: its existing "Reset clears the session override" case) asserting `chat-view-popover` stays rendered after Reset (test-plan #T4), after a successful Set as global with no success text (test-plan #T5), and after a failed Set as global with the error shown (test-plan #T6); verify T4/T5 fail first
- [x] 1.2 Remove `setOpen(false)` from `clearOverride` in `packages/client/src/components/chat/ChatViewMenu.tsx`; verify 1.1 passes

## 2. Peek overlay joins the bar as one surface

- [x] 2.1 Add tests in `packages/client/src/components/chat/__tests__/ComposerDock.peek.test.tsx` (exemplar: its F1 dwell case): peek → root has `rounded-t-none`, `border-t-transparent`, no `z-0`; overlay has `rounded-t-xl`, `z-popover`, no `shadow-lg`; bar has no `hover:bg-` (test-plan #T1). Collapsed without peek → root keeps `z-0` and `rounded-t-xl` (test-plan #T2). Pin → root `z-0` + `rounded-t-xl`, region not `absolute` (test-plan #T3); verify T1 fails first
- [x] 2.2 Implement the peek classes in `packages/client/src/components/chat/ComposerDock.tsx` (root, `regionClass`, `SummaryBar` bar hover) per design Decisions 1-2; verify 2.1 passes and the full `ComposerDock.*.test.tsx` suite stays green

## 3. Verify and document

- [x] 3.1 Run `npm test` for the client package and confirm no regressions
- [x] 3.2 Update `ComposerDock.tsx` and `ChatViewMenu.tsx` rows in `packages/client/src/components/chat/AGENTS.md` / `ChatViewMenu.tsx.AGENTS.md` with `See change: fix-dock-peek-join-and-view-menu-close`
- [x] 3.3 Manual: in a live session with a collapsed dock and the scroll-to-bottom button visible, hover the bar: seamless join, overlay above the scroll button, composer card covers the dock foot, lane `⋯` menu above overlay (test-plan: manual-only, #T7)
