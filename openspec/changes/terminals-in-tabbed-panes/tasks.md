# Tasks — terminals-in-tabbed-panes

> Depends on `remove-external-editor-integration` (folder-scoped pane at `/folder/:cwd/editor`). Land that first. Section 3 (folder surface + button retarget) needs it; sections 1–2 (session-split terminal tab) stand alone.

## 1. Shared: terminal viewer kind

- [ ] 1.1 Add `"terminal"` to the `ViewerKind` union in `packages/shared/src/file-kind.ts` → verify: type-check
- [ ] 1.2 Add `"terminal"` to the pane-state validator viewer allowlist (`VALID_VIEWERS` in `editor-pane-state.ts`) so `term:` tabs are not discarded as corrupt → verify: unit test loads a `term:` tab without discard

## 2. Client: terminal tab mechanism (session split)

- [ ] 2.1 Add `terminal` entry to `viewer-registry`: a component that parses `<id>` from `term:<id>` and renders `<TerminalView terminalId={id} visible … />` filling the tab body (no `heightPx`) → verify: renders attached terminal
- [ ] 2.2 Extend the pane context (`SplitWorkspaceContext` terminal slice or sibling `TerminalPaneContext`) exposing, for the pane cwd: `terminals: TerminalSession[]`, `createTerminal()`, `killTerminal(id)`, `renameTerminal(id,title)`, `onTitle(id,title)`; thread `App`'s existing terminal state/handlers into the provider scoped to the pane cwd → verify: context provides cwd-scoped terminals
- [ ] 2.3 Add `openTerminal(id)` helper (dispatch `openFile` with `term:<id>` / `terminal`) and wire close → `killTerminal`, rename → `renameTerminal`, keep-alive (single mounted `TerminalView` per id) → verify: open/close/rename unit tests
- [ ] 2.4 Add a "+ Terminal" affordance to the pane header/tab strip → `createTerminal()` + open its tab active → verify: creates + opens tab
- [ ] 2.5 Session split: terminal tabs open only on user action (no auto-surface) → verify: split with an existing cwd terminal shows no tab until opened

## 3. Client: folder pane surface + sidebar retarget (needs Change 1)

- [ ] 3.1 Folder-scoped pane: auto-open a `term:<id>` tab for every non-ephemeral terminal at the folder cwd on mount + when the terminal set changes → verify: folder pane shows all cwd terminals
- [ ] 3.2 Retarget `onOpenTerminals(cwd)` in `App.tsx`: navigate to `/folder/:cwd/editor` (folder pane) instead of `/folder/:cwd/terminals` → verify: `[Terminals(N)]` opens the folder pane
- [ ] 3.3 `[Terminals(N)]` badge count = non-ephemeral terminals at cwd (unchanged source) → verify: badge reflects count

## 4. Client: remove standalone TerminalsView

- [ ] 4.1 Delete the `/folder/:cwd/terminals` route match, `folderTermMatch`/`folderTermCwd`, its title/derive plumbing, and the `TerminalsView` mounts (mobile + desktop) in `App.tsx` → verify: `rg 'TerminalsView|/folder/.*terminals|folderTermCwd' packages/client/src` clean
- [ ] 4.2 Delete `packages/client/src/components/TerminalsView.tsx` (+ tests + sidecar) → verify: gone
- [ ] 4.3 Confirm inline `!!` terminal cards (`InlineTerminalCard`, ephemeral) are untouched → verify: inline-terminal tests pass

## 5. Persistence reconcile

- [ ] 5.1 On pane load, drop `term:<id>` tabs whose id is absent from the current cwd terminal set (reuse `closeTab` adjacent-activation); restore live ones → verify: reconcile unit test (stale dropped, live restored)

## 6. Verify multi-attach (design open question)

- [ ] 6.1 Confirm the terminal WS server tolerates the same terminal id attached from two panes (folder + split) simultaneously; if not, gate to one active attach / hand-off → verify: manual/e2e no crash, output consistent

## 7. Tests + build

- [ ] 7.1 Add/adjust unit tests: terminal tab open/close/rename, folder auto-surface, session opt-in, reconcile → verify: pass
- [ ] 7.2 e2e: terminal-in-split (create from pane), terminal-in-folder-pane (auto-surface via `[Terminals]`), reconcile after reload → verify: pass
- [ ] 7.3 `npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` → verify: no failures
- [ ] 7.4 `npm run build` + type-check all packages → verify: clean

## 8. Docs + spec sync

- [ ] 8.1 Update per-directory `AGENTS.md` rows (deleted `TerminalsView`, new terminal viewer/registry entry, pane context terminal slice, `App.tsx` route removal) → verify: `kb dox lint` clean for touched dirs
- [ ] 8.2 Update `docs/architecture.md` terminal/split sections (delegated, caveman-style) → verify: no `/folder/:cwd/terminals` references remain
- [ ] 8.3 `openspec validate terminals-in-tabbed-panes` → verify: valid

## 9. Gates + QA

- [ ] 9.1 `doubt-driven-review` on the terminal-tab state/scoping/persistence model before it stands → verify: notes recorded
- [ ] 9.2 `code-simplification` pass: `TerminalsView` + its tab machinery fully removed, no orphaned handlers/props → verify: `npm run quality:changed` clean
- [ ] 9.3 QA: create/close/rename terminal tabs in split + folder pane; `[Terminals]` opens folder pane; no `/folder/:cwd/terminals` route responds; inline `!!` cards still work → verify: manual/e2e
- [ ] 9.4 Code-review gate on the diff (`review-changes.ts`) → verify: no Critical/Warning outstanding
