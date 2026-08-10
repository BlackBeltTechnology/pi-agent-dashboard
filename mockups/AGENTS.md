# DOX — mockups

Standalone static design/geometry mockups. One row per entry. Served via
`serve_mockup`; not built, not shipped, not imported by any package.

Pre-existing entries here predate the per-file doc protocol and are
undocumented; add a row when you touch one.

| File | Purpose |
|------|---------|
| `blackhole-settings/` | Explore-mode mockup for a proposed `pi-blackhole` dashboard plugin. Two surfaces, split by data scope. `index.html` = GLOBAL config (`settings-section` claim): scalar accordion groups + per-worker fallback-chain rail for `observer`/`reflector`/`dropper`/base `model`; `#stateSel` switches healthy / invalid-JSON / not-installed. `session-card.html` = PER-SESSION pipeline (`session-card-memory` claim, unclaimed by any plugin today): 3 density variants (B/C picked), 5 runtime states, plus a `content-view` drill-in. Scope rule: global file → settings page, `<sessionId>-pending.json` → session card. Encoded rules: unknown config keys preserved on save; unparseable config renders NO form; exact (`.exact`, from disk) vs approximate (`.approx`, dashboard-derived proxy) are visually distinct registers; the proxy never triggers an alarm. Studio + light via `data-theme`; 0 contrast failures across 8 theme/state combos. See change: add-blackhole-plugin (D6, D12, D13). |
| `chat-selection-anchor/` | Self-contained A/B repro for the chat selection-anchoring geometry (`index.html`, `Fixes: ON/OFF` via `id="fixToggle"`). Mirrors `ChatView`'s virtualized scroll container and copies `computeAnchorCorrection` behaviour from `packages/client/src/lib/chat/selection-anchor.ts` — divergence is a bug. See change: anchor-chat-selection-against-row-growth (D8); measured evidence in its `design.md` § Measured Evidence. |
