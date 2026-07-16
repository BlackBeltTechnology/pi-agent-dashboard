# Tasks — terminals-in-tabbed-panes

> Depends on `remove-external-editor-integration` (folder-scoped pane at `/folder/:cwd/editor`). Land that first. Section 3 (folder surface + button retarget) needs it; sections 1–2 (session-split terminal tab) stand alone.

## 1. Shared: terminal viewer kind

- [x] 1.1 Add `"terminal"` to the `ViewerKind` union in `packages/shared/src/file-kind.ts` → verify: type-check
- [x] 1.2 Add `"terminal"` to the pane-state validator viewer allowlist (`VALID_VIEWERS` in `editor-pane-state.ts`) so `term:` tabs are not discarded as corrupt → verify: unit test loads a `term:` tab without discard

## 2. Client: terminal tab mechanism (session split)

- [x] 2.1 Add `terminal` entry to `viewer-registry` (placeholder — the real xterm mount is the keep-alive `TerminalPaneLayer`, single mount per id, avoiding the fix-terminal-half-height-dual-mount bug); layer parses `<id>` from `term:<id>` and renders `<TerminalView terminalId={id} visible … />` filling the tab body (no `heightPx`) → verify: renders attached terminal
- [x] 2.2 Extend the pane context (`SplitWorkspaceContext` terminal slice via `useTerminalPaneTabs`) exposing, for the pane cwd: `terminals: TerminalSession[]`, `createTerminal()`, `killTerminal(id)`, `renameTerminal(id,title)`, `onTerminalTitle(id,title)`; thread `App`'s existing terminal state/handlers into the provider scoped to the pane cwd → verify: context provides cwd-scoped terminals
- [x] 2.3 Add `openTerminal(id)` helper (dispatch `openFile` with `term:<id>` / `terminal`) and wire close → `closeTerminalTab`→`killTerminal`, rename → `renameTerminal`, keep-alive (single mounted `TerminalView` per id) → verify: open/close/rename unit tests
- [x] 2.4 Add a "+ Terminal" affordance to the pane header (`new-terminal-launch`) → `createTerminal()` + open its tab active → verify: creates + opens tab
- [x] 2.5 Session split: terminal tabs open only on user action (no auto-surface) → verify: split with an existing cwd terminal shows no tab until opened

## 3. Client: folder pane surface + sidebar retarget (needs Change 1)

