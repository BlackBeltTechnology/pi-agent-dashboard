# DOX — mockups

Standalone static design/geometry mockups. One row per entry. Served via
`serve_mockup`; not built, not shipped, not imported by any package.

Pre-existing entries here predate the per-file doc protocol and are
undocumented; add a row when you touch one.

| File | Purpose |
|------|---------|
| `chat-selection-anchor/` | Self-contained A/B repro for the chat selection-anchoring geometry (`index.html`, `Fixes: ON/OFF` via `id="fixToggle"`). Mirrors `ChatView`'s virtualized scroll container and copies `computeAnchorCorrection` behaviour from `packages/client/src/lib/chat/selection-anchor.ts` — divergence is a bug. See change: anchor-chat-selection-against-row-growth (D8); measured evidence in its `design.md` § Measured Evidence. |
