## 1. Hook one-shot — tests first (`packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`)

All L1 hook tests extend the existing sibling suite — see `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts` for the `renderHook` + fake-dispatch harness glue. Verify each RED before 2.1.

- [x] 1.1 Test E1 (test-plan #E1) — `focusOnMount: false` · `terminalsReady: true`, terminals `[t1, t2]`, pane mounts · `onCreateTerminal` not called and the one-shot dispatches nothing (active index is whatever auto-surface alone leaves). See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.2 Test E2 (test-plan #E2) — `focusOnMount: true`, `terminalsReady: false`, terminals `[]` · pane mounts · `onCreateTerminal` called 0 times. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.3 Test E3 (test-plan #E3) — continue E2 · rerender with `terminalsReady: true` and terminals `[t1, t2]` · active tab `term:t2`, `onCreateTerminal` still 0 calls. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.4 Test E4 (test-plan #E4) — `focusOnMount: true`, `terminalsReady: true`, `t1(createdAt 1000)` + `t2(createdAt 2000)` · pane mounts · both `term:` tabs open, `term:t2` active, 0 creates. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.5 Test E5 (test-plan #E5) — `focusOnMount: true`, `terminalsReady: true`, terminals `[]` · pane mounts · `onCreateTerminal` called exactly once with the pane cwd. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.6 Test E6 (test-plan #E6) — terminals `[{id:"e1", ephemeral:true}]`, `focusOnMount`+`terminalsReady` true · pane mounts · treated as none: one create, no `term:e1` tab. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.7 Test E7 (test-plan #E7) — `t1`/`t2` with **equal** `createdAt 5000` · pane mounts · active tab `term:t2` via the last-element fallback, 0 creates. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.8 Test F1 (test-plan #F1) — terminals array ordered newest-first (`t2 createdAt 2000` at index 0, `t1 createdAt 1000` at index 1) · reconcile + one-shot dispatch in the same commit · converges to `term:t2` active, i.e. the one-shot beats auto-surface's default-activate of the last id. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.9 Test F2 (test-plan #F2) — one-shot already created `t1` · terminals update to `[{id:"t1", title:"zsh"}]` and the hook re-renders · create count stays 1, `term:t1` stays active. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.10 Test F3 (test-plan #F3) — `focusOnMount`+`terminalsReady` true, terminals `[t1]` · mount then two rerenders with an unchanged id set · `onFocusConsumed` called exactly once. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.11 Test F4 (test-plan #F4) — entry honoured for `/home/u/a` · rerender the **same** hook instance with `cwd: "/home/u/b"`, terminals `[]`, no unmount · `onCreateTerminal` called once with `/home/u/b` (one-shot ref reset on cwd change). See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.12 Test X1 (test-plan #X1) — hook mounted **without** `onCreateTerminal`, `focusOnMount`+`terminalsReady` true, terminals `[]` · mount, then rerender **with** the handler · no throw, flag not burned, handler called exactly once on the later render. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.
- [x] 1.13 Test X2 (test-plan #X2) — `onCreateTerminal` spy whose terminal never appears · mount then 3 rerenders with terminals still `[]` · create count stays 1, no `term:` tab opened. See `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`.

## 2. Hook one-shot — implementation (`packages/client/src/lib/layout/use-terminal-pane-tabs.ts`)

- [x] 2.1 Implement D2: add `focusOnMount?: boolean`, `terminalsReady?: boolean`, `onFocusConsumed?: () => void`; a `focusHandledRef` one-shot effect **declared after** the reconcile effect and depending on `idSig` (not the `terminals` array identity); gate on `focusOnMount && terminalsReady && !focusHandledRef.current`; newest = max `createdAt` with last-element fallback → `openTerminal(newest.id)`, else `createTerminal()`; burn the flag + fire `onFocusConsumed` only when an action actually ran (D2a/D2b/D2c). Reset `focusHandledRef` when `cwd` changes. Verify 1.1–1.13 green and the pre-existing hook tests still green.

## 3. Thread the flags (`SplitWorkspaceContext.tsx`, `FolderEditorView.tsx`, `App.tsx`)

- [x] 3.1 Test E9 (test-plan #E9) — `DirectoryHomeView` for `/home/u/proj` · click `directory-home-open-terminals` then `directory-home-open-editor` · the two callbacks fire with the cwd, and App's handlers navigate to `/folder/<enc>/editor?focus=terminal` and `/folder/<enc>/editor` respectively (assert via a `navigate` spy). See `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`. Verify red first.
- [x] 3.2 Implement D1: `focusTerminal` / `terminalsReady` / `onFocusConsumed` props on `FolderEditorView` and `SplitWorkspaceProvider` (→ the hook's `focusOnMount` / `terminalsReady` / `onFocusConsumed`); in `App.tsx` read `focus === "terminal"` via `useSearchParams`, pass `snapshotGeneration > 0` as `terminalsReady`, and wire both at **both** `FolderEditorView` call sites (`:2417` desktop, `:2515` `renderFolderEditor`); change the `onOpenTerminals` target. Verify 3.1 green.
- [x] 3.3 Implement D3 consumption: on `onFocusConsumed`, strip `focus` from the URL with a **replace** navigation (no history entry). Verify `npm run build` clean.

## 4. Testable tabs (`packages/client/src/components/editor-pane/EditorTabs.tsx`)

- [x] 4.1 Test E8 (test-plan #E8) — `EditorTabs` rendered with `openFiles [term:t1, src/a.ts]`, `activeIndex 0` · render · every tab carries `data-testid="editor-tab"` + `data-tab-path` equal to its path, and only the active tab has `aria-selected="true"`. See `packages/client/src/components/editor-pane/__tests__/TabActions.test.tsx` for the editor-pane render harness. Verify red first.
- [x] 4.2 Implement D4: add `data-testid="editor-tab"` and `data-tab-path={file.path}` to the tab element (additive only, no behaviour change). Verify 4.1 green.

## 5. Browser E2E (`tests/e2e/directory-home.spec.ts`)

Extend the existing spec per the `author-dashboard-e2e-spec` skill; harness port from `.pi-test-harness.json` → `dashboardPort`, never hardcoded. Exemplar for all five: `tests/e2e/directory-home.spec.ts`.

- [x] 5.1 Test F7 (test-plan #F7) — directory home for a pinned cwd with no terminals · click `directory-home-open-terminals` · converges to exactly one `[data-testid="editor-tab"]` whose `data-tab-path` starts `term:`, and it is `aria-selected="true"`. See `tests/e2e/directory-home.spec.ts`.
- [x] 5.2 Test F8 (test-plan #F8) — continue F7, one terminal now exists · navigate back to the directory home and click Terminals again · terminal-tab count still 1 and that `term:` tab is `aria-selected="true"`. See `tests/e2e/directory-home.spec.ts`.
- [x] 5.3 Test F9 (test-plan #F9) — directory home for the same cwd, terminal-tab count `N` recorded · click `directory-home-open-editor` · file editor shown, URL carries no `focus` param, terminal-tab count still `N`. See `tests/e2e/directory-home.spec.ts`.
- [x] 5.4 Test F5 (test-plan #F5) — pinned folder home with no terminals · click Terminals and wait for the active `term:` tab · URL is `/folder/<enc>/editor` with no `focus` param, and browser Back returns to the directory home (replace navigation, no extra history entry). See `tests/e2e/directory-home.spec.ts`.
- [x] 5.5 Test F6 (test-plan #F6) — landed via Terminals, then a file opened from the tree so a file tab is active · open an overlay route and dismiss it, remounting the folder pane on the same URL · the file tab is still `aria-selected="true"` and the `term:` tab count is unchanged. See `tests/e2e/directory-home.spec.ts`.

## 6. Manual verification (deferred post-merge)

- [x] 6.1 M1 (test-plan: manual-only) — cold page load deep-linked to `/folder/<enc>/editor?focus=terminal`: confirm the terminal appears without a perceptible stall from the readiness gate.

## 7. Closeout

- [x] 7.1 `AGENTS.md` rows: `packages/client/src/lib/layout/AGENTS.md` (`use-terminal-pane-tabs.ts` — `focusOnMount`/`terminalsReady`/`onFocusConsumed` one-shot), `packages/client/src/components/folder/FolderEditorView.tsx.AGENTS.md`, `packages/client/src/components/split/SplitWorkspaceContext.tsx.AGENTS.md`, the `EditorTabs.tsx` row in `packages/client/src/components/editor-pane/AGENTS.md`, and the `App.tsx` row. Verify `kb dox lint` clean.
- [x] 7.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean; `review-code` pass; comment on #373 with the change name.
