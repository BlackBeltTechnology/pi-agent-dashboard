# Phase 2 — content-visibility (Step A) notes

## What shipped (code)

- **Toggle:** `chat-cv` class on the `ChatView` scroll container. Removing it disables the whole optimization (single-class rollback, per task 4.2).
- **Rule** (`index.css`): `.chat-cv > *:not(.chat-cv-skip) { content-visibility: auto; contain-intrinsic-size: auto 160px; }`.
- **Opt-outs:** live tails carry `chat-cv-skip` so they are never skipped — streaming thinking block, streaming text bubble, pending-steer cards (honors the "streaming tail always rendered" requirement).
- Applied to the existing per-item transcript roots directly (direct children of the scroll container) — no per-message wrapper divs added, so DOM node count is unchanged.

## Task 4.1 — intrinsic-size estimate (measurement deferred)

Real per-message height measurement on a long session needs the live page — deferred to ship-time. The rule uses `contain-intrinsic-size: auto 160px`:
- `160px` is only the **pre-first-paint** placeholder (a mid estimate between a short user bubble ~60px and a long assistant/tool block).
- The `auto` keyword makes the browser **cache each row's real rendered height** after it first paints, so after the initial scroll the placeholder no longer matters and scroll anchoring is driven by measured heights. This is the primary jump mitigation.
- If ship-time tracing shows scroll drift, tune the `160px` fallback from measured medians.

## Ship-time verification (needs live browser)

- **4.3** Re-verify all `chat-scroll-lock` scenarios: auto-scroll follow, scroll-lock when scrolled up, scroll-to-bottom button, jump-to-message, `ChatViewHandle` imperative API. Watch for scroll-position jumps / blank flashes > 1 frame when scrolling back through history.
- **4.4** Re-trace: per-pass layout objects bounded by the viewport working set; no repeated painting of tall off-screen strips; idle busy < 5 %.
- **4.5** Decision gate: if Step A misses the budget, scope Step B (true windowing via `@tanstack/react-virtual`) as a **separate** follow-up change with delta specs — do NOT start it in this change.

## Known risk for QA to check

`content-visibility: auto` implies `contain: layout style paint` even for on-screen rows → **paint containment clips descendant overflow to the row box**. Verify nothing that visually overflows a message row is clipped: absolutely-positioned badges (e.g. `RetriedErrorBadge`), hover affordances, tool-card popovers. Portal/fixed overlays (`ImageLightbox`, `FilePreviewHost`) render at the ChatView root, not inside a row, so they are unaffected. If clipping appears, either exclude the offending row type with `chat-cv-skip` or disable via the `chat-cv` toggle.