- [x] 3.1 Folder-scoped pane: auto-open a `term:<id>` tab for every non-ephemeral terminal at the folder cwd on mount + when the terminal set changes (`autoSurfaceTerminals` on `FolderEditorView`'s provider) → verify: folder pane shows all cwd terminals
- [x] 3.2 Retarget `onOpenTerminals(cwd)` in `App.tsx`: navigate to `/folder/:cwd/editor` (folder pane) instead of `/folder/:cwd/terminals` → verify: `[Terminals(N)]` opens the folder pane
- [x] 3.3 `[Terminals(N)]` badge count = non-ephemeral terminals at cwd (unchanged source) → verify: badge reflects count

## 4. Client: remove standalone TerminalsView

- [x] 4.1 Delete the `/folder/:cwd/terminals` route match, `folderTermMatch`/`folderTermCwd`, its title/derive plumbing, and the `TerminalsView` mounts (mobile + desktop) in `App.tsx` → verify: `rg 'TerminalsView|/folder/.*terminals|folderTermCwd' packages/client/src` clean (only rewritten comment lines remain)
- [x] 4.2 Delete `packages/client/src/components/TerminalsView.tsx` (+ sidecar; no test file existed) → verify: gone
- [x] 4.3 Confirm inline `!!` terminal cards (`InlineTerminalCard`, ephemeral) are untouched — provider filters ephemeral out of the tab set → verify: inline-terminal tests pass

## 5. Persistence reconcile

- [x] 5.1 On pane load, drop `term:<id>` tabs whose id is absent from the current cwd terminal set (reuse `closeTab` adjacent-activation via new `closeByPath` action); restore live ones → verify: reconcile unit test (stale dropped, live restored)

## 6. Verify multi-attach (design open question)

- [x] 6.1 Confirmed: `terminal-manager` keeps `clients: Set<WebSocket>` per terminal — multiple simultaneous attaches are already tolerated (`pty.onData` broadcasts to all clients, each `attach` replays the buffer). No gating needed → verify: source review of terminal-manager.attach

## 7. Tests + build

- [x] 7.1 Add/adjust unit tests: terminal tab open/close/rename, folder auto-surface, session opt-in, reconcile (`use-terminal-pane-tabs.test.ts` + `editor-pane-state.test.ts`) → verify: pass
- [x] 7.2 e2e `tests/e2e/terminal-tab.spec.ts`: + Terminal in the split creates a terminal, opens its `term:<id>` tab, mounts xterm, and close-tab kills it — PASSES against the docker harness. Folder auto-surface (D3) + reconcile (D5) stay L1 (harness-flaky cross-cwd seeding), per the editor-pane.spec F9/F11 precedent. (Fixed a latent bug: `useMessageHandler` still navigated to the removed `/folder/:cwd/terminals` route on terminal create → deselected the session.) → verify: pass
- [x] 7.3 client + shared suites: 3610 + 1323 pass, 0 failures (canvas getContext warnings are benign jsdom noise) → verify: no failures
- [x] 7.4 `npm run build` (Vite) clean; `tsc --noEmit` clean for all touched files (9 pre-existing errors in image-fit-extension/office-preview, untouched) → verify: clean

## 8. Docs + spec sync

- [x] 8.1 Updated per-directory `AGENTS.md` rows: removed `TerminalsView.tsx`; added `TerminalPaneLayer.tsx` + `use-terminal-pane-tabs.ts`; updated `EditorPane`/`EditorTabs`/`viewer-registry`/`FolderEditorView`/`file-kind`/`useMessageHandler` rows + `SplitWorkspaceContext`/`editor-pane-state` sidecars + `tests/e2e` spec row → verify: rows updated
- [x] 8.2 Updated `docs/architecture.md` (delegated to subagent, caveman-style): Terminal Lifecycle step 4 + new "Terminals as Editor-Pane Tabs" subsection replacing "Folder-Scoped View" → verify: only the intentional "REMOVED" note references `/folder/:cwd/terminals`
- [x] 8.3 `openspec validate terminals-in-tabbed-panes` → verify: valid

## 9. Gates + QA

- [x] 9.1 `doubt-driven-review` on the state/scoping/persistence model — FOUND + FIXED a real bug: cold-load reconcile race (persisted `term:` tabs restored synchronously, but the WS terminal snapshot arrives after mount → the empty live set wiped live tabs before the snapshot landed; the opt-in session split lost them permanently). Fix: `reconcileTerminalTabs` treats an EMPTY live set as "not yet known" and drops nothing (a later non-empty set drives precise reconcile). Covered by 2 new unit tests. Other risks reviewed + accepted: cross-pane multi-attach (panes are route-exclusive, single mount per id; terminal-manager tolerates multi-attach anyway), auto-surface focus-steal (matches prior TerminalsView, per D3), `closeByPath`-in-loop (path-keyed, safe) → verify: notes recorded
- [x] 9.2 `code-simplification`: `TerminalsView.tsx` + sidecar deleted; `/folder/:cwd/terminals` route + `folderTermMatch`/`folderTermCwd` + create-time navigation removed; my only orphan (`encodeFolderPath` import in useMessageHandler) removed. Pre-existing unused imports in `App.tsx` (`Route`/`Switch`/etc., `noUnusedImports`=warn, not my orphans) left per surgical-changes. `lastCreatedTerminalIdRef` now write-only (harmless shared-handler bookkeeping; removing touches ~15 test files — out of scope). CI Tier-A (`biome lint .`) clean for all touched files → verify: no new Tier-A errors
- [x] 9.3 QA: e2e `terminal-tab.spec.ts` covers create (opt-in) + tab open + xterm mount + close-kills in the split (PASSES on docker harness); rename/open/reconcile/auto-surface/opt-in covered by 15 L1 tests; inline `!!` cards untouched (ephemeral filtered) → verify: e2e + unit
- [x] 9.4 Code-review gate (`review-changes.ts`, CodeRabbit advisory): 0 findings on any file in this change; all Major findings are on unrelated changes sharing the diff base (`add-cloud-sync-connector`, `add-universal-network-guard`, `archive/*`, `kb-plugin`) → verify: no Critical/Warning outstanding on my diff
