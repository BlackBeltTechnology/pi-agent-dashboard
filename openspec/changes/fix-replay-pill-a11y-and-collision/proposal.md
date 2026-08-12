## Why

The replay-in-flight pill shipped in `show-replay-in-flight-indicator` (#458,
`736c1d269`) has two defects that a post-ship UX review found and measured. Both
are invisible to the existing tests, which assert the pill's presence and ARIA
handle but never its position relative to other controls, its contrast, or its
motion behaviour.

1. **It hides a control on mobile.** The pill is `absolute bottom-4 right-4 z-10`
   (`ChatView.tsx:1438`); the scroll-to-bottom button is `absolute bottom-4
   left-1/2 -translate-x-1/2 z-10` (`:1460`). At a 375px viewport the pill spans
   x=173..359 and the button x=171.5..203.5. At equal `z-10` the pill paints
   later and **completely occludes** the button — the user cannot return to the
   bottom of the transcript for as long as the replay runs, which is exactly the
   moment new content is arriving.

2. **It has no perceivable boundary (WCAG 2.1 SC 1.4.11).** `--bg-tertiary` over
   the transcript's `--bg-primary` measures **1.19:1** dark / **1.14:1** light,
   and the `--border-subtle` hairline resolves to ~**1.42:1**, against a 3:1
   floor for a component's visual boundary. `shadow-lg` contributes nothing over
   a near-black background. The pill reads as text lying on a message bubble
   rather than as a distinct surface.

A third, smaller defect rides along: the pill's `animate-spin` runs indefinitely
and honours no `prefers-reduced-motion` branch, while `index.css` already ships
six such blocks — so the pill breaks an established repo convention as well as
vestibular-safety guidance.

Text contrast is **not** a defect — it measures 7.69:1 dark / 8.55:1 light and
passes AA comfortably. Only the surface edge fails.

Full measurements, screenshots, and the scored rubric: `mockups/ui-plan.md` in
this change, with the live A/B/C comparison in `mockups/index.html`.

## What Changes

- Move the pill clear of the scroll-to-bottom button so the two can never
  occlude one another at any viewport width, and give it a `z-index` above the
  scroll controls so paint order is no longer accidental.
- Restyle the pill onto `--bg-surface` with a hairline border in a new
  `--border-strong` token, raising the surface boundary to **5.01:1** dark /
  **4.48:1** light and clearing the SC 1.4.11 floor. Label moves to
  `--text-primary`. No existing border token qualifies (`--border-secondary` is
  1.57:1 / 1.61:1), and a fill alone cannot reach 3:1 without becoming a
  light-grey blob in a dark transcript — so the token is added to the theme
  layer, per the theme-system rule. See design D2.
- Stop the spinner rotation under `@media (prefers-reduced-motion: reduce)`. The
  pill stays visible and `role="status"` still announces, so the status remains
  conveyed without motion.
- Drop the redundant `aria-label`, which duplicates the visible text verbatim
  and overrides identical content.
- Add regression coverage for all three: a component test asserting the pill and
  the scroll-to-bottom button do not overlap, a token-level assertion on the
  pill's surface/border classes, and a reduced-motion assertion.

Not a breaking change: the `data-testid`, `role`, and `aria-busy` contract that
the spec pins and the e2e spec depends on is preserved exactly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-history-loading-indicator`: the "Chat view indicates an unfinished
  replay" requirement gains constraints that the indicator must not occlude
  another interactive control at any viewport width, must meet SC 1.4.11 against
  the transcript background, and must suppress its animation under
  `prefers-reduced-motion`. The existing accessible-handle sentence loses the
  `aria-label` clause.

## Impact

- `packages/client/src/components/chat/ChatView.tsx` — pill position, `z-index`,
  surface/border/text tokens, `aria-label` removal (`:1432-1444`).
- `packages/client/src/index.css` — a new `--border-strong` token in both
  `:root` and `[data-theme="light"]`, plus a reduced-motion branch for the
  pill's spinner alongside the six existing blocks.
- `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx`
  — new non-occlusion, token, and reduced-motion cases; existing 22 assertions
  unchanged.
- `tests/e2e/replay-in-flight-pill.spec.ts` — may gain a 375px non-occlusion
  check; its existing selectors are unaffected.
- No server change. No protocol change. One new design token
  (`--border-strong`), defined in both theme blocks.

## Discipline Skills

- `review-code` — non-trivial change with tests passing before commit.
- `scenario-design` — the defects were found by geometry and contrast
  measurement, not by the existing tests; the regression scenarios need deriving
  rather than transcribing.

`security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply: no untrusted input, no auth, no
secrets, no latency budget, no new endpoint or external call.
