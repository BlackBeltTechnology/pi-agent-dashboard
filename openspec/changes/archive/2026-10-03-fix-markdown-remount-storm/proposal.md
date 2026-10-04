## Why

Rendered Mermaid diagrams blink continuously and their zoom/pan controls cannot
be used. A user reported both symptoms in the chat view and the file viewer.
Neither is a diagram bug: the rendered markdown subtree — including every
`MermaidBlock` — is **unmounted and remounted** on a recurring cycle, on static
content that nobody is touching. `useZoomPan` is correct; its state is simply
destroyed along with the component about once per second.

### Measured

Instrumented live against `/session/:id/editor?file=docs/architecture.md`
(21 diagrams, static file, no interaction) with a `MutationObserver`, an
`insertBefore` call-site sampler, and DOM-node identity stamping:

| Measurement | Result |
|---|---|
| DOM mutations in 36s | **1,386,898** (~38,500/sec) |
| `.mermaid-diagram` removal waves | every **~340–900ms**, sustained |
| Removals per wave | 21 — every *rendered* diagram, together |
| `insertBefore` call sites (400 samples) | **100% React commit phase** — not a DOM walker, not mermaid |
| **DOM-node identity after 20s (21 nodes stamped)** | **0 of 21 survived** |
| Mutation targets | `P` (731k), `LI` (618k), `STRONG`, `PRE`, `H2/H3/H4`, `DIV.markdown-content` |

The node-identity result is the load-bearing evidence: the diagrams are genuinely
remounted, not moved and not merely re-rendered.

