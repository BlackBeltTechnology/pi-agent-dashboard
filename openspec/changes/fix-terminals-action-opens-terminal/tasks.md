## 1. Hook one-shot (`packages/client/src/lib/layout/use-terminal-pane-tabs.ts`)

- [ ] 1.1 Test `focusOnMount` — extend `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`: (a) terminals `t1` (older), `t2` (newer) at cwd + `focusOnMount: true` → after reconcile the active tab is `term:t2`, `onCreateTerminal` not called; (b) no terminals + `focusOnMount: true` → `onCreateTerminal(cwd)` called exactly once; re-render with the new terminal in `terminals` → still one call, `term:<new>` active; (c) `focusOnMount` absent → no activation, no creation (existing behaviour). Verify red first.
- [ ] 1.2 Implement D2: `focusOnMount?: boolean` + `useRef` one-shot effect after the reconcile effect; newest = max `createdAt`, fallback last. Verify 1.1 green and the rest of the hook's tests green.

## 2. Thread the flag (`SplitWorkspaceContext.tsx`, `FolderEditorView.tsx`, `App.tsx`)

- [ ] 2.1 Test `DirectoryHomeView` wiring — `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`: clicking `directory-home-open-terminals` calls `onOpenTerminals(cwd)`; in `App`-level routing test (or a small `navigate` spy), `onOpenTerminals` navigates to `/folder/<enc>/editor?focus=terminal` and `onOpenEditor` to `/folder/<enc>/editor`. Verify red first.
- [ ] 2.2 Implement D1/D3: `focusTerminal` prop on `FolderEditorView` and `SplitWorkspaceProvider` (→ `focusOnMount`); `App.tsx` reads `focus === "terminal"` via `useSearchParams` for the editor route at BOTH `FolderEditorView` call sites (lines ~2388 and ~2486) and changes the `onOpenTerminals` target. Verify 2.1 green; `npm run build` clean.

## 3. Browser E2E (`tests/e2e/directory-home.spec.ts`)

- [ ] 3.1 Extend the existing `directory-home.spec.ts` per the `author-dashboard-e2e-spec` skill: pin a folder, open its home page, click Terminals → an active `term:` tab exists and `GET /api/terminals` (or the equivalent list) shows one terminal at the cwd; navigate back, click Editor → the file editor is shown and the terminal count is unchanged; click Terminals again → the existing terminal's tab is active, count still 1. Reap via the standard fixture. Verify green with `PW_E2E_USE_RUNNING=1` against a local harness.

## 4. Closeout

- [ ] 4.1 `AGENTS.md` rows: `packages/client/src/lib/layout/AGENTS.md` (`use-terminal-pane-tabs.ts` `focusOnMount`), `packages/client/src/components/folder/FolderEditorView.tsx.AGENTS.md`, `packages/client/src/components/split/SplitWorkspaceContext.tsx.AGENTS.md`, `packages/client/src/App.tsx` row. Verify `kb dox lint` clean.
- [ ] 4.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean; comment on #373 with the change name.
