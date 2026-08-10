## 1. Baseline

- [ ] 1.1 Record the starting probe count: `npx biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000` reports 17. Re-run after every cut below; the predicted drops are D1 −2, D2 −2, D4a −2, D3 −5, D4b −6, ending at 0. A cut that misses its predicted drop did not do what it claimed — stop and re-diagnose rather than stacking the next cut.
- [ ] 1.2 Resolve **C1** (test-plan clarification, blocks task 5.5): determine what `GET /api/file?cwd&path=diff:<rel>` returns today, so the expected observable for an oversized pseudo-tab is established before E8 is authored. Likely a miss → `size` 0 → the gate never fires → removal is a no-op; confirm rather than assume.

## 2. D1 — extract `isLoopback` (server, −2)

- [ ] 2.1 Extract `isLoopback` and `LOOPBACK_ADDRESSES` from `packages/server/src/auth/localhost-guard.ts` into a new leaf module under `packages/server/src/auth/`. Both `localhost-guard.ts` and `tunnel/tunnel-block-events.ts` import it; leave no re-export edge behind in `localhost-guard.ts`.
- [ ] 2.2 Update the direct import at `packages/server/src/__tests__/localhost-guard.test.ts:2` to the new module path.
- [ ] 2.3 Extend the `isLoopback` unit test for the extracted module — see `packages/server/src/__tests__/localhost-guard.test.ts`. Triple: each member of `LOOPBACK_ADDRESSES`, plus `203.0.113.1` and `undefined` · call `isLoopback` from its new leaf module · `true` for every set member, `false` for the other two, identical to pre-extraction (test-plan #E2).
- [ ] 2.4 Run the existing `localhost-guard.test.ts` and `tunnel-block-events.test.ts` suites unchanged — see `packages/server/src/__tests__/tunnel-block-events.test.ts`. Triple: both existing suites with updated import paths · run them · every assertion passes unchanged (test-plan #E3).

## 3. D2 — extract `formatCost` (flows-plugin, −2)

- [ ] 3.1 Extract `formatCost` from `packages/flows-plugin/src/client/FlowAgentCard.tsx` into a leaf module under `packages/flows-plugin/src/client/`; `FlowAgentCard` and `FlowAgentDetail` both import it.
- [ ] 3.2 Unit-test the extracted `formatCost` — see `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx`. Triple: `0`, `0.005`, `1.5`, `1234.567` · call the extracted `formatCost` · 2-decimal output identical to today's `FlowAgentCard.tsx:27`, explicitly NOT `SessionSidebar.tsx:42`'s different 4-decimal function (test-plan #E4).
- [ ] 3.3 Render-test both flow agent surfaces — see `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx`. Triple: a flow agent with non-zero cost · render `FlowAgentCard` and `FlowAgentDetail` · both mount, cost renders with 2 decimals in each, no `undefined` component from a circular import (test-plan #F7).

## 4. D4a — extract `isExternalHref` (client, −2)

- [ ] 4.1 Extract `isExternalHref` from `packages/client/src/components/preview/MarkdownContent.tsx` into a leaf module under `preview/`; `MarkdownContent` and `FrontmatterProperties` both import it. Move only this util — leave `tableToMarkdown`, `tableToTsv`, `isFencedBlockComplete` in place.
- [ ] 4.2 Unit-test the extracted predicate — see `packages/client/src/components/tool-renderers/__tests__/UrlLink.test.tsx`. Triple: `https://example.com/x`, a same-origin absolute URL, `#anchor`, `undefined` · call `isExternalHref` from its new module · `true` only for the cross-origin URL, `false` for the other three, identical to pre-extraction (test-plan #E9).
- [ ] 4.3 Regression-test external-link hardening — see `packages/client/src/components/tool-renderers/__tests__/UrlLink.test.tsx`. Triple: external URL, same-origin URL, fragment-only, loopback URL · render markdown containing each · external gets `target="_blank" rel="noopener noreferrer"`, fragment + same-origin stay in-document, loopback click opens the split live-server viewer (test-plan #F6).

## 5. D3 — split `viewerRegistry` + `EditorPane` dispatch (client, −5)

- [ ] 5.1 Add the kind discrimination to `packages/client/src/components/editor-pane/EditorPane.tsx` FIRST, before any registry change: pseudo-tab kinds render registry (b) directly, everything else goes to `CappedViewer`. The discriminator MUST be `activeTab.viewer ∈ {diff, terminal, url, live-server}` — NOT `fileKind(...)` (its `.viewer` is wrong for pseudo-tab paths) and not a path-prefix test. Also fix the stale "resolved via the viewer registry" comment at `EditorPane.tsx:3`.
- [ ] 5.2 Split `viewer-registry.tsx` into half (a) `fileKind()`-returnable viewers and half (b) explicitly-opened pseudo-tab viewers (`diff`, `terminal`, `url`, `live-server`). Only (b) imports `DiffViewer`. Make each half's `Record` total over its own subset of the closed `ViewerKind` union.
- [ ] 5.3 Narrow `CappedViewer`'s `viewer` prop from the full `ViewerKind` union to half (a)'s key subset, and point its lookup at half (a) only. Do this only after 5.1 — narrowing first converts a compile-time guarantee into a runtime crash.
- [ ] 5.4 Update `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx:53-62`, which asserts `Object.keys(viewerRegistry)` equals the full 16-key list, to cover both halves. Triple: both registry halves · take the key union and intersection · union === all 16 `ViewerKind` members, intersection empty, each half's `Record` total over its subset (test-plan #E5).
- [ ] 5.5 Test kind routing — see `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx`. Triple: all 16 `ViewerKind` members · look each up in both halves · the 12 `fileKind()`-returnable kinds resolve from (a) and are absent from (b); the 4 pseudo-tab kinds resolve from (b) and are absent from (a) (test-plan #E6).
- [ ] 5.6 Test that the size gate is preserved for real files — see `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx`. Triple: `size` = `MAX_PREVIEW_BYTES-1`, `= MAX_PREVIEW_BYTES`, `= MAX_PREVIEW_BYTES+1` for a non-`monaco` file-kind viewer · mount `CappedViewer` · first two render the viewer, third renders `TooLargePreview`; `monaco` bypasses at all three (test-plan #E7).
- [ ] 5.7 Test the oversized pseudo-tab boundary once C1 (task 1.2) is resolved — see `tests/e2e/editor-pane.spec.ts`. Triple: a `diff:` tab whose content exceeds `MAX_PREVIEW_BYTES` · open the tab · observable per the C1 resolution (test-plan #E8).
- [ ] 5.8 E2E the diff tab — see `tests/e2e/editor-pane.spec.ts`. Triple: a session with a diff · open a `diff:` tab in the editor pane · `DiffPanel` body renders, no blank pane, no `<undefined/>` React throw, no console error (test-plan #F1).
- [ ] 5.9 E2E the other three pseudo-tabs — see `tests/e2e/editor-pane.spec.ts`. Triple: a `url:` tab, a `live:` tab, a `term:` tab · open each · each converges to its own body (url viewer / live-server viewer / terminal keep-alive layer), none takes the file-kind path (test-plan #F2).
- [ ] 5.10 Test the `DiffFilePreview` missing-file path is intact — see `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx`. Triple: `GET /api/file` returns 404 / non-file · open diff "Preview" mode · `data-testid="diff-preview-not-found"` renders and the panel does not crash (test-plan #X1).
- [ ] 5.11 Add the type-level guard that an unregistered kind cannot ship — see `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx`. Triple: a member added to `ViewerKind` but registered in neither half · `tsc --noEmit` · compile error, not a runtime `undefined` lookup (test-plan #X2).

## 6. D4b — invert `MarkdownContent → FileLink` (client, −6)

- [ ] 6.1 Add an optional `fileLink` renderer field to `ToolContext` (`packages/client/src/components/tool-renderers/types.ts`) and move `MarkdownContent`'s linkification trigger from "`context` present" to "`context.fileLink` present". Do NOT introduce a renderer registry module — it cannot import `FileLink` without re-forming the cycle, and would need a mutable attach-before-render singleton.
- [ ] 6.2 Attach `fileLink` at both production builders: `packages/client/src/App.tsx:1126` and `packages/client/src/main.tsx:112` (`ToolCallStepPrimitive`). Missing the second is the concrete silent-regression path.
- [ ] 6.3 Attach a default `fileLink` in `packages/client/src/chat-embed/index.ts` so external embedders keep linkification with no code change, and correct the stale doc-comment at `chat-embed/index.ts:52` (it lists an `editors` field that does not exist).
- [ ] 6.4 Test linkification at every context shape — see `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx`. Triple: four `ToolContext` shapes (`App.tsx:1126`, cwd-less `main.tsx:112`, bare `chat-embed`, and no context) · render `MarkdownContent` with markdown containing a file mention · a `FileLink` is produced for the first three, plain text for the fourth, matching today (test-plan #F3).
- [ ] 6.5 Test the `hostManaged` dual-mode is preserved — see `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx`. Triple: a `FileLink` inside a `FilePreviewProvider` and one outside it · click to open a preview · inside, `hostManaged` true with exactly one overlay from `FilePreviewHost` and none from the leaf; outside, the leaf-local overlay renders; zero double-mounts (test-plan #F4).
- [ ] 6.6 Test the public `ToolContext` surface is not broken — see `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx`. Triple: a `chat-embed` consumer building a `ToolContext` without `fileLink` · typecheck + render · compiles (field optional) and linkification still works via the attached default (test-plan #X4).
- [ ] 6.7 E2E that file preview survives message churn — see `tests/e2e/file-preview-survives-churn.spec.ts`. Triple: open a file preview in chat, then stream new messages · the message list re-renders / remounts · the overlay stays open on the same target (test-plan #F5).

## 7. Verify

- [ ] 7.1 Terminal gate — see `.github/workflows/ci.yml`. Triple: the whole repo after all five cuts · run `npx biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000` · `Found 0 warnings`, exit 0; any nonzero count is a failure, not partial progress (test-plan #E1).
- [ ] 7.2 `isolatedModules` conformance — see `.github/workflows/ci.yml`. Triple: all five extracted leaf modules · `tsc --noEmit` · exit 0, every type re-export using `export type` (test-plan #E10).
- [ ] 7.3 Production bundle builds and boots — see `.github/workflows/ci.yml`. Triple: the full repo after all cuts · `npm run build` then load the built app · build exits 0 and the app boots with no module-evaluation `undefined` binding error in console (test-plan #X3).
- [ ] 7.4 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures.
- [ ] 7.5 Manual visual parity check across the markdown-heavy chat transcript, the file-preview overlay, the four pseudo-tab kinds, and the flow agent card/detail, compared against `develop` (test-plan: manual-only).

## 8. Docs

- [ ] 8.1 Update the directory `AGENTS.md` rows for every added or materially changed file (`packages/server/src/auth/`, `packages/flows-plugin/src/client/`, `packages/client/src/components/preview/`, `.../editor-pane/`, `.../tool-renderers/`, `.../chat-embed/`), per the Documentation Update Protocol.