**Unreconciled:** `docs/architecture.md` contains 26 ` ```mermaid ` fences but only
21 `.mermaid-diagram` nodes were present. Five are unaccounted for — plausibly
rendered into the error branch, which emits no `.mermaid-diagram` element, but
that is a guess. Task 0.8 reconciles the count before the figures are relied on;
the raw numbers are recorded in `baseline.md`.

### What is established, and what is not

An earlier revision of this proposal blamed a server-side `openspec_update`
broadcast storm. **That attribution was false and has been removed.** Two
independent adversarial reviews falsified it and source confirms them:

- `session/session-bootstrap.ts:136` is a **one-shot cold-boot** poll guarded by
  `if (priorEmpty || dataDiffers)` — not a per-tick broadcast.
- `directory-service.ts` `pollAndBroadcastIfChanged` **already** change-gates
  every periodic broadcast (`if (nextJson !== prevJson || pendingWasEmitted)`),
  a behaviour `openspec/specs/server-openspec-polling/spec.md` already requires,
  `folder-head-poll.ts:173` already calls "dedup parity with the openspec poll",
  and `__tests__/cold-boot-openspec-broadcast.test.ts:84` already tests.
- The machine's configured `pollIntervalSeconds` is **300**. Fifteen tick-driven
  `openspec_update` frames in a 25-second window is arithmetically impossible.

So the WebSocket frames were observed, but their source is **unidentified**, and
the correlation between them and the remount waves was assumed, never
established. This change does not guess a second time: identifying the trigger is
a blocking investigation task with a measurement gate, ahead of any fix.

What *is* independently established, by reading the source rather than by
inference, is the **amplifier** — the mechanism that converts any ordinary
re-render into a full DOM teardown:

`MarkdownContent.tsx:492` builds its `components` map inline in JSX. The real map
is `code`, a conditional spread of `p` + `li` gated on `context?.fileLink`
(`:549-556`), `table`, `a`, and `img: PiAssetImg`. `react-markdown@10` resolves
an overridden tag to the supplied component and uses it **as the React element
type** (`hast-util-to-jsx-runtime`: `own.call(state.components, name) ?
state.components[name] : name`). A fresh closure per render is a new type, and a
changed type makes React unmount and remount that subtree. `MermaidBlock` is
rendered by the `code` override, so it is destroyed and recreated — taking
`focused` and the zoom transform with it. That is precisely the reported
"controls flash and immediately disappear".

**Every override defined inline churns, whether or not it closes over anything** —
identity is what React compares, not captured scope. `code` (needs
`processedContent`, `syntaxStyle`, `context`), `a` (needs the loopback handler),
`p`/`li` (need `context`) **and `table`** (`:559`, captures nothing but is still
re-created each render) are all fresh types every render. Only `img` is exempt,
being the module-scope `PiAssetImg`. An earlier revision of this proposal
excused `table` on the grounds that it closes over nothing; that reasoning
conflated closure capture with identity churn, and would have left every GFM
table remounting.

**Hypothesis, to be verified rather than asserted:** the `code` override handles
**inline** code as well as fenced blocks (`:525` `isInline` branch), and a
`MutationObserver` records the *parent* as `m.target`. Remounting inline `<code>`
spans inside prose would therefore report mutations on `P`/`LI`/`H3` — which
matches the observed target distribution without requiring the `p`/`li`
overrides, and those are absent in the file viewer because `MarkdownViewer`
passes no `context`. Task 0.4 verifies this before the design relies on it.

### A second defect, currently masked

`openspec/specs/zoomable-mermaid/spec.md` requires the diagram be clipped
"within a **fixed-height** viewport container with `overflow: hidden`".
`MermaidBlock:381` already has `overflow-hidden`; what it lacks is the height —
it sets only `minHeight: 120` and lets the SVG size the container. CSS
`transform: scale()` does not affect layout, so the container keeps its unscaled
height and a zoomed diagram is clipped to it. The clipped remainder is still
reachable by panning (an earlier revision claimed it was unreachable — that was
an overclaim; translation is unclamped), but the usable window shrinks to the
pre-zoom box, which is the opposite of what zooming is for. This is invisible
today only because the zoom state never survives long enough to notice it.

## What Changes

- **`MarkdownContent` stops rebuilding its `components` map per render.** Hoist
  every override — `code`, `a`, and the conditional `p`/`li` — to stable
  identities, routing the per-render values they need (`processedContent`,
  `syntaxStyle`, `context`, the loopback handler) through context instead of
  closure. Omitting `p`/`li` would leave chat remounting, since chat is exactly
  where `context.fileLink` is present.
- **`imageBase` becomes a stable reference at all three call sites**
  (`MarkdownViewer.tsx:168`, `MarkdownPreview.tsx:52`,
  `FilePreviewOverlay.tsx:257`), restoring the `React.memo` guard on
  `MarkdownContent`, which a fresh object literal currently defeats on every
  render. `React.memo` shallow-compares each prop, so this one prop fails the
  comparison every time.
- **`MermaidBlock` gains the fixed height its spec already mandates**, with the
  diagram fitted to it so the default framing is unchanged.
- **`useZoomPan` gains an optional fit scale** used as *both* the initial scale
  and the reset/double-click target. This **widens a previously stated
  non-goal**, deliberately and with the tests updated: the fitted-view
  requirement cannot be delivered without it, because the hook hardcodes
  `useState({scale: 1, …})` with no setter and hardcodes the same literal in
  `reset` and `onDoubleClick`. Supplying only a reset target — as an earlier
  revision proposed — would leave the *initial* view unfitted and the
  "Initial view is fitted" requirement undeliverable.
- **The re-render trigger is investigated, not assumed.** A blocking task
  identifies what actually re-renders `MarkdownContent` roughly once per second,
  with instrumentation, before any fix is authored.

**Removed from this change:** all server-side work. The `openspec_update`
de-duplication it proposed already ships, is already specified, and is already
tested. No server file is touched.

Non-goals: no change to the zoom/pan *algorithm*, the click-to-activate focus
model, the zoom bounds, the mermaid render queue, the SVG/error caches, or
`colorizeDefaultNodes`. The `useZoomPan` change is additive — a new optional fit
scale — and does not alter panning, wheel/pinch zoom, or clamping.

## Impact

- Affected specs: `markdown-rendering`, `markdown-preview-view`, `zoomable-mermaid`, `zoom-pan`
- Affected code:
  - `packages/client/src/components/preview/MarkdownContent.tsx`
  - `packages/client/src/components/preview/MermaidBlock.tsx`
  - `packages/client/src/components/editor-pane/MarkdownViewer.tsx`
  - `packages/client/src/components/preview/MarkdownPreview.tsx`
  - `packages/client/src/components/preview/FilePreviewOverlay.tsx`
  - `packages/client-utils/src/useZoomPan.ts` (+ its `__tests__`)
  - `packages/client-utils/src/ZoomControls.tsx` — the `scale !== 1` indicator gate
    must become initial-scale-relative, so the shared component gains a prop
  - `packages/shared/src/dashboard-plugin/ui-primitives.ts` — `UiZoomControlsProps`
    must carry the same optional field, since plugins reach `ZoomControls`
    through that registry type
- Rebuild path: `packages/shared` is touched, so this is **not** client-only —
  `npm run build` + `curl -X POST /api/restart`.
- Compatibility: no protocol, schema, or persisted-state change; no server
  change at all. The `useZoomPan` fit scale is an **optional** parameter, so its
  other consumers are unaffected when it is omitted. Those consumers are
  `FlowGraph`, `DiagramPreview`, `ImagePreview` and `ImageLightbox` — **four, not
  one**; an earlier revision named only `FlowGraph`. `ZoomControls` is rendered by
  **three** surfaces — `MermaidBlock`, `DiagramPreview` (which gates `cursor` on
  `scale > 1`) and `FlowGraph` (via the `ui:zoom-controls` registry) — all of
  which must be checked when the indicator gate moves.
- Rollback: the `MarkdownContent` and `imageBase` edits revert independently.
  `MermaidBlock`'s fitted view, the `useZoomPan` option, the `ZoomControls` prop
  and the `UiZoomControlsProps` field are **one coupled unit** — reverting any
  one alone leaves either a silently unfitted reset or an indicator reading
  against the wrong baseline, so they revert together. No state migration exists
  to undo.
- Performance: 1.39M DOM mutations per 36s is sustained main-thread and battery
  cost on any tab displaying markdown, not merely a cosmetic defect. The benefit
  is bounded to markdown surfaces — a tab showing no markdown is unaffected.

## Discipline Skills

- **`systematic-debugging`** — promoted to the governing discipline for this
  change. The first revision asserted a server root cause from plausible code
  reading and was falsified on three independent grounds. The unidentified
  re-render trigger must now be established by evidence, with the fix gated
  behind it, which is exactly this skill's phased evidence-first rule.
- **`performance-optimization`** — measure-first by construction. The mutation
  counts, wave periods and node-identity results above are the baseline; the same
  instrumentation must be re-run after the fix, and the change is discharged only
  when removal waves and node replacement both reach zero on a static file.
  Guards against declaring victory on "looks smooth now".
- **`doubt-driven-review`** — already run on this artifact and responsible for
  deleting its entire server half. Applies again to the `components` hoist, where
  the obvious way to make the symptom stop is to capture a per-render value in
  module scope, which would silently share state across every `MarkdownContent`
  instance on the page.
- **`review-code`** — before commit, focused on that same module-scope hazard and
  on the `useZoomPan` signature change remaining backward-compatible for
  `FlowGraph`.
