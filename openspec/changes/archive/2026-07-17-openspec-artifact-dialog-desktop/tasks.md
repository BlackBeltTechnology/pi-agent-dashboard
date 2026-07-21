# Tasks — non-mobile artifact dialog

## 1. App-level gate + dialog state
- [x] 1.1 Add `artifactDialog: { cwd, changeName, artifactId } | null` state + `openArtifact(cwd, changeName, artifactId)` handler in `App.tsx`: `isMobile ? handleReadArtifact(...) : setArtifactDialog(...)`. `useOpenSpecActions` stays navigate-only. → verify: unit test both branches.
- [x] 1.2 Swap all **5** badge wiring sites: the bare reference `onReadArtifact={handleReadArtifact}` at SessionList (~1339, by reference) + the 4 cwd-closures (~1431/1496/1515/1710) from `handleReadArtifact(cwd, …)` to `openArtifact(cwd, …)`; preserve each cwd binding. `openArtifact` keeps the 3-arg signature. → verify: every surface (SessionList/board/mobileActions/SessionHeader/ComposerSessionActions) opens the dialog on non-mobile, navigates on mobile.
- [x] 1.3 Add resize-close effect: `useEffect(() => { if (isMobile) setArtifactDialog(null); }, [isMobile])`. → verify: open dialog, flip isMobile true → closes.

## 2. OpenSpecArtifactDialog component
- [x] 2.1 New `packages/client/src/components/OpenSpecArtifactDialog.tsx` mirroring `ArchiveArtifactReader` (local `activeTab` → `useOpenSpecReader(cwd, changeName, activeTab, artifacts)` with `archive=false`; `onTabChange={setActiveTab}`), inside `<Dialog open size="full" flush onClose testId="openspec-artifact-dialog">`. **Wrap `MarkdownPreviewView` in a height-constrained `flex flex-col` box** (e.g. `h-[85vh] flex flex-col`) — flush Dialog is not flex and the reader uses `flex-1`. `onBack={onClose}`. Re-derive `change`/`artifacts` from `openspecMap`; loading state when the map has no entry (cold-load); **explicit not-found state (dedicated message, not a generic reader fetch error) when the change is absent after load**. → verify: renders content full-height (header+tabs+scrolling body visible); tab click swaps content, URL unchanged; cold-load shows loading; missing change shows not-found.
- [x] 2.2 Render `<OpenSpecArtifactDialog>` in `App.tsx` when `artifactDialog != null`, passing `openspecMap` + `onClose={() => setArtifactDialog(null)}`. → verify: badge click on non-mobile shows dialog over current view.

## 3. Non-goals stay intact
- [x] 3.1 Confirm `useOpenSpecActions`, `buildOpenSpecPreviewUrl`, the three route-match sites, and `ArchiveBrowserView` are untouched; archived badges still use the archive reader. → verify: mobile route + archive reading unchanged.

## Tests (folded from test-plan.md — manifest is the automated/manual source of truth)

### L1 unit — packages/client/src/{components,hooks}/__tests__/ (vitest)
Exemplars: `packages/client/src/components/__tests__/ArtifactLettersButton.test.tsx`, `Dialogs.test.tsx`.
- [x] T-E1 (test-plan #E1) openArtifact non-mobile branch → sets dialog state. input: `openArtifact("/w","ch","proposal")` with useMobile()=false · trigger: call · observable: `setArtifactDialog({cwd,changeName,artifactId})` invoked, `navigate` NOT called.
- [x] T-E2 (test-plan #E2) openArtifact mobile branch → navigate. input: same call, useMobile()=true · trigger: call · observable: `navigate(buildOpenSpecPreviewUrl("/w","ch","proposal"))`, `artifactDialog` stays null.
- [x] T-E3456 (test-plan #E3 #E4 #E5 #E6) useMobile boundary matrix. input/trigger/observable: (vw768,vh800)→dialog · (vw767,vh800)→navigate · (vw1400,vh599)→navigate (short-wide IS mobile) · (vw1400,vh600)→dialog.
- [x] T-X2 (test-plan #X2) not-found = dedicated message. input: populated map, change "ch" absent · trigger: render OpenSpecArtifactDialog for "ch" · observable: explicit not-found copy shown, NOT generic "Failed to fetch".
- [x] T-F8 (test-plan #F8) letter cursor hint. input: hover a badge letter · trigger: hover · observable: computed `cursor: pointer`.

### L3 e2e — tests/e2e/*.spec.ts (Playwright, docker harness; read port from `.pi-test-harness.json`, never `:18000`)
Exemplar: `tests/e2e/subagent-detail-dialog.spec.ts` (dialog e2e harness glue), `tests/e2e/file-preview-survives-churn.spec.ts`.
- [x] T-E7 (test-plan #E7) all 5 wiring sites gated. input: non-mobile; badge on SessionList/board/mobileActions/SessionHeader/ComposerSessionActions · trigger: click P on each · observable: dialog opens on every surface, none navigates.
- [x] T-F1 (test-plan #F1) dialog over view, URL unchanged, tabs. input: non-mobile, change with 4 artifacts, active session view · trigger: click P · observable: dialog mounted, underlying view still in DOM, `location.href` unchanged, tab bar P/D/S/T with P active.
- [x] T-F2 (test-plan #F2) tab switch = local state, no history push. input: dialog open on P · trigger: click D tab · observable: design content, `history.length` + `location.href` unchanged.
- [x] T-F3 (test-plan #F3) flex-wrapper full-height render (regression guard for flex-1 collapse). input: dialog open · trigger: render · observable: header + tab bar + content area visible, content boundingRect height > 0.
- [x] T-F4 (test-plan #F4) close via Esc / backdrop / back. input: dialog open (3 edges) · trigger: Esc · backdrop click · reader back · observable: dialog unmounted each way, underlying view revealed unchanged.
- [x] T-F5 (test-plan #F5) focus returns to triggering badge. input: dialog opened from badge B · trigger: close · observable: `document.activeElement` === badge B.
- [x] T-F6 (test-plan #F6) resize into mobile auto-closes. input: dialog open at vw=1000 · trigger: resize to vw=700 · observable: dialog unmounted.
- [x] T-F7 (test-plan #F7) ephemeral — no reload survival. input: dialog open · trigger: reload page · observable: after reload no dialog, base route URL.
- [x] T-X1 (test-plan #X1) cold-load convergence. input: openspecMap has no entry for cwd · trigger: click badge, then WS replay populates map · observable: loading state → artifact content, no crash.
- [x] T-X3 (test-plan #X3) change removed mid-dialog. input: dialog open on "ch" · trigger: WS drops "ch" from active map · observable: dialog flips to not-found, no exception.
- [x] T-E8 (test-plan #E8) archive isolation (non-goal guard). input: archived-change badge in ArchiveBrowserView · trigger: click P · observable: archive reader renders (archive=true), no OpenSpecArtifactDialog, no navigate.
- [x] T-E9 (test-plan #E9) mobile route unchanged (non-goal guard). input: useMobile()=true · trigger: click P · observable: full-page preview route, browser Back closes.

## Validate
- [x] V1 `npm test` green.
- [x] V2 `npx openspec validate openspec-artifact-dialog-desktop --strict` passes.
- [x] V3 (test-plan #F9, manual-only) Manual: no badge surface renders inside an already-open Dialog (nested focus-trap latent-collision guard); archive browser artifact reading unaffected.
