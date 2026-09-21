## 0. BLOCKING — identify the driver and baseline before any fix

The previous revision of this change named a driver from code reading and was
falsified on three independent counts. Nothing in groups 1–4 may be written until
group 0 resolves and the findings are recorded.

- [ ] 0.1 Reproduce on `/session/:id/editor?file=docs/architecture.md`. Record baseline over 30s with a `MutationObserver`: total DOM mutations, `.mermaid-diagram` removal count, distinct wave timestamps
- [ ] 0.2 Record DOM-node identity: stamp all `.mermaid-diagram` nodes, wait 20s, count survivors. Expect 0 of N before the fix
- [ ] 0.3 **Identify what re-renders `MarkdownContent`** at the observed rate. Do NOT assume WebSocket traffic is involved — that assumption produced the withdrawn revision. Enumerate candidates by evidence (ancestor remount, changing `key`, a context provider, a prop identity change) and establish which one fires, with instrumentation. Record the driver, named and evidenced, in `baseline.md` (test-plan: manual-only, #M1)
- [ ] 0.4 Verify or falsify the inline-`code` hypothesis: that `P`/`LI`/`STRONG`/`H3` appear as mutation *targets* because `MutationObserver` reports the parent, and the `code` override (`MarkdownContent.tsx:525`, `isInline` branch) remounts inline `<code>` spans inside prose. If falsified, an ancestor remount is in play and D0 widens before proceeding. Record the outcome either way (test-plan: manual-only, #M2)
- [ ] 0.5 Explain the run-to-run variance — one run recorded 2 waves/25s, another continuous waves for 36s. Identify the condition that makes runs differ; until this is understood, a quiet run cannot be read as a pass (test-plan: manual-only, #M3)
- [ ] 0.6 Record all findings in `baseline.md` in this change directory, including any hypothesis that was falsified
- [ ] 0.7 Gate: if 0.3 shows the driver is out of this change's scope, record it, confirm D1/D3 still stand on their own, and open a follow-up change for the trigger
- [ ] 0.8 Reconcile the diagram count: `docs/architecture.md` has 26 ` ```mermaid ` fences but only 21 `.mermaid-diagram` nodes were observed. Account for the other 5 (error branch emits no such element is the current guess) before the "every diagram, together" reading of the wave data is relied on (test-plan: manual-only, #M4)

## 1. Stop the remount — stable `components` identity (D1, D2)

- [ ] 1.1 Author the group-1 L1 scenarios (folded in group 5e/5f) and confirm they are RED. Note the redness requirement: a re-render with stable props leaves `React.memo` satisfied and the node preserved even pre-fix, so the existing passing test at `packages/client/src/components/__tests__/MarkdownContent.test.tsx:362` is NOT the assertion wanted — the scenarios must defeat the memo (fresh `imageBase`/`context` identity, matching production)
- [ ] 1.2 Add a provider for the per-render override values (`processedContent`, `syntaxStyle`, `context`, loopback handler). Keep it **separate** from `ImageBaseContext` and leave that context's memo deps untouched (D2)
- [ ] 1.3 Move `code`, `a`, `p`, `li` **and `table`** to module scope; have them read the new context. `table` needs no context — pure relocation. Preserve the `context?.fileLink` gate on `p`/`li` so only the object identity changes, not the condition, and ensure each branch of that gate yields a stable object
- [ ] 1.4 Verify no module-level mutable binding was introduced (design D1 review hazard)
- [ ] 1.5 Confirm the group-1 scenarios are now GREEN
- [ ] 1.6 Re-run 0.1/0.2. Waves must be 0 after initial mount; stamped nodes must all survive

## 2. Restore the memo guard — stable `imageBase` (D3)

- [ ] 2.1 Author the group-2 L1 scenarios (folded in group 5f) and confirm they are RED
- [ ] 2.2 Memoise `imageBase` on `[cwd, path]` at `MarkdownViewer.tsx:168`
- [ ] 2.3 Same at `MarkdownPreview.tsx:52` (keys on `target.cwd`/`target.path`)
- [ ] 2.4 Same at `FilePreviewOverlay.tsx:257`
- [ ] 2.5 Confirm `MarkdownContent`'s internal `useMemo` on `[imageBase?.cwd, imageBase?.dir]` is left intact — it guards the context value, a different boundary
- [ ] 2.6 Confirm the group-2 scenarios are now GREEN

## 3. Fixed-height viewport + fitted view (D4)

Do not start until 1.6 passes — this defect is unobservable while the remount
storm is active. Within the group, the hook option must exist before the viewport
work that consumes it.

- [ ] 3.1 Author the hook regression scenarios (folded in group 5a as the omitted-option rows) and confirm they are GREEN pre-change — they guard the four existing consumers and must never go red
- [ ] 3.2 Author the new-option scenarios (folded in groups 5a/5b) and confirm they are RED — the option does not exist yet
- [ ] 3.3 Add the **optional** initial/fit scale to `useZoomPan`: seed `useState` with it and point `reset` + `onDoubleClick` at it; default `1.0` when omitted. Seeding the initial state is required — the hook exposes no scale setter, so a reset-only option leaves the first paint unfitted
- [ ] 3.4 Clamp the supplied scale into the existing `[minScale, maxScale]` band so a tall diagram cannot fit below the 0.5× floor (design D4 constraint 1)
- [ ] 3.5 Update `packages/client-utils/src/__tests__/useZoomPan.test.ts` — its existing reset-to-1.0 assertions must become the omitted-option case
- [ ] 3.6 Author the viewport scenarios (folded in group 5d) and confirm RED. Assert the **height** only — do NOT assert "content clipped, not spilled" or pan reachability, both already green pre-fix (`transform` never affects layout; `overflow-hidden` exists at `MermaidBlock.tsx:381`; translation is unclamped)
- [ ] 3.7 Give the viewport the height `clamp(240px, 50vh, 640px)`, replacing `minHeight: 120`. Do not re-add `overflow-hidden`
- [ ] 3.8 Implement the fit as **contain** — `min(viewportWidth / intrinsicWidth, viewportHeight / intrinsicHeight)`. Never crop to fill
- [ ] 3.9 Derive the intrinsic size from the SVG markup in the explicit order from design D4 constraint 3: `viewBox` → `style` `max-width` → absolute `width`/`height` → mounted rect as last resort, **never** a mounted rect for a `width="100%"` SVG. Mermaid's `useMaxWidth` output carries `width="100%"` and does NOT omit its dimensions, so a naive "measure when absent" rule falls through to the circular path for the commonest diagram shape
- [ ] 3.10 Move the `scale !== 1` indicator gate in the shared `ZoomControls` and the `scale > 1` cursor tests onto the surface's initial scale (design D4 constraint 2). Add the optional prop to `ZoomControls` and the matching optional field to `UiZoomControlsProps` in `packages/shared` — this is what makes the change not client-only. Check all three render sites: `MermaidBlock`, `DiagramPreview` (gates `cursor` on `scale > 1`), `FlowGraph` (via the `ui:zoom-controls` registry)
- [ ] 3.11 Confirm the group-3 scenarios are now GREEN and 3.1's regression set is still green

## 4. Close the open branch — the `.mmd` path

- [ ] 4.1 Reproduce with a `.mmd`/`.mermaid` file, which routes `MermaidViewer → MermaidBlock` with **no markdown layer and no components map**. Every instrumented run so far used `.md`, so this path is unverified and D1 cannot help it
- [ ] 4.2 If it blinks after groups 1–2: a separate driver exists above `MermaidViewer`. Instrument before hypothesising — `systematic-debugging`, not another round of plausible code reading
- [ ] 4.3 If it does not blink: record that the `.mmd` report was in fact the `.md` path, and close

## 5. Folded test scenarios — L1 (vitest)

Each row below is one `test-plan.md` scenario. Exemplar pointers name the nearest
existing test to copy harness glue from.

### 5a. zoom-pan hook — see `packages/client-utils/src/__tests__/useZoomPan.test.ts`

- [ ] 5.1 No initial scale supplied · state created · `scale===1`, both translations `0` (test-plan #E1)
- [ ] 5.2 `initialScale: 2.5` in default band · state created · `scale===2.5`, translations `0` (test-plan #E2)
- [ ] 5.3 `initialScale: 0.5` (min boundary) · state created · `scale===0.5` (test-plan #E3)
- [ ] 5.4 `initialScale: 0.4` (just below min) · state created · `scale===0.5` and a later `zoomOut()` still floors at `0.5` (test-plan #E4)
- [ ] 5.5 `initialScale: 4` (max boundary) · state created · `scale===4` (test-plan #E5)
- [ ] 5.6 `initialScale: 4.5` (just above max) · state created · `scale===4` and a later `zoomIn()` still caps at `4` (test-plan #E6)
- [ ] 5.7 `initialScale: 0.4` with `{minScale:0.25,maxScale:10}` · state created · `scale===0.4`, clamped to the configured band not the default (test-plan #E7)
- [ ] 5.8 `initialScale: 2.5`, zoomed to `3.5` and panned · `reset()` · `scale===2.5`, translations `0` (test-plan #E8)
- [ ] 5.9 No initial scale, zoomed to `3.5` · `reset()` · `scale===1`, translations `0` (test-plan #E9)
- [ ] 5.10 `initialScale: 2.5`, zoomed and panned · `onDoubleClick` · `scale===2.5`, translations `0` (test-plan #E10)
- [ ] 5.11 Identical wheel input, with vs without an initial scale · wheel event · identical scale delta and cursor anchoring (test-plan #X4)
- [ ] 5.12 Identical drag input, with vs without an initial scale · pointer drag · identical translation delta (test-plan #X5)
- [ ] 5.13 `FlowGraph`, `DiagramPreview`, `ImagePreview`, `ImageLightbox` all omitting the option · each rendered and exercised · zoom/pan/reset/indicator unchanged from pre-change (test-plan #X6)

### 5b. ZoomControls indicator — see `packages/client-utils/src/__tests__/` sibling component tests

- [ ] 5.14 `initialScale: 2.5`, current `2.5` · render · no percentage indicator in the DOM (test-plan #E11)
- [ ] 5.15 `initialScale: 2.5`, current `3.0` · render · indicator reads `300%` (test-plan #E12)
- [ ] 5.16 No initial scale, current `1` · render · no indicator (test-plan #E13)
- [ ] 5.17 No initial scale, current `1.2` · render · indicator reads `120%` (test-plan #E14)

### 5c. Fit computation — see `packages/client/src/components/__tests__/MermaidBlock.test.tsx`

- [ ] 5.18 `viewBox="0 0 800 2000"`, viewport `600×420` · fit computed · `min(0.75,0.21)=0.21` clamped to the `0.5` floor, bound not widened (test-plan #E15)
- [ ] 5.19 `viewBox="0 0 800 400"`, viewport `600×420` · fit computed · `min(0.75,1.05)===0.75`, width-constrained (test-plan #E16)
- [ ] 5.20 `viewBox="0 0 400 1200"`, viewport `600×420` · fit computed · `min(1.5,0.35)===0.35`, height-constrained — the case a width-only fit gets wrong (test-plan #E17)
- [ ] 5.21 `width="100%"` + `style="max-width:800px"` + `viewBox="0 0 800 400"` · fit computed · size from `viewBox`, mounted rect NOT consulted, fit `0.75` not `1.0` (test-plan #E18)
- [ ] 5.22 Absolute `width`/`height`, no `viewBox` · fit computed · size from the attributes (test-plan #E19)
- [ ] 5.23 No `viewBox`, no `width`/`height`, not yet measurable · fit computed · no throw, falls back to scale `1`, no `NaN` (test-plan #X1)
- [ ] 5.24 Malformed `viewBox` (`"0 0 abc 400"`) · fit computed · falls through to the next resolution step, scale finite and in bounds (test-plan #X2)

### 5d. Viewport height — see `packages/client/src/components/__tests__/MermaidBlock.test.tsx`

- [ ] 5.25 Window where `50vh < 240px` · viewport rendered · computed height `===240px` (test-plan #E20)
- [ ] 5.26 Window where `50vh > 640px` · viewport rendered · computed height `===640px` (test-plan #E21)
- [ ] 5.27 Window where `240px ≤ 50vh ≤ 640px` · viewport rendered · computed height `===50vh` (test-plan #E22)

### 5e. Markdown override stability — see `packages/client/src/components/__tests__/MarkdownContent.test.tsx`

- [ ] 5.28 Markdown containing a GFM table · re-render defeating `React.memo` · the `<table>` DOM node is the same instance (test-plan #E23)
- [ ] 5.29 Context with vs without `fileLink`, each rendered twice · second render · with-case supplies `p`/`li` with identical identity both times; without-case omits them both times and leaves prose unlinkified (test-plan #E24)
- [ ] 5.30 Inline `code` spans inside `p` and `li` · re-render defeating memo · inline `<code>` nodes are the same instances and their `P`/`LI` parents record no childList mutation (test-plan #F4)
- [ ] 5.31 Context carrying `fileLink`, markdown with paragraphs and list items · re-render · `p` and `li` DOM nodes are the same instances (test-plan #F5)
- [ ] 5.32 Chat content growing token-by-token, mermaid fence still open · tokens arrive · `MermaidBlock` does not render and no parse error surfaces (test-plan #F9)
- [ ] 5.33 Same, fence then closes · closing fence arrives · diagram renders exactly once, earlier blocks not remounted (test-plan #F10)
- [ ] 5.34 Mermaid source that fails to parse · parent re-renders repeatedly · cached error branch renders stably, no remount loop, no repeated `mermaid.render` calls (test-plan #X3)

### 5f. imageBase identity — see `packages/client/src/components/__tests__/MarkdownContent.test.tsx`

- [ ] 5.35 `MarkdownViewer` with fixed `cwd`/`path` · parent re-renders without changing either · `MarkdownContent` does not re-render (test-plan #F6)
- [ ] 5.36 `MarkdownViewer` switched to a different `path` · re-render · `MarkdownContent` re-renders with the new `imageBase` (test-plan #F7)
- [ ] 5.37 Two `MarkdownContent` instances with different `imageBase` · both mounted · each resolves local images against its own base — guards the module-scope state-leak mode (test-plan #F8)

## 6. Folded test scenarios — L3 (Playwright vs docker harness)

Read the harness port from `.pi-test-harness.json` (`dashboardPort`); never
hardcode `:18000`.

- [ ] 6.1 `docs/architecture.md` in the file viewer, harness idle · 30s · **0** `.mermaid-diagram` removal waves after mount AND every stamped node survives — see `tests/e2e/file-preview-survives-churn.spec.ts` for the churn-survival harness shape and `tests/e2e/chat-render-perf.spec.ts` for the perf-window shape (test-plan #P1)
- [ ] 6.2 Chat view with a rendered mermaid block · 30s idle · every stamped `.mermaid-diagram` node survives — see `tests/e2e/mermaid-colorize.spec.ts` (test-plan #P2)
- [ ] 6.3 Same file with concurrent session activity driven against the harness · 30s · **0** removal waves under load — guards the baseline finding that wave rate scales with event volume — see `tests/e2e/chat-render-perf.spec.ts` (test-plan #P3)
- [ ] 6.4 File viewer on `docs/architecture.md` · an application-wide re-render occurs · no markdown DOM node removed or replaced — see `tests/e2e/file-preview-survives-churn.spec.ts` (test-plan #F1)
- [ ] 6.5 Diagram clicked to focus, controls visible · ancestor re-renders repeatedly · controls remain in the DOM and operable, `scale` unchanged — see `tests/e2e/mermaid-colorize.spec.ts` (test-plan #F2)
- [ ] 6.6 Diagram zoomed to a non-fit scale and panned · ancestor re-renders · scale and pan offset unchanged — see `tests/e2e/diagram-preview.spec.ts` for the zoom-surface harness (test-plan #F3)
- [ ] 6.7 Diagram at fitted scale in the fixed-height viewport · user zooms past the fitted scale · viewport height unchanged, overflow reachable by panning — see `tests/e2e/diagram-preview.spec.ts` (test-plan #F11)
- [ ] 6.8 A `.mmd` file open via `MermaidViewer` · 30s idle · 0 removal waves — closes the branch the investigation never reproduced — see `tests/e2e/mermaid-colorize.spec.ts` (test-plan #F12)
- [ ] 6.9 A diagram type outside `{flowchart, sequence, gantt}` · rendered · fitted to the viewport, not left at intrinsic width — see `tests/e2e/mermaid-colorize.spec.ts` (test-plan #F13)

## 7. Manual-only scenarios (deferred post-merge by ship-change)

- [ ] 7.1 Reference diagrams across the 9 themes · human looks at default framing · framing reads as unchanged from today, no new clipping and no excessive whitespace (test-plan: manual-only, #F14)

The four investigation rows (#M1–#M4) are folded as tasks 0.3, 0.4, 0.5 and 0.8 —
they gate the work rather than follow it, so they carry their `manual-only` tag in
group 0 rather than being restated here.

## 8. Verification and closeout

- [ ] 8.1 Re-run the full 0.1–0.2 battery against the recorded `baseline.md`, under conditions 0.5 established as comparable
- [ ] 8.2 Confirm the discharge criteria in design "Verification strategy": 0 waves, every stamped node survives, zoom state survives a forced re-render, D0 driver recorded. Raw mutation counts are deliberately NOT a gate
- [ ] 8.3 Manual: click a diagram, zoom with buttons and wheel, pan, double-click to reset — confirm it returns to the fitted view
- [ ] 8.4 Manual: same in the **chat view**, including while a response streams a mermaid block token by token. Chat is the `context.fileLink` path that a `code`-only hoist would have missed
- [ ] 8.5 `review-code` pass on the full diff, focused on task 1.4 and on the `useZoomPan` signature staying backward-compatible for **all four** other consumers (`FlowGraph`, `DiagramPreview`, `ImagePreview`, `ImageLightbox`) plus all three `ZoomControls` render sites and `UiZoomControlsProps`
- [ ] 8.6 Confirm the coupled revert: `MermaidBlock`'s fitted view, the `useZoomPan` option, the `ZoomControls` prop and the `UiZoomControlsProps` field revert as one unit
- [ ] 8.7 `npm test` green; `npm run quality:changed` clean
- [ ] 8.8 Rebuild: `packages/shared` is touched, so NOT client-only → `npm run build` + `curl -X POST http://localhost:8000/api/restart`
- [ ] 8.9 Update the directory `AGENTS.md` rows for every touched file with `See change: fix-markdown-remount-storm`
