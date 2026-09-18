# Test Plan — fix-markdown-remount-storm

Stage: design   Generated: 2026-09-19

Levels in scope: **L1** (vitest) · **L3** (Playwright vs docker harness) ·
**manual-only**. L2 (qa VM smoke) is explicitly out of scope — this change is
neither an install nor a cross-OS runtime concern.

Clarifications resolved at the HARD gate before this file was written:

- **C1 — fit semantics** → *contain*: `min(widthRatio, heightRatio)`, whole
  diagram always visible, side whitespace permitted.
- **C2 — viewport height** → clamped range `clamp(240px, 50vh, 640px)`.
- **C3 — performance pass threshold** → **0 remount waves AND every stamped
  diagram node survives, over a 30s idle window.** Raw mutation counts are NOT
  thresholded (too environment-dependent, per the baseline variance).

> L3 observables are read against the harness port recorded in
> `.pi-test-harness.json` (`dashboardPort`), never a hardcoded `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | zoom-pan Bounded scaling | BVA | L1 | automated | no initial scale supplied | zoom-pan state created | `scale === 1`, `translateX === 0`, `translateY === 0` |
| E2 | zoom-pan Bounded scaling | BVA | L1 | automated | `initialScale: 2.5`, default band `[0.5, 4]` | state created | `scale === 2.5`, both translations `0` |
| E3 | zoom-pan Bounded scaling | BVA (min) | L1 | automated | `initialScale: 0.5` | state created | `scale === 0.5` |
| E4 | zoom-pan Bounded scaling | BVA (just below min) | L1 | automated | `initialScale: 0.4` | state created | `scale === 0.5`; a subsequent `zoomOut()` still floors at `0.5` (bound not widened) |
| E5 | zoom-pan Bounded scaling | BVA (max) | L1 | automated | `initialScale: 4` | state created | `scale === 4` |
| E6 | zoom-pan Bounded scaling | BVA (just above max) | L1 | automated | `initialScale: 4.5` | state created | `scale === 4`; a subsequent `zoomIn()` still caps at `4` |
| E7 | zoom-pan Bounded scaling | BVA (custom band) | L1 | automated | `initialScale: 0.4` with `{minScale: 0.25, maxScale: 10}` (the `ImageLightbox` config) | state created | `scale === 0.4` — clamps to the *configured* band, not the default |
| E8 | zoom-pan Button zoom controls | state-transition | L1 | automated | `initialScale: 2.5`, user zoomed to `3.5` and panned | `reset()` | `scale === 2.5`, both translations `0` |
| E9 | zoom-pan Button zoom controls | state-transition | L1 | automated | no initial scale, zoomed to `3.5` | `reset()` | `scale === 1`, both translations `0` (unchanged legacy contract) |
| E10 | zoom-pan Button zoom controls | state-transition | L1 | automated | `initialScale: 2.5`, zoomed and panned | `onDoubleClick` | `scale === 2.5`, both translations `0` |
| E11 | zoom-pan On-surface control buttons | decision-table | L1 | automated | `ZoomControls` with `initialScale: 2.5`, current scale `2.5` | render | no percentage indicator in the DOM |
| E12 | zoom-pan On-surface control buttons | decision-table | L1 | automated | `initialScale: 2.5`, current scale `3.0` | render | indicator renders `300%` |
| E13 | zoom-pan On-surface control buttons | decision-table | L1 | automated | no initial scale, current scale `1` | render | no indicator (regression guard for `FlowGraph`/`DiagramPreview`) |
| E14 | zoom-pan On-surface control buttons | decision-table | L1 | automated | no initial scale, current scale `1.2` | render | indicator renders `120%` |
| E15 | zoomable-mermaid fitted scale honours bounds | BVA + contain | L1 | automated | SVG `viewBox="0 0 800 2000"`, viewport `600×420` | fit computed | `min(600/800, 420/2000) = 0.21` → clamped to the `0.5` floor, bound not widened |
| E16 | zoomable-mermaid Initial view is fitted | contain | L1 | automated | SVG `viewBox="0 0 800 400"`, viewport `600×420` | fit computed | `min(0.75, 1.05) === 0.75` (width-constrained) |
| E17 | zoomable-mermaid Initial view is fitted | contain | L1 | automated | SVG `viewBox="0 0 400 1200"`, viewport `600×420` | fit computed | `min(1.5, 0.35) === 0.35` (height-constrained — the case a width-only fit would get wrong) |
| E18 | design D4 constraint 3 | EP (markup shape) | L1 | automated | `width="100%"` + `style="max-width:800px"` + `viewBox="0 0 800 400"` (the mermaid `useMaxWidth` shape) | fit computed | size derived from `viewBox`; the mounted rect is NOT consulted; fit `0.75` not `1.0` |
| E19 | design D4 constraint 3 | EP (markup shape) | L1 | automated | SVG with absolute `width`/`height`, no `viewBox` (non-`useMaxWidth` type) | fit computed | size derived from the attributes |
| E20 | zoomable-mermaid Default viewport height | BVA (lower clamp) | L1 | automated | window where `50vh < 240px` | viewport rendered | computed height `=== 240px` |
| E21 | zoomable-mermaid Default viewport height | BVA (upper clamp) | L1 | automated | window where `50vh > 640px` | viewport rendered | computed height `=== 640px` |
| E22 | zoomable-mermaid Default viewport height | BVA (mid-range) | L1 | automated | window where `240px ≤ 50vh ≤ 640px` | viewport rendered | computed height `=== 50vh` |
| E23 | markdown-rendering Override that captures nothing | EP | L1 | automated | markdown containing a GFM table | parent re-render that defeats `React.memo` | the `<table>` DOM node is the same instance — the case the "captures nothing, therefore safe" reasoning missed |
| E24 | markdown-rendering Conditionally supplied overrides | decision-table | L1 | automated | context **with** `fileLink` vs **without**, each rendered twice | second render | with-case: `p`/`li` supplied both times with identical identity. without-case: `p`/`li` absent both times, prose unlinkified |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | proposal headline claim | threshold (C3) | L3 | automated | `docs/architecture.md` open in the file viewer, harness idle, no interaction | **0** `.mermaid-diagram` removal waves after initial mount **AND** every stamped diagram node survives | 30s |
| P2 | markdown-rendering no-remount | node-identity soak | L3 | automated | same, chat view with a rendered mermaid block | every stamped `.mermaid-diagram` node survives | 30s |
| P3 | proposal performance impact | threshold (C3) | L3 | automated | same file, harness driven with concurrent session activity | **0** removal waves under load — guards the baseline finding that wave rate scales with event volume | 30s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | markdown-rendering Application-wide re-render | state-convergence | L3 | automated | file viewer on `docs/architecture.md` | an application-wide re-render occurs | no markdown DOM node is removed or replaced; node identities converge to unchanged |
| F2 | zoomable-mermaid Focus survives | state-transition | L3 | automated | a diagram clicked to focus, controls visible | ancestor re-renders repeatedly | controls remain in the DOM and operable; `scale` unchanged throughout |
| F3 | zoomable-mermaid Zoom survives | state-transition | L3 | automated | diagram zoomed to a non-fit scale and panned | ancestor re-renders | scale and pan offset unchanged |
| F4 | markdown-rendering Inline code spans are stable | state-convergence | L1 | automated | markdown with inline `code` spans inside `p` and `li` | re-render that defeats memo | inline `<code>` nodes are the same instances — and their parent `P`/`LI` record no childList mutation |
| F5 | markdown-rendering Prose overrides stable when file linking active | state-convergence | L1 | automated | context carrying `fileLink`, markdown with paragraphs and list items | re-render | `p` and `li` DOM nodes are the same instances (the chat case) |
| F6 | markdown-preview-view Identity stable across re-renders | state-transition | L1 | automated | `MarkdownViewer` with fixed `cwd`/`path` | parent re-renders without changing either | `MarkdownContent` does not re-render (memo holds) |
| F7 | markdown-preview-view Identity changes when file changes | state-transition | L1 | automated | `MarkdownViewer` switched to a different `path` | re-render | `MarkdownContent` re-renders with the new `imageBase` |
| F8 | markdown-preview-view Two on-disk surfaces at once | state-convergence | L1 | automated | two `MarkdownContent` instances, different `imageBase` | both mounted | each resolves local images against its own base — guards the module-scope state-leak failure mode |
| F9 | markdown-rendering Streaming content still updates | state-transition | L1 | automated | chat content growing token-by-token, mermaid fence still open | tokens arrive | `MermaidBlock` does not render; no parse error surfaces |
| F10 | markdown-rendering Streaming content still updates | state-transition | L1 | automated | same, fence then closes | closing fence arrives | diagram renders exactly once; previously rendered blocks are not remounted |
| F11 | zoomable-mermaid Viewport height stable under zoom | state-transition | L3 | automated | diagram at fitted scale in the fixed-height viewport | user zooms past the fitted scale | viewport's own height unchanged; the overflow is reachable by panning |
| F12 | design risk — `.mmd` path | state-convergence | L3 | automated | a `.mmd` file open via `MermaidViewer` (no markdown layer, no components map) | 30s idle | 0 removal waves — closes the branch the investigation never reproduced |
| F13 | zoomable-mermaid Diagram type without max-width | EP | L3 | automated | a diagram type outside `{flowchart, sequence, gantt}` | rendered | it is fitted to the viewport, not left at intrinsic width |
| F14 | zoomable-mermaid Initial view is fitted | visual/subjective | — | manual-only | the reference diagrams across the 9 themes | human looks at default framing | [judgment: framing reads as unchanged from today — no new clipping, no excessive whitespace] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D4 constraint 3 | fault-injection (missing data) | L1 | automated | SVG markup with no `viewBox`, no `width`/`height`, not yet measurable | fit computed | no throw; falls back to scale `1` and does not produce `NaN` |
| X2 | design D4 constraint 3 | fault-injection (malformed) | L1 | automated | malformed `viewBox` (e.g. `"0 0 abc 400"`) | fit computed | falls through to the next resolution step; scale is finite and within bounds |
| X3 | markdown-rendering no-remount | fault-injection (render failure) | L1 | automated | mermaid source that fails to parse | parent re-renders repeatedly | the cached error branch renders stably; no remount loop; no repeated `mermaid.render` calls |
| X4 | zoom-pan initial scale is additive | equivalence (A/B) | L1 | automated | identical wheel-zoom input, once with and once without an initial scale | wheel event | resulting scale delta and cursor anchoring are identical between the two runs |
| X5 | zoom-pan initial scale is additive | equivalence (A/B) | L1 | automated | identical drag input, with and without an initial scale | pointer drag | resulting translation delta is identical between the two runs |
| X6 | proposal compatibility claim | regression | L1 | automated | `FlowGraph`, `DiagramPreview`, `ImagePreview`, `ImageLightbox` — all omitting the new option | each rendered and exercised | zoom, pan, reset and indicator behaviour unchanged from before the change |

### Investigation (group 0)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | tasks 0.3 — identify the driver | investigative | — | manual-only | the running dashboard with the reference file open | instrumented observation | [judgment: the re-render driver is named and evidenced in `baseline.md`] |
| M2 | tasks 0.4 — inline-code hypothesis | investigative | — | manual-only | the reference file | instrumented observation | [judgment: hypothesis confirmed or falsified, recorded either way] |
| M3 | tasks 0.5 — run-to-run variance | investigative | — | manual-only | repeated measurement runs | comparison | [judgment: the condition that makes runs differ is identified] |
| M4 | tasks 0.8 — diagram count | investigative | — | manual-only | `docs/architecture.md` (26 fences, 21 nodes observed) | count reconciliation | [judgment: the 5 missing diagrams are accounted for] |

---

## Coverage summary

- Requirements covered: 11/11 (4 spec-delta capabilities + design constraints D1/D2/D4 + the proposal's headline and compatibility claims)
- Scenarios by class: edge 24 · perf 3 · frontend 14 · error 6 · investigation 4
- Scenarios by level: L1 33 · L2 0 · L3 10 · manual-only 5
- Scenarios by disposition: **automated 46 · manual-only 5**

## New infra needed

None. L1 rows extend existing vitest suites — `packages/client-utils/src/__tests__/useZoomPan.test.ts` (zoom-pan rows) and `packages/client/src/components/__tests__/MarkdownContent.test.tsx` (markdown rows). L3 rows extend the existing Playwright suite against the `docker/test-up.sh` harness.
