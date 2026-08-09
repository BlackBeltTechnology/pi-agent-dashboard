# DOX — mockups

Standalone static design/geometry mockups. One row per entry. Served via
`serve_mockup`; not built, not shipped, not imported by any package.

Pre-existing entries here predate the per-file doc protocol and are
undocumented; add a row when you touch one.

| File | Purpose |
|------|---------|
| `chat-selection-anchor/` | Self-contained repro + A/B harness for the chat selection-anchoring geometry (`index.html`, `Fixes: ON/OFF` via `id="fixToggle"`). Mirrors `ChatView`'s scroll container (`overflow-anchor:none`, absolutely-positioned `[data-index]` rows at `translateY(start)` over a total-size spacer) and copies `computeAnchorCorrection` behaviour verbatim from `packages/client/src/lib/chat/selection-anchor.ts`; divergence is a bug. Buttons grow/shrink a row, or grow a row ABOVE the viewport while applying the virtualizer's own `resizeItem` correction first (the double-move guard). Readout shows Δ anchorTop, correction, anchor drift, and whether `getSelection().toString()` changed. Measured evidence lives in the change's `design.md` § Measured Evidence. `compensate()` is driven from rAF (stand-in for ChatView's per-commit `useLayoutEffect`) and MUST start last — it closes over `let` bindings and would otherwise hit their temporal dead zone. See change: anchor-chat-selection-against-row-growth. |
